"""
ARKI — OpenAI AI Provider
"""

from __future__ import annotations

import structlog

from ai.orchestrator import AiResult

log = structlog.get_logger("arki.ai.openai")


class OpenAIProvider:
    name = "openai"

    def __init__(self, api_key: str = "") -> None:
        self._api_key = api_key

    def _get_client(self):
        from openai import AsyncOpenAI
        return AsyncOpenAI(api_key=self._api_key)

    async def generate(
        self,
        system: str,
        user: str,
        model: str,
        max_tokens: int,
        temperature: float,
    ) -> AiResult:
        """Call OpenAI chat completions API."""
        client = self._get_client()

        response = await client.chat.completions.create(
            model=model,
            max_tokens=max_tokens,
            temperature=temperature,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        )

        content = response.choices[0].message.content or ""
        tokens_used = response.usage.total_tokens if response.usage else 0

        log.info(
            "openai.generate",
            model=model,
            tokens_used=tokens_used,
        )

        return AiResult(
            response=content,
            model=model,
            provider=self.name,
            tokens_used=tokens_used,
            processing_ms=0,  # set by orchestrator
        )

    async def list_models(self) -> list[str]:
        return ["gpt-4o-mini", "gpt-4o", "gpt-4-turbo"]
