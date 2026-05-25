"""
ARKI — OCR Pipeline

Provider chain: primary → fallback[0] → fallback[1] → ...
Decodes base64 → PIL Image before sending to providers.
Caches provider instances (no re-init per request).
"""

from __future__ import annotations

import asyncio
import base64
import io
import time
from dataclasses import dataclass
from typing import Optional

import structlog
from PIL import Image

log = structlog.get_logger("arki.ocr.pipeline")


@dataclass
class OcrResult:
    text: str
    confidence: float
    provider: str
    processing_ms: int


class OcrConfig:
    """Thin wrapper around Settings for OCR-specific config."""

    def __init__(self, settings) -> None:
        self.provider: str = settings.ocr_provider
        self.fallback_providers: list[str] = settings.ocr_fallback_providers
        self.language: str = settings.ocr_language
        self.min_confidence: float = settings.ocr_min_confidence
        # Tesseract specifics
        self.tesseract_cmd: str = settings.tesseract_cmd
        self.tesseract_lang: str = settings.tesseract_lang
        self.tesseract_psm: int = settings.tesseract_psm
        self.tesseract_oem: int = settings.tesseract_oem
        # EasyOCR specifics
        self.easyocr_languages: list[str] = settings.easyocr_languages
        self.easyocr_gpu: bool = settings.easyocr_gpu
        # OpenAI Vision specifics
        self.openai_api_key: str = settings.openai_api_key


class OcrPipeline:
    """
    Async OCR pipeline with provider chain and instance caching.

    Usage:
        pipeline = OcrPipeline(config)
        await pipeline.preload()
        result = await pipeline.process(image_base64)
    """

    def __init__(self, config: OcrConfig) -> None:
        self._config = config
        self._provider_cache: dict[str, object] = {}

    # ── Public API ─────────────────────────────────────────────────────────────

    async def preload(self) -> None:
        """
        Initialize the default provider on startup to avoid cold-start latency
        on the first request.
        """
        try:
            provider = await self._get_provider(self._config.provider)
            log.info("ocr.preload_complete", provider=self._config.provider)
        except Exception as e:
            log.warning("ocr.preload_failed", provider=self._config.provider, error=str(e))

    async def process(
        self,
        image_base64: str,
        provider_override: Optional[str] = None,
        language: Optional[str] = None,
    ) -> OcrResult:
        """
        Decode base64 image and run OCR through the provider chain.

        Provider selection order:
        1. provider_override (if given)
        2. config.provider
        3. config.fallback_providers[0], [1], ...
        """
        image = self._decode_image(image_base64)
        lang = language or self._config.language

        chain = self._build_chain(provider_override)
        last_error: Optional[Exception] = None

        for provider_name in chain:
            try:
                provider = await self._get_provider(provider_name)
                t0 = time.perf_counter()
                result = await provider.process(image, lang)
                processing_ms = int((time.perf_counter() - t0) * 1000)
                result.processing_ms = processing_ms
                log.info(
                    "ocr.success",
                    provider=provider_name,
                    confidence=result.confidence,
                    processing_ms=processing_ms,
                )
                return result
            except Exception as e:
                log.warning(
                    "ocr.provider_failed",
                    provider=provider_name,
                    error=str(e),
                )
                last_error = e
                continue

        raise RuntimeError(
            f"All OCR providers failed. Last error: {last_error}"
        ) from last_error

    # ── Internals ──────────────────────────────────────────────────────────────

    def _build_chain(self, override: Optional[str]) -> list[str]:
        """Build ordered provider chain based on override and config."""
        if override:
            return [override] + [
                p for p in [self._config.provider] + self._config.fallback_providers
                if p != override
            ]
        return [self._config.provider] + self._config.fallback_providers

    async def _get_provider(self, name: str) -> object:
        """Return cached provider instance, creating it if needed."""
        if name not in self._provider_cache:
            self._provider_cache[name] = self._create_provider(name)
        return self._provider_cache[name]

    def _create_provider(self, name: str) -> object:
        from ocr.providers import TesseractProvider, EasyOcrProvider, OpenAIVisionProvider

        if name == "tesseract":
            return TesseractProvider(self._config)
        if name == "easyocr":
            return EasyOcrProvider(self._config)
        if name in ("openai-vision", "openai_vision"):
            return OpenAIVisionProvider(self._config)
        raise ValueError(f"Unknown OCR provider: {name!r}")

    @staticmethod
    def _decode_image(image_base64: str) -> Image.Image:
        """Decode base64 string to PIL Image."""
        try:
            # Strip data URL prefix if present (data:image/png;base64,...)
            if "," in image_base64:
                image_base64 = image_base64.split(",", 1)[1]
            image_bytes = base64.b64decode(image_base64)
            return Image.open(io.BytesIO(image_bytes)).convert("RGB")
        except Exception as e:
            raise ValueError(f"Failed to decode image: {e}") from e
