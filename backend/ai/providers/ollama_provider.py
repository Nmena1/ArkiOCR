"""
ARKI — Ollama AI Provider

Local inference via Ollama HTTP API.
Privacy-first: no data leaves the machine.
"""

from __future__ import annotations

import structlog

from ai.orchestrator import AiResult

log = structlog.get_logger("arki.ai.ollama")


class OllamaProvider:
    name = "ollama"

    def __init__(self, base_url: str = "http://127.0.0.1:11434") -> None:
        self.base_url = base_url.rstrip("/")

    async def generate(
        self,
        system: str,
        user: str,
        model: str,
        max_tokens: int,
        temperature: float,
    ) -> AiResult:
        """
        POST /api/generate with stream=false.
        Handles connection refused gracefully (Ollama not running).
        """
        import httpx

        payload = {
            "model": model,
            "prompt": user,
            "system": system,
            "stream": False,
            "options": {
                "num_predict": max_tokens,
                "temperature": temperature,
            },
        }

        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                response = await client.post(
                    f"{self.base_url}/api/generate",
                    json=payload,
                )
                response.raise_for_status()
                data = response.json()
        except httpx.ConnectError as e:
            raise RuntimeError(
                f"Ollama is not running at {self.base_url}. "
                "Start it with: ollama serve"
            ) from e

        return AiResult(
            response=data.get("response", ""),
            model=model,
            provider=self.name,
            tokens_used=data.get("eval_count", 0),
            processing_ms=0,  # set by orchestrator
        )

    async def list_models(self) -> list[str]:
        """GET /api/tags → list of model names. Returns [] on connection error."""
        import httpx

        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(f"{self.base_url}/api/tags")
                response.raise_for_status()
                data = response.json()
                return [m["name"] for m in data.get("models", [])]
        except Exception as e:
            log.warning("ollama.list_models_failed", error=str(e))
            return []
