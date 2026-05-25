"""
ARKI — Application Configuration
Loaded once at startup via pydantic-settings. All values come from .env.
"""

from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ── Backend ────────────────────────────────────────────────────────────────
    host: str = "127.0.0.1"
    port: int = 8000
    debug: bool = False
    app_version: str = "1.0.0"
    log_level: str = "info"

    # ── OCR ────────────────────────────────────────────────────────────────────
    ocr_provider: str = "tesseract"
    ocr_fallback_providers: list[str] = ["easyocr"]
    ocr_language: str = "eng"
    ocr_min_confidence: float = 0.3

    # Tesseract-specific
    tesseract_cmd: str = "/usr/local/bin/tesseract"
    tesseract_lang: str = "eng+spa"
    tesseract_psm: int = 3
    tesseract_oem: int = 3

    # EasyOCR-specific
    easyocr_languages: list[str] = ["en", "es"]
    easyocr_gpu: bool = False

    # ── AI ─────────────────────────────────────────────────────────────────────
    ai_provider: str = "ollama"
    ai_model: str = "llama3.2"
    ai_fallback_provider: str = "openai"
    ai_fallback_model: str = "gpt-4o-mini"
    ai_max_tokens: int = 500
    ai_temperature: float = 0.3
    ai_ollama_base_url: str = "http://127.0.0.1:11434"

    # ── API Keys ───────────────────────────────────────────────────────────────
    openai_api_key: str = ""
    anthropic_api_key: str = ""


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return the cached application settings singleton."""
    return Settings()
