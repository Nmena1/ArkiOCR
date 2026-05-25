"""
ARKI — FastAPI Application Entry Point (Headless HTTP-only)

Endpoints:
  GET  /health
  POST /api/ocr
  POST /api/ai
  POST /api/process
  GET  /api/config/models

No WebSocket. No streaming. Standard HTTP request/response.
"""

from __future__ import annotations

import logging
import time
import uuid
from contextlib import asynccontextmanager
from typing import AsyncGenerator, Optional

import structlog
import uvicorn
from fastapi import FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from config import get_settings

# ── Logging setup ─────────────────────────────────────────────────────────────

def configure_logging(debug: bool) -> None:
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.dev.ConsoleRenderer() if debug else structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(
            logging.DEBUG if debug else logging.INFO
        ),
        context_class=dict,
        logger_factory=structlog.PrintLoggerFactory(),
    )
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)


# ── Startup tracking ──────────────────────────────────────────────────────────

_start_time: float = time.monotonic()


# ── Pydantic models ───────────────────────────────────────────────────────────

class OcrRequest(BaseModel):
    image_base64: str
    provider: Optional[str] = None
    language: Optional[str] = None


class OcrResponse(BaseModel):
    text: str
    confidence: float
    provider: str
    processing_ms: int


class AiRequest(BaseModel):
    text: str
    context: Optional[str] = None
    provider: Optional[str] = None
    model: Optional[str] = None
    mode: str = "analyze"  # 'analyze' | 'explain' | 'summarize'


class AiResponse(BaseModel):
    response: str
    model: str
    provider: str
    tokens_used: int
    processing_ms: int


class ProcessRequest(BaseModel):
    image_base64: str
    mode: str = "ocr+ai"      # 'ocr-only' | 'ocr+ai'
    ai_mode: str = "analyze"


class ProcessResponse(BaseModel):
    ocr: OcrResponse
    ai: Optional[AiResponse] = None
    total_ms: int


# ── Application lifespan ──────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    settings = get_settings()
    log = structlog.get_logger("arki.startup")
    log.info("ARKI starting", version=settings.app_version, debug=settings.debug)

    # Preload OCR pipeline to avoid cold-start latency on first request
    try:
        from ocr.pipeline import OcrPipeline, OcrConfig
        config = OcrConfig(settings)
        pipeline = OcrPipeline(config)
        await pipeline.preload()
        app.state.ocr_pipeline = pipeline
        log.info("ocr.preloaded", provider=settings.ocr_provider)
    except Exception as e:
        log.warning("ocr.preload_failed", error=str(e))
        app.state.ocr_pipeline = None

    # Store AI orchestrator (lazy init is fine for AI)
    from ai.orchestrator import AiOrchestrator
    app.state.ai_orchestrator = AiOrchestrator(settings)

    log.info(
        "ARKI ready",
        host=settings.host,
        port=settings.port,
        ocr_provider=settings.ocr_provider,
        ai_provider=settings.ai_provider,
    )

    yield

    log.info("ARKI shutdown complete")


# ── App factory ───────────────────────────────────────────────────────────────

