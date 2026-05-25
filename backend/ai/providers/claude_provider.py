"""
ARKI — Claude (Anthropic) AI Provider
"""

from __future__ import annotations

import structlog

from ai.orchestrator import AiResult

log = structlog.get_logger("arki.ai.claude")


class ClaudeProvider:
    name = "claude"

    def __init__(self, api_key: str = "") -> None:
        self._api_key = api_key

    def _get_client(self):
        import anthropic
        return anthropic.AsyncAnthropic(api_key=self._api_key)

    async def generate(
        self,
        system: str,
        user: str,
        model: str,
        max_tokens: int,
        temperature: float,
    ) -> AiResult:
        """Call Anthropic messages API."""
        client = self._get_client()

        response = await client.messages.create(
            model=model,
            max_tokens=max_tokens,
            temperature=temperature,
            system=system,
            messages=[
                {"role": "user", "content": user},
            ],
        )

        content = response.content[0].text if response.content else ""
        tokens_used = (
            response.usage.input_tokens + response.usage.output_tokens
            if response.usage else 0
        )

        log.info(
            "claude.generate",
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
        return [
            "claude-3-haiku-20240307",
            "claude-3-5-sonnet-20241022",
            "claude-opus-4-5",
        ]
