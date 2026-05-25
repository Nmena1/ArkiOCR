"""
ARKI — Pydantic Request/Response Models
Mirrors frontend types/ipc.types.ts — keep in sync.
"""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Optional
from uuid import uuid4

from pydantic import BaseModel, Field, field_validator


# ── Enums ─────────────────────────────────────────────────────────────────────

class ContentType(str, Enum):
    CODE    = "code"
    MATH    = "math"
    TEXT    = "text"
    TABLE   = "table"
    MIXED   = "mixed"
    UNKNOWN = "unknown"

class Language(str, Enum):
    PYTHON     = "python"
    TYPESCRIPT = "typescript"
    JAVASCRIPT = "javascript"
    JAVA       = "java"
    SQL        = "sql"
    BASH       = "bash"
    OTHER      = "other"

class AIResponseType(str, Enum):
    EXPLANATION  = "explanation"
    SOLUTION     = "solution"
    OPTIMIZATION = "optimization"
    TRANSLATION  = "translation"
    MATH_SOLUTION = "math_solution"
    CODE_REVIEW  = "code_review"
    ERROR        = "error"

class OCRProviderType(str, Enum):
    TESSERACT    = "tesseract"
    EASYOCR      = "easyocr"
    OPENAI_VISION = "openai_vision"
    AUTO         = "auto"

class AIProviderType(str, Enum):
    OPENAI = "openai"
    OLLAMA = "ollama"

class AnalysisType(str, Enum):
    EXPLAIN  = "explain"
    SOLVE    = "solve"
    OPTIMIZE = "optimize"
    TRANSLATE = "translate"

class ModelTier(str, Enum):
    MINI = "mini"   # fast / cheap (gpt-4o-mini, llama3.2)
    FULL = "full"   # deep (gpt-4o, llama3.2:70b)


# ── Requests ──────────────────────────────────────────────────────────────────

class CaptureRequest(BaseModel):
    image_base64: str          = Field(..., description="base64-encoded PNG/JPEG image")
    mime_type:    str          = Field("image/png", pattern=r"^image/(png|jpeg)$")
    ocr_provider: OCRProviderType = OCRProviderType.AUTO
    analyze_with_ai: bool      = False

    @field_validator("image_base64")
    @classmethod
    def validate_image_size(cls, v: str) -> str:
        # Prevent excessively large payloads (>10MB base64 ≈ 7.5MB image)
        if len(v) > 10 * 1024 * 1024:
            raise ValueError("Image too large (max 10MB base64)")
        return v


class AnalyzeRequest(BaseModel):
    ocr_result_id: str            = Field(..., description="ID of an existing OCR result")
    analysis_type: AnalysisType   = AnalysisType.EXPLAIN
    context:       Optional[str]  = Field(None, max_length=500)
    model:         ModelTier      = ModelTier.MINI


# ── Responses ─────────────────────────────────────────────────────────────────

def utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

class OCRResult(BaseModel):
    id:                str          = Field(default_factory=lambda: str(uuid4()))
    timestamp:         str          = Field(default_factory=utcnow_iso)
    raw_text:          str
    cleaned_text:      str
    content_type:      ContentType  = ContentType.UNKNOWN
    detected_language: Optional[Language] = None
    confidence:        float        = Field(ge=0.0, le=1.0)
    processing_ms:     int          = Field(ge=0)
    provider:          str
    error:             Optional[str] = None

    model_config = {"populate_by_name": True}


class CodeBlock(BaseModel):
    language:    str
    code:        str
    explanation: Optional[str] = None


class AIResponse(BaseModel):
    id:                str             = Field(default_factory=lambda: str(uuid4()))
    timestamp:         str             = Field(default_factory=utcnow_iso)
    type:              AIResponseType  = AIResponseType.EXPLANATION
    headline:          str             = Field(max_length=100)
    content:           str
    supporting_points: list[str]       = []
    code_blocks:       list[CodeBlock] = []
    suggested_follow_up: Optional[str] = None
    provider:          str
    model:             str
    input_tokens:      int             = 0
    output_tokens:     int             = 0
    latency_ms:        int             = 0
    session_cost_usd:  Optional[float] = None
    error:             Optional[str]   = None


class SessionInfo(BaseModel):
    id:                   str   = Field(default_factory=lambda: str(uuid4()))
    started_at:           str   = Field(default_factory=utcnow_iso)
    capture_count:        int   = 0
    ai_call_count:        int   = 0
    total_cost_usd:       float = 0.0
    cost_alert_threshold: float = 0.30
    cost_max_threshold:   float = 0.50


class WsMessage(BaseModel):
    type:      str
    payload:   dict
    timestamp: str = Field(default_factory=utcnow_iso)


class HealthResponse(BaseModel):
    status:    str
    version:   str
    timestamp: str
    services:  dict[str, str]
