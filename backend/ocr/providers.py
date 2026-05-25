"""
ARKI — OCR Provider Implementations

Three providers:
  - TesseractProvider   → local, always available
  - EasyOcrProvider     → local ML, lazy-init, runs in thread pool
  - OpenAIVisionProvider → cloud GPT-4o-mini vision
"""

from __future__ import annotations

import asyncio
import base64
import io
from typing import TYPE_CHECKING

import structlog
from PIL import Image

from ocr.pipeline import OcrResult

if TYPE_CHECKING:
    from ocr.pipeline import OcrConfig

log = structlog.get_logger("arki.ocr.providers")


# ── Tesseract ─────────────────────────────────────────────────────────────────

class TesseractProvider:
    name = "tesseract"

    def __init__(self, config: "OcrConfig") -> None:
        import pytesseract
        pytesseract.pytesseract.tesseract_cmd = config.tesseract_cmd
        self._pytess = pytesseract
        self._lang = config.tesseract_lang
        self._psm = config.tesseract_psm
        self._oem = config.tesseract_oem

    async def process(self, image: Image.Image, language: str) -> OcrResult:
        """Run Tesseract in a thread pool and return OcrResult."""
        loop = asyncio.get_event_loop()

        def _run() -> OcrResult:
            tess_lang = language if language else self._lang
            tess_config = f"--psm {self._psm} --oem {self._oem}"

            # Get confidence data
            data = self._pytess.image_to_data(
                image,
                lang=tess_lang,
                config=tess_config,
                output_type=self._pytess.Output.DICT,
            )

            # Calculate mean confidence from non-empty words (conf != -1)
            confs = [c for c in data["conf"] if c != -1]
            confidence = (sum(confs) / len(confs) / 100.0) if confs else 0.0

            # Build text from words with positive confidence
            words = [
                data["text"][i]
                for i in range(len(data["text"]))
                if data["conf"][i] > 0 and data["text"][i].strip()
            ]
            text = " ".join(words)

            return OcrResult(
                text=text,
                confidence=min(1.0, max(0.0, confidence)),
                provider=self.name,
                processing_ms=0,  # set by pipeline
            )

        return await loop.run_in_executor(None, _run)


# ── EasyOCR ───────────────────────────────────────────────────────────────────

class EasyOcrProvider:
    name = "easyocr"
    _reader = None  # class-level cache

    def __init__(self, config: "OcrConfig") -> None:
        self._languages = config.easyocr_languages
        self._gpu = config.easyocr_gpu

    def _get_reader(self):
        """Lazy-init EasyOCR reader (heavy, ~1s first load). Cached at class level."""
        if EasyOcrProvider._reader is None:
            import easyocr
            EasyOcrProvider._reader = easyocr.Reader(self._languages, gpu=self._gpu)
        return EasyOcrProvider._reader

    async def process(self, image: Image.Image, language: str) -> OcrResult:
        """Run EasyOCR in thread pool (sync library)."""
        import numpy as np

        loop = asyncio.get_event_loop()

        def _run() -> OcrResult:
            img_array = np.array(image)
            reader = self._get_reader()
            results = reader.readtext(img_array)
            # results: [(bbox, text, confidence), ...]

            texts: list[str] = []
            confidences: list[float] = []
            for (_bbox, text, conf) in results:
                if text.strip():
                    texts.append(text)
                    confidences.append(conf)

            combined_text = " ".join(texts)
            avg_conf = sum(confidences) / len(confidences) if confidences else 0.0

            return OcrResult(
                text=combined_text,
                confidence=min(1.0, max(0.0, avg_conf)),
                provider=self.name,
                processing_ms=0,
            )

        return await loop.run_in_executor(None, _run)


# ── OpenAI Vision ─────────────────────────────────────────────────────────────

class OpenAIVisionProvider:
    name = "openai-vision"

    def __init__(self, config: "OcrConfig") -> None:
        from openai import AsyncOpenAI
        self._client = AsyncOpenAI(api_key=config.openai_api_key)

    async def process(self, image: Image.Image, language: str) -> OcrResult:
        """Send image to GPT-4o-mini vision for OCR."""
        # Encode image as base64 PNG
        buffer = io.BytesIO()
        image.save(buffer, format="PNG")
        b64 = base64.b64encode(buffer.getvalue()).decode("utf-8")
        data_url = f"data:image/png;base64,{b64}"

        response = await self._client.chat.completions.create(
            model="gpt-4o-mini",
            max_tokens=2000,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "Extract all text exactly as it appears. "
                        "Return only the extracted text."
                    ),
                },
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image_url",
                            "image_url": {"url": data_url, "detail": "high"},
                        }
                    ],
                },
            ],
        )

        text = response.choices[0].message.content or ""

        return OcrResult(
            text=text,
            confidence=0.95,  # GPT-4V doesn't expose per-token OCR confidence
            provider=self.name,
            processing_ms=0,
        )
