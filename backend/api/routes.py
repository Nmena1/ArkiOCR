"""
ARKI — REST API Routes
All endpoints require the Electron renderer origin (validated by CORS middleware).
"""

from __future__ import annotations

import base64
import io
import time
import uuid
from typing import Annotated

import structlog
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import JSONResponse

from config import Settings, get_settings
from api.models import (
    AnalyzeRequest,
    CaptureRequest,
    HealthResponse,
    OCRResult,
    AIResponse,
    SessionInfo,
)

router = APIRouter()
log    = structlog.get_logger("arki.routes")

# ── Dependency: Settings ──────────────────────────────────────────────────────

def dep_settings() -> Settings:
    return get_settings()

SettingsDep = Annotated[Settings, Depends(dep_settings)]


# ── In-memory session (Phase 1 — SQLite in Phase 2) ──────────────────────────

_session: SessionInfo = SessionInfo()
_ocr_results: dict[str, OCRResult] = {}


# ── Health ────────────────────────────────────────────────────────────────────

@router.get(
    "/health",
    response_model=HealthResponse,
    tags=["Health"],
    summary="Detailed health check with service status",
)
async def health_check(settings: SettingsDep) -> HealthResponse:
    from datetime import datetime, timezone

    # Check OCR availability
    ocr_status = "ok"
    try:
        from ocr.interface import get_ocr_service
        svc = get_ocr_service(settings)
        if not await svc.check_availability():
            ocr_status = "degraded"
    except Exception:
        ocr_status = "error"

    # Check AI availability
    ai_status = "ok"
    try:
        from ai.interface import get_ai_service
        svc = get_ai_service(settings)
        if not await svc.check_availability():
            ai_status = "degraded"
    except Exception:
        ai_status = "error"

    overall = "ok" if ocr_status == "ok" and ai_status == "ok" else "degraded"

    return HealthResponse(
        status=overall,
        version=settings.app_version,
        timestamp=datetime.now(timezone.utc).isoformat(),
        services={"ocr": ocr_status, "ai": ai_status, "database": "ok"},
    )


# ── Capture / OCR ─────────────────────────────────────────────────────────────

@router.post(
    "/capture",
    response_model=OCRResult,
    status_code=status.HTTP_200_OK,
    tags=["OCR"],
    summary="Submit an image for OCR processing",
)
async def capture(
    request_data: CaptureRequest,
    settings: SettingsDep,
    http_request: Request,
) -> OCRResult:
    request_id = http_request.headers.get("X-Request-Id", str(uuid.uuid4()))
    log.info("capture.start", request_id=request_id, provider=request_data.ocr_provider)

    # Decode base64 image
    try:
        image_bytes = base64.b64decode(request_data.image_base64)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid base64 image data: {e}",
        )

    # Run OCR
    try:
        from ocr.interface import get_ocr_service
        ocr_service = get_ocr_service(settings)
        t0 = time.perf_counter()
        result = await ocr_service.process(image_bytes, mime_type=request_data.mime_type)
        result.processing_ms = int((time.perf_counter() - t0) * 1000)
    except Exception as e:
        log.error("capture.ocr_error", error=str(e), request_id=request_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="OCR processing failed",
        )

    # Store in memory
    _ocr_results[result.id] = result
    _session.capture_count += 1

    log.info(
        "capture.complete",
        result_id=result.id,
        content_type=result.content_type,
        confidence=result.confidence,
        processing_ms=result.processing_ms,
    )

    return result


# ── AI Analysis ───────────────────────────────────────────────────────────────

@router.post(
    "/analyze",
    response_model=AIResponse,
    status_code=status.HTTP_200_OK,
    tags=["AI"],
    summary="Run AI analysis on an OCR result",
)
async def analyze(
    request_data: AnalyzeRequest,
    settings: SettingsDep,
    http_request: Request,
) -> AIResponse:
    request_id = http_request.headers.get("X-Request-Id", str(uuid.uuid4()))

    # Check cost limit
    if _session.total_cost_usd >= settings.ai_cost_max_usd:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Session cost limit reached (${settings.ai_cost_max_usd:.2f}). Start a new session.",
        )

    # Retrieve OCR result
    ocr_result = _ocr_results.get(request_data.ocr_result_id)
    if not ocr_result:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"OCR result not found: {request_data.ocr_result_id}",
        )

    log.info(
        "analyze.start",
        ocr_id=request_data.ocr_result_id,
        analysis_type=request_data.analysis_type,
        model_tier=request_data.model,
        request_id=request_id,
    )

    try:
        from ai.interface import get_ai_service
        ai_service = get_ai_service(settings)
        t0 = time.perf_counter()
        response = await ai_service.analyze(
            ocr_result=ocr_result,
            analysis_type=request_data.analysis_type.value,
            context=request_data.context,
            model_tier=request_data.model.value,
        )
        response.latency_ms = int((time.perf_counter() - t0) * 1000)
    except Exception as e:
        log.error("analyze.ai_error", error=str(e), request_id=request_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="AI analysis failed",
        )

    # Track cost
    if response.session_cost_usd:
        _session.total_cost_usd += response.session_cost_usd
    _session.ai_call_count += 1

    log.info(
        "analyze.complete",
        response_id=response.id,
        latency_ms=response.latency_ms,
        session_cost=_session.total_cost_usd,
    )

    return response


# ── Session ───────────────────────────────────────────────────────────────────

@router.get(
    "/session",
    response_model=SessionInfo,
    tags=["Session"],
    summary="Get current session info",
)
async def get_session() -> SessionInfo:
    return _session


@router.delete(
    "/session",
    status_code=status.HTTP_204_NO_CONTENT,
    tags=["Session"],
    summary="Clear current session",
)
async def clear_session() -> None:
    global _session, _ocr_results
    _session = SessionInfo()
    _ocr_results = {}
    log.info("session.cleared")
