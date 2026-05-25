"""
ARKI — OCR Service Abstraction Layer

Architecture: Strategy Pattern
- OCRService (abstract base)
  ├── TesseractOCRService  (local, always available)
  ├── EasyOCRService       (local ML, optional)
  └── OpenAIVisionService  (cloud, optional)

The factory function `get_ocr_service()` selects the right provider
based on configuration and availability.

Rules from skills/ai-recommender.md:
- Never block the main pipeline if OCR fails → always return an OCRResult (with error field)
- Use AUTO mode to pick best available provider
- Prefer local providers over cloud (privacy-first)
"""

from __future__ import annotations

import abc
import asyncio
import re
from typing import Optional

import structlog

from api.models import ContentType, Language, OCRResult

log = structlog.get_logger("arki.ocr")


# ── Abstract Base ──────────────────────────────────────────────────────────────

class OCRService(abc.ABC):
    """Abstract OCR service. All providers implement this interface."""

    @property
    @abc.abstractmethod
    def provider_name(self) -> str:
        """Provider identifier for logging and metadata."""
        ...

    @abc.abstractmethod
    async def check_availability(self) -> bool:
        """Return True if the provider is installed and operational."""
        ...

    @abc.abstractmethod
    async def _extract_text(self, image_bytes: bytes, mime_type: str) -> tuple[str, float]:
        """
        Extract raw text from image bytes.
        Returns: (raw_text, confidence_0_to_1)
        """
        ...

    async def process(self, image_bytes: bytes, mime_type: str = "image/png") -> OCRResult:
        """
        Full OCR pipeline:
        1. Extract raw text
        2. Clean and normalize
        3. Detect content type and language
        4. Return structured OCRResult

        Never raises — errors are captured in result.error.
        """
        try:
            raw_text, confidence = await self._extract_text(image_bytes, mime_type)
            cleaned = self._clean_text(raw_text)
            content_type, language = self._classify_content(cleaned)

            return OCRResult(
                raw_text=raw_text,
                cleaned_text=cleaned,
                content_type=content_type,
                detected_language=language,
                confidence=confidence,
                processing_ms=0,  # Set by caller
                provider=self.provider_name,
            )
        except Exception as e:
            log.error("ocr.process_error", provider=self.provider_name, error=str(e))
            return OCRResult(
                raw_text="",
                cleaned_text="",
                content_type=ContentType.UNKNOWN,
                confidence=0.0,
                processing_ms=0,
                provider=self.provider_name,
                error=str(e),
            )

    # ── Text normalization ─────────────────────────────────────────────────────

    @staticmethod
    def _clean_text(raw: str) -> str:
        """Normalize OCR output: fix common artifacts, preserve code indentation."""
        if not raw:
            return ""

        # Remove excessive blank lines (keep max 2)
        text = re.sub(r'\n{3,}', '\n\n', raw)

        # Fix common Tesseract artifacts
        text = text.replace('|', 'I').replace('０', '0')

        # Strip trailing whitespace from each line, preserve leading (indentation)
        lines = [line.rstrip() for line in text.splitlines()]
        text = '\n'.join(lines)

        return text.strip()

    # ── Content classification ─────────────────────────────────────────────────

    @staticmethod
    def _classify_content(text: str) -> tuple[ContentType, Optional[Language]]:
        """
        Heuristic content type detection.
        Returns (ContentType, Language | None)
        """
        if not text:
            return ContentType.UNKNOWN, None

        # Code detection heuristics
        code_patterns = [
            r'\b(def|class|import|from|return|if|elif|else|for|while|try|except)\b',  # Python
            r'\b(function|const|let|var|=>|async|await|export|import)\b',             # JS/TS
            r'\b(public|private|class|void|static|final|extends|implements)\b',       # Java
            r'\b(SELECT|FROM|WHERE|JOIN|INSERT|UPDATE|DELETE|CREATE|DROP)\b',          # SQL
            r'[{};]\s*$',                                                              # C-style
        ]
        code_matches = sum(1 for p in code_patterns if re.search(p, text, re.MULTILINE))
        if code_matches >= 2 or (code_matches >= 1 and text.count('\n') > 3):
            language = OCRService._detect_language(text)
            return ContentType.CODE, language

        # Math detection heuristics
        math_patterns = [
            r'[∑∫∂∇≈≡≤≥±×÷√∞∈∉∪∩]',          # Math symbols
            r'\$.*\$',                           # LaTeX inline
            r'\\(frac|sqrt|sum|int|lim)\{',     # LaTeX commands
            r'\b\d+\s*[+\-×÷*/]\s*\d+\s*=',    # Simple equations
        ]
        if any(re.search(p, text) for p in math_patterns):
            return ContentType.MATH, None

        # Table detection heuristics
        if text.count('|') > 4 or (text.count('\t') > 4 and text.count('\n') > 2):
            return ContentType.TABLE, None

        # Default to plain text
        return ContentType.TEXT, None

    @staticmethod
    def _detect_language(text: str) -> Language:
        """Detect programming language from code text."""
        scores: dict[Language, int] = {lang: 0 for lang in Language}

        patterns = {
            Language.PYTHON:     [r'\bdef\b', r'\bimport\b', r'\bprint\(', r':\s*$', r'\bindent\b'],
            Language.TYPESCRIPT: [r'\binterface\b', r'\btype\b.*=', r':\s*(string|number|boolean)', r'\benum\b'],
            Language.JAVASCRIPT: [r'\bconsole\.(log|error)\b', r'\bconst\b', r'\blet\b', r'=>'],
            Language.JAVA:       [r'\bpublic\s+class\b', r'\bSystem\.out\b', r'@Override', r'\bvoid\b'],
            Language.SQL:        [r'\bSELECT\b', r'\bFROM\b', r'\bWHERE\b', r'\bJOIN\b'],
            Language.BASH:       [r'^\s*#!', r'\$\{', r'\becho\b', r'\bgrep\b', r'\bawk\b'],
        }

        for lang, pats in patterns.items():
            for pat in pats:
                if re.search(pat, text, re.MULTILINE | re.IGNORECASE):
                    scores[lang] += 1

        best = max(scores.items(), key=lambda x: x[1])
        return best[0] if best[1] > 0 else Language.OTHER


