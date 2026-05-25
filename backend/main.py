"""
ARKI — FastAPI Application Entry Point

Startup sequence:
1. Load settings
2. Configure structured logging
3. Initialize database
4. Mount REST routes
5. Mount WebSocket endpoint
6. Start OCR + AI service warmup (background task)
"""

from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from typing import AsyncGenerator

import structlog
import uvicorn
from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from config import get_settings
from api.routes import router as api_router
from api.websocket import ws_router, connection_manager

# ── Logging setup ─────────────────────────────────────────────────────────────

def configure_logging(log_level: str) -> None:
    """Configure structlog for JSON-structured logging."""
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.dev.ConsoleRenderer()
            if get_settings().is_development
            else structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(
            getattr(logging, log_level.upper(), logging.INFO)
        ),
        context_class=dict,
        logger_factory=structlog.PrintLoggerFactory(),
    )

    # Quiet down noisy libraries
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    logging.getLogger("websockets").setLevel(logging.WARNING)


# ── Application lifespan ──────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Startup and shutdown lifecycle manager."""
    settings = get_settings()
    log = structlog.get_logger("arki.startup")

    # ── Startup ────────────────────────────────────────────────────────────────
    log.info("ARKI starting", env=settings.app_env, version=settings.app_version)

    # Ensure data directory exists
    settings.db_path.parent.mkdir(parents=True, exist_ok=True)

    # Validate OCR provider availability
    try:
        from ocr.interface import get_ocr_service
        ocr_service = get_ocr_service(settings)
        available = await ocr_service.check_availability()
        if not available:
            log.warning("OCR provider unavailable at startup", provider=settings.ocr_provider)
        else:
            log.info("OCR provider ready", provider=settings.ocr_provider)
    except Exception as e:
        log.error("OCR initialization error", error=str(e))

    # Validate AI provider availability
    try:
        from ai.interface import get_ai_service
        ai_service = get_ai_service(settings)
        available = await ai_service.check_availability()
        if not available:
            log.warning("AI provider unavailable at startup", provider=settings.ai_provider)
        else:
            log.info("AI provider ready", provider=settings.ai_provider)
    except Exception as e:
        log.error("AI initialization error", error=str(e))

    log.info(
        "ARKI ready",
        host=settings.backend_host,
        port=settings.backend_port,
        ocr=settings.ocr_provider,
        ai=settings.ai_provider,
    )

    yield  # ← Application runs here

    # ── Shutdown ───────────────────────────────────────────────────────────────
    log.info("ARKI shutting down...")
    await connection_manager.disconnect_all()
    log.info("ARKI shutdown complete")


# ── FastAPI app factory ───────────────────────────────────────────────────────

def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(settings.log_level)

    app = FastAPI(
        title="ARKI Backend",
        description="ARKI — Enterprise AI Desktop Assistant API",
        version=settings.app_version,
        # Disable docs in production (no swagger/redoc exposed)
        docs_url="/docs" if settings.is_development else None,
        redoc_url="/redoc" if settings.is_development else None,
        openapi_url="/openapi.json" if settings.is_development else None,
        lifespan=lifespan,
    )

    # ── CORS ───────────────────────────────────────────────────────────────────
    # Only allow Electron renderer origins (localhost in dev)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Content-Type", "X-Request-Id"],
        max_age=600,
    )

    # ── Security headers middleware ────────────────────────────────────────────
    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"]        = "DENY"
        response.headers["Cache-Control"]          = "no-store"
        # Never expose server tech
        response.headers.pop("server", None)
        return response

    # ── Request ID middleware ──────────────────────────────────────────────────
    @app.middleware("http")
    async def request_id_middleware(request: Request, call_next):
        import uuid
        request_id = request.headers.get("X-Request-Id") or str(uuid.uuid4())
        structlog.contextvars.bind_contextvars(request_id=request_id)
        response = await call_next(request)
        response.headers["X-Request-Id"] = request_id
        structlog.contextvars.clear_contextvars()
        return response

    # ── Global exception handler ───────────────────────────────────────────────
    @app.exception_handler(Exception)
    async def global_exception_handler(request: Request, exc: Exception):
        log = structlog.get_logger("arki.error")
        log.error("Unhandled exception", path=request.url.path, error=str(exc))
        # Never expose internal details to client
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={
                "type": "https://arki.local/errors/internal",
                "title": "Internal Server Error",
                "status": 500,
                "detail": "An unexpected error occurred",
            },
        )

    # ── Routes ─────────────────────────────────────────────────────────────────
    app.include_router(api_router, prefix="/api")
    app.include_router(ws_router)

    # ── Health check (root) ────────────────────────────────────────────────────
    @app.get("/health", tags=["Health"])
    async def health():
        from datetime import datetime, timezone
        settings = get_settings()
        return {
            "status": "ok",
            "version": settings.app_version,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    return app


# ── App instance ──────────────────────────────────────────────────────────────
app = create_app()


if __name__ == "__main__":
    settings = get_settings()
    uvicorn.run(
        "main:app",
        host=settings.backend_host,
        port=settings.backend_port,
        reload=settings.is_development,
        log_level=settings.log_level,
        access_log=settings.is_development,
    )