def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(settings.debug)

    app = FastAPI(
        title="ARKI Backend",
        description="ARKI — Headless AI OCR Assistant",
        version=settings.app_version,
        docs_url="/docs" if settings.debug else None,
        redoc_url="/redoc" if settings.debug else None,
        openapi_url="/openapi.json" if settings.debug else None,
        lifespan=lifespan,
    )

    # ── CORS (localhost only) ─────────────────────────────────────────────────
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://localhost:3000",
            "http://localhost:5173",
            "http://127.0.0.1:3000",
            "http://127.0.0.1:5173",
        ],
        allow_credentials=False,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Content-Type", "X-Request-Id"],
        max_age=600,
    )

    # ── Security headers middleware ───────────────────────────────────────────
    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Cache-Control"] = "no-store"
        response.headers.pop("server", None)
        return response

    # ── Request ID middleware ─────────────────────────────────────────────────
    @app.middleware("http")
    async def request_id_middleware(request: Request, call_next):
        request_id = request.headers.get("X-Request-Id") or str(uuid.uuid4())
        structlog.contextvars.bind_contextvars(request_id=request_id)
        response = await call_next(request)
        response.headers["X-Request-Id"] = request_id
        structlog.contextvars.clear_contextvars()
        return response

    # ── Global exception handler ──────────────────────────────────────────────
    @app.exception_handler(Exception)
    async def global_exception_handler(request: Request, exc: Exception):
        _log = structlog.get_logger("arki.error")
        _log.error("unhandled_exception", path=request.url.path, error=str(exc))
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={"detail": "Internal server error"},
        )

    # ── Routes ────────────────────────────────────────────────────────────────

    @app.get("/health", tags=["Health"])
    async def health():
        uptime = time.monotonic() - _start_time
        return {
            "status": "ok",
            "version": get_settings().app_version,
            "uptime_s": round(uptime, 2),
        }

    @app.post("/api/ocr", response_model=OcrResponse, tags=["OCR"])
    async def ocr(req: OcrRequest, request: Request) -> OcrResponse:
        _log = structlog.get_logger("arki.routes.ocr")
        settings = get_settings()

        pipeline = getattr(request.app.state, "ocr_pipeline", None)
        if pipeline is None:
            from ocr.pipeline import OcrPipeline, OcrConfig
            pipeline = OcrPipeline(OcrConfig(settings))

        try:
            result = await pipeline.process(
                image_base64=req.image_base64,
                provider_override=req.provider,
                language=req.language,
            )
        except ValueError as e:
            raise HTTPException(status_code=422, detail=str(e))
        except Exception as e:
            _log.error("ocr_failed", error=str(e))
            raise HTTPException(status_code=500, detail=f"OCR processing failed: {e}")

        return OcrResponse(
            text=result.text,
            confidence=result.confidence,
            provider=result.provider,
            processing_ms=result.processing_ms,
        )

    @app.post("/api/ai", response_model=AiResponse, tags=["AI"])
    async def ai(req: AiRequest, request: Request) -> AiResponse:
        _log = structlog.get_logger("arki.routes.ai")

        orchestrator = getattr(request.app.state, "ai_orchestrator", None)
        if orchestrator is None:
            from ai.orchestrator import AiOrchestrator
            orchestrator = AiOrchestrator(get_settings())

        if req.mode not in ("analyze", "explain", "summarize"):
            raise HTTPException(
                status_code=422,
                detail=f"Invalid mode {req.mode!r}. Must be one of: analyze, explain, summarize",
            )

        try:
            result = await orchestrator.process(
                text=req.text,
                context=req.context,
                mode=req.mode,
                provider_override=req.provider,
                model_override=req.model,
            )
        except Exception as e:
            _log.error("ai_failed", error=str(e))
            raise HTTPException(status_code=500, detail=f"AI processing failed: {e}")

        return AiResponse(
            response=result.response,
            model=result.model,
            provider=result.provider,
            tokens_used=result.tokens_used,
            processing_ms=result.processing_ms,
        )

    @app.post("/api/process", response_model=ProcessResponse, tags=["Process"])
    async def process(req: ProcessRequest, request: Request) -> ProcessResponse:
        _log = structlog.get_logger("arki.routes.process")
        settings = get_settings()
        t0 = time.perf_counter()

        # --- OCR step ---
        pipeline = getattr(request.app.state, "ocr_pipeline", None)
        if pipeline is None:
            from ocr.pipeline import OcrPipeline, OcrConfig
            pipeline = OcrPipeline(OcrConfig(settings))

        try:
            ocr_result = await pipeline.process(image_base64=req.image_base64)
        except ValueError as e:
            raise HTTPException(status_code=422, detail=str(e))
        except Exception as e:
            _log.error("process_ocr_failed", error=str(e))
            raise HTTPException(status_code=500, detail=f"OCR step failed: {e}")

        ocr_resp = OcrResponse(
            text=ocr_result.text,
            confidence=ocr_result.confidence,
            provider=ocr_result.provider,
            processing_ms=ocr_result.processing_ms,
        )

        # --- AI step (optional) ---
        ai_resp: Optional[AiResponse] = None
        if req.mode == "ocr+ai":
            orchestrator = getattr(request.app.state, "ai_orchestrator", None)
            if orchestrator is None:
                from ai.orchestrator import AiOrchestrator
                orchestrator = AiOrchestrator(settings)

            try:
                ai_result = await orchestrator.process(
                    text=ocr_result.text,
                    mode=req.ai_mode,
                )
                ai_resp = AiResponse(
                    response=ai_result.response,
                    model=ai_result.model,
                    provider=ai_result.provider,
                    tokens_used=ai_result.tokens_used,
                    processing_ms=ai_result.processing_ms,
                )
            except Exception as e:
                _log.error("process_ai_failed", error=str(e))
                # AI failure is non-fatal in combined mode — return OCR result only
                _log.warning("process_ai_skipped_returning_ocr_only")

        total_ms = int((time.perf_counter() - t0) * 1000)
        return ProcessResponse(ocr=ocr_resp, ai=ai_resp, total_ms=total_ms)

    @app.get("/api/config/models", tags=["Config"])
    async def config_models(request: Request):
        orchestrator = getattr(request.app.state, "ai_orchestrator", None)
        if orchestrator is None:
            from ai.orchestrator import AiOrchestrator
            orchestrator = AiOrchestrator(get_settings())

        models = await orchestrator.list_models()
        return models

    return app


# ── App instance ──────────────────────────────────────────────────────────────

app = create_app()


if __name__ == "__main__":
    settings = get_settings()
    uvicorn.run(
        "main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.debug,
        log_level=settings.log_level,
        access_log=settings.debug,
    )