# ── Tesseract Provider ─────────────────────────────────────────────────────────

class TesseractOCRService(OCRService):
    """
    Local OCR using pytesseract + Pillow.
    Always available as long as Tesseract is installed.
    Install: brew install tesseract (macOS) | apt install tesseract-ocr (Linux)
    """

    def __init__(self, config):
        import pytesseract
        pytesseract.pytesseract.tesseract_cmd = config.tesseract_cmd
        self._lang  = config.tesseract_lang
        self._psm   = config.tesseract_psm
        self._oem   = config.tesseract_oem
        self._pytess = pytesseract

    @property
    def provider_name(self) -> str:
        return "tesseract"

    async def check_availability(self) -> bool:
        try:
            loop = asyncio.get_event_loop()
            version = await loop.run_in_executor(None, self._pytess.get_tesseract_version)
            log.info("ocr.tesseract_version", version=str(version))
            return True
        except Exception as e:
            log.warning("ocr.tesseract_unavailable", error=str(e))
            return False

    async def _extract_text(self, image_bytes: bytes, mime_type: str) -> tuple[str, float]:
        from PIL import Image
        import io

        loop = asyncio.get_event_loop()

        def _run_tesseract() -> tuple[str, float]:
            image = Image.open(io.BytesIO(image_bytes))

            # Preprocess: convert to grayscale for better OCR accuracy
            if image.mode not in ('L', 'RGB'):
                image = image.convert('RGB')

            config = f'--psm {self._psm} --oem {self._oem}'
            data = self._pytess.image_to_data(
                image,
                lang=self._lang,
                config=config,
                output_type=self._pytess.Output.DICT,
            )

            # Calculate average confidence (ignoring -1 values)
            confs = [c for c in data['conf'] if c != -1]
            confidence = (sum(confs) / len(confs) / 100.0) if confs else 0.0

            text = self._pytess.image_to_string(image, lang=self._lang, config=config)
            return text, min(1.0, max(0.0, confidence))

        return await loop.run_in_executor(None, _run_tesseract)


# ── EasyOCR Provider ──────────────────────────────────────────────────────────

