"""
ARKI — Application Configuration
Loaded once at startup via pydantic-settings. All values come from .env.
"""

from __future__ import annotations

from enum import Enum
from functools import lru_cache
from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class AppEnv(str, Enum):
    DEVELOPMENT = "development"
    PRODUCTION  = "production"


class AIProvider(str, Enum):
    OPENAI = "openai"
    OLLAMA = "ollama"
    AUTO   = "auto"   # Try Ollama first, fallback to OpenAI


class OCRProvider(str, Enum):
    TESSERACT    = "tesseract"
    EASYOCR      = "easyocr"
    OPENAI_VISION = "openai_vision"
    AUTO         = "auto"   # Best available


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ── Application ────────────────────────────────────────────────────────────
    app_env:     AppEnv = AppEnv.DEVELOPMENT
    app_name:    str    = "ARKI"
    app_version: str    = "1.0.0"
    log_level:   str    = "info"
    secret_key:  str    = Field(default="insecure-change-me", min_length=16)

    # ── Server ─────────────────────────────────────────────────────────────────
    backend_host:    str = "127.0.0.1"
    backend_port:    int = Field(default=8000, ge=1024, le=65535)
    websocket_port:  int = Field(default=8765, ge=1024, le=65535)
    cors_origins:    list[str] = ["http://localhost:5173"]

    # ── AI Providers ───────────────────────────────────────────────────────────
    openai_api_key:         str        = Field(default="", repr=False)  # hidden in repr
    openai_default_model:   str        = "gpt-4o-mini"
    openai_analysis_model:  str        = "gpt-4o"
    openai_max_tokens:      int        = Field(default=300, ge=50, le=4000)
    openai_temperature:     float      = Field(default=0.3, ge=0.0, le=2.0)
    ollama_base_url:        str        = "http://localhost:11434"
    ollama_default_model:   str        = "llama3.2"
    ollama_analysis_model:  str        = "llama3.2:70b"
    ai_provider:            AIProvider = AIProvider.OPENAI
    ai_cost_alert_usd:      float      = Field(default=0.30, ge=0.0)
    ai_cost_max_usd:        float      = Field(default=0.50, ge=0.0)

    # ── OCR ────────────────────────────────────────────────────────────────────
    tesseract_cmd:   str        = "/usr/local/bin/tesseract"
    tesseract_lang:  str        = "eng+spa"
    tesseract_psm:   int        = Field(default=3, ge=0, le=13)
    tesseract_oem:   int        = Field(default=3, ge=0, le=3)
    easyocr_enabled: bool       = False
    easyocr_languages: list[str] = ["en", "es"]
    easyocr_gpu:     bool       = False
    openai_vision_enabled: bool = False
    openai_vision_model: str    = "gpt-4o"
    ocr_provider:    OCRProvider = OCRProvider.TESSERACT

    # ── Screen Capture ─────────────────────────────────────────────────────────
    capture_latency_target_ms: int = 150
    capture_format:            str = "png"

    # ── Session & Memory ───────────────────────────────────────────────────────
    session_db_path:               str   = "./data/sessions.db"
    max_context_tokens:            int   = Field(default=1500, ge=100)
    context_window_minutes:        int   = Field(default=3, ge=1)
    rolling_summary_interval_mins: int   = Field(default=5, ge=1)

    # ── Security ───────────────────────────────────────────────────────────────
    enable_csp:             bool = True
    encrypt_local_storage:  bool = True

    # ── Derived properties ─────────────────────────────────────────────────────
    @property
    def is_development(self) -> bool:
        return self.app_env == AppEnv.DEVELOPMENT

    @property
    def is_production(self) -> bool:
        return self.app_env == AppEnv.PRODUCTION

    @property
    def db_path(self) -> Path:
        return Path(self.session_db_path)

    @field_validator("secret_key")
    @classmethod
    def validate_secret_key(cls, v: str) -> str:
        if v in ("insecure-change-me", "change-me", ""):
            import warnings
            warnings.warn(
                "SECRET_KEY is using the default insecure value. "
                "Set a proper SECRET_KEY in .env for production.",
                stacklevel=2,
            )
        return v


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return the cached application settings singleton."""
    return Settings()
