"""
ARKI — WebSocket Server
Manages real-time bidirectional communication with the Electron renderer.
"""

from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone
from typing import Any

import structlog
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from api.models import WsMessage

ws_router = APIRouter()
log       = structlog.get_logger("arki.websocket")


class ConnectionManager:
    """Manages active WebSocket connections (one per Electron window)."""

    def __init__(self):
        self._connections: list[WebSocket] = []
        self._lock = asyncio.Lock()

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        async with self._lock:
            self._connections.append(ws)
        log.info("ws.connected", total=len(self._connections))

    async def disconnect(self, ws: WebSocket) -> None:
        async with self._lock:
            self._connections = [c for c in self._connections if c is not ws]
        log.info("ws.disconnected", total=len(self._connections))

    async def disconnect_all(self) -> None:
        async with self._lock:
            for ws in list(self._connections):
                try:
                    await ws.close()
                except Exception:
                    pass
            self._connections = []

    async def broadcast(self, message_type: str, payload: dict[str, Any]) -> None:
        """Send a message to all connected renderers."""
        message = {
            "type":      message_type,
            "payload":   payload,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        data = json.dumps(message)

        broken: list[WebSocket] = []
        async with self._lock:
            connections = list(self._connections)

        for ws in connections:
            try:
                await ws.send_text(data)
            except Exception as e:
                log.warning("ws.send_error", error=str(e))
                broken.append(ws)

        if broken:
            async with self._lock:
                self._connections = [c for c in self._connections if c not in broken]

    async def send_to(self, ws: WebSocket, message_type: str, payload: dict[str, Any]) -> None:
        """Send a message to a specific connection."""
        message = {
            "type":      message_type,
            "payload":   payload,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        try:
            await ws.send_text(json.dumps(message))
        except Exception as e:
            log.error("ws.send_to_error", error=str(e))

    @property
    def active_connections(self) -> int:
        return len(self._connections)


# Singleton connection manager — imported by routes when pushing events
connection_manager = ConnectionManager()


@ws_router.websocket("/ws")
async def websocket_endpoint(ws: WebSocket) -> None:
    await connection_manager.connect(ws)

    # Send initial status
    await connection_manager.send_to(ws, "backend_status", {
        "status": "ready",
        "detail": "ARKI backend connected",
    })

    try:
        while True:
            # Receive and process renderer messages
            try:
                raw = await asyncio.wait_for(ws.receive_text(), timeout=30.0)
            except asyncio.TimeoutError:
                # Send keepalive ping
                await connection_manager.send_to(ws, "backend_status", {"status": "ready"})
                continue

            try:
                message = json.loads(raw)
                msg_type = message.get("type", "unknown")
                payload  = message.get("payload", {})
                log.debug("ws.received", type=msg_type)

                # Dispatch renderer → backend messages
                if msg_type == "ping":
                    await connection_manager.send_to(ws, "pong", {"ts": datetime.now(timezone.utc).isoformat()})

            except json.JSONDecodeError:
                log.warning("ws.invalid_json")

    except WebSocketDisconnect:
        await connection_manager.disconnect(ws)