class EasyOCRService(OCRService):
    """
    Local ML-based OCR using EasyOCR.
    Better multilingual support than Tesseract, but heavier (requires torch).
    Lazy-loaded to avoid import cost when not used.
    """

    def __init__(self, config):
        self._languages = config.easyocr_languages
        self._gpu       = config.easyocr_gpu
        self._reader    = None  # Lazy init

    @property
    def provider_name(self) -> str:
        return "easyocr"

    def _get_reader(self):
        """Lazy-initialize EasyOCR reader (heavy, ~1s first load)."""
        if self._reader is None:
            import easyocr
            self._reader = easyocr.Reader(self._languages, gpu=self._gpu)
        return self._reader

    async def check_availability(self) -> bool:
        try:
            import easyocr  # noqa: F401
            return True
        except ImportError:
            log.warning("ocr.easyocr_not_installed")
            return False

    async def _extract_text(self, image_bytes: bytes, mime_type: str) -> tuple[str, float]:
        import numpy as np
        from PIL import Image
        import io

        loop = asyncio.get_event_loop()

        def _run_easyocr() -> tuple[str, float]:
            image = Image.open(io.BytesIO(image_bytes))
            img_array = np.array(image)
            reader = self._get_reader()
            results = reader.readtext(img_array)

            texts = []
            confidences = []
            for (_bbox, text, conf) in results:
                texts.append(text)
                confidences.append(conf)

            full_text = '\n'.join(texts)
            avg_conf  = sum(confidences) / len(confidences) if confidences else 0.0
            return full_text, avg_conf

        return await loop.run_in_executor(None, _run_easyocr)


# ── OpenAI Vision Provider ────────────────────────────────────────────────────

class OpenAIVisionOCRService(OCRService):
    """
    Cloud OCR using OpenAI GPT-4o vision.
    Highest accuracy, especially for complex layouts.
    Use only when explicitly enabled (OPENAI_VISION_ENABLED=true).
    Cost: ~$0.001–$0.005 per image.
    """

    def __init__(self, config):
        from openai import AsyncOpenAI
        self._client = AsyncOpenAI(api_key=config.openai_api_key)
        self._model  = config.openai_vision_model
        self._api_key_set = bool(config.openai_api_key)

    @property
    def provider_name(self) -> str:
        return "openai_vision"

    async def check_availability(self) -> bool:
        if not self._api_key_set:
            log.warning("ocr.openai_vision_no_api_key")
            return False
        try:
            models = await self._client.models.list()
            return any(self._model in m.id for m in models.data)
        except Exception as e:
            log.warning("ocr.openai_vision_unavailable", error=str(e))
            return False

    async def _extract_text(self, image_bytes: bytes, mime_type: str) -> tuple[str, float]:
        import base64

        b64 = base64.b64encode(image_bytes).decode()
        data_url = f"data:{mime_type};base64,{b64}"

        response = await self._client.chat.completions.create(
            model=self._model,
            max_tokens=2000,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": (
                                "Extract ALL text from this image exactly as it appears. "
                                "Preserve formatting, indentation, and line breaks. "
                                "For code: preserve exact syntax. "
                                "For math: use LaTeX notation. "
                                "Return ONLY the extracted text, nothing else."
                            ),
                        },
                        {
                            "type": "image_url",
                            "image_url": {"url": data_url, "detail": "high"},
                        },
                    ],
                }
            ],
        )

        text = response.choices[0].message.content or ""
        # OpenAI Vision doesn't provide per-char confidence → use fixed high value
        return text, 0.95


# ── Factory ───────────────────────────────────────────────────────────────────

def get_ocr_service(config) -> OCRService:
    """
    Factory: return the appropriate OCR service based on config.
    AUTO mode: prefer EasyOCR > Tesseract (both local).
    """
    from config import OCRProvider

    provider = config.ocr_provider

    if provider == OCRProvider.TESSERACT:
        return TesseractOCRService(config)

    if provider == OCRProvider.EASYOCR:
        if not config.easyocr_enabled:
            log.warning("ocr.easyocr_not_enabled, falling back to tesseract")
            return TesseractOCRService(config)
        return EasyOCRService(config)

    if provider == OCRProvider.OPENAI_VISION:
        if not config.openai_vision_enabled:
            log.warning("ocr.openai_vision_not_enabled, falling back to tesseract")
            return TesseractOCRService(config)
        return OpenAIVisionOCRService(config)

    # AUTO: EasyOCR if enabled and available, else Tesseract (always local-first)
    if config.easyocr_enabled:
        return EasyOCRService(config)
    return TesseractOCRService(config)
