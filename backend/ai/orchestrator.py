"""
ARKI — AI Provider Orchestrator

Provider chain: primary → fallback
Supports Ollama, OpenAI, and Claude (Anthropic).
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Optional

import structlog

log = structlog.get_logger("arki.ai.orchestrator")


# ── Result dataclass ──────────────────────────────────────────────────────────

@dataclass
class AiResult:
    response: str
    model: str
    provider: str
    tokens_used: int
    processing_ms: int


# ── System prompts ────────────────────────────────────────────────────────────

PROMPTS: dict[str, str] = {
    "analyze": """You are ARKI, an expert AI assistant analyzing screen content.
Given the OCR-extracted text, provide a concise analysis:
- What is this content?
- Key information or patterns
- Any issues, suggestions, or actions
Keep response under 200 words. Use markdown formatting.""",

    "explain": """You are ARKI. Explain the following extracted text clearly and concisely.
Focus on what it means and how it works. Under 150 words.""",

    "summarize": """You are ARKI. Summarize the key points from this text.
Use bullet points. Under 100 words.""",
}

DEFAULT_PROMPT = PROMPTS["analyze"]


# ── Orchestrator ──────────────────────────────────────────────────────────────

class AiOrchestrator:
    """
    Async AI orchestrator with primary → fallback provider chain.

    Usage:
        orchestrator = AiOrchestrator(settings)
        result = await orchestrator.process(text="...", mode="analyze")
    """

    def __init__(self, settings) -> None:
        self._settings = settings
        self._provider_cache: dict[str, object] = {}

    async def process(
        self,
        text: str,
        context: Optional[str] = None,
        mode: str = "analyze",
        provider_override: Optional[str] = None,
        model_override: Optional[str] = None,
    ) -> AiResult:
        """
        Run AI inference through the provider chain.

        Provider selection order:
        1. provider_override (if given)
        2. settings.ai_provider
        3. settings.ai_fallback_provider
        """
        system_prompt = PROMPTS.get(mode, DEFAULT_PROMPT)
        user_message = self._build_user_message(text, context)

        chain = self._build_chain(provider_override)
        last_error: Optional[Exception] = None

        for provider_name in chain:
            model = self._resolve_model(provider_name, model_override)
            try:
                provider = self._get_provider(provider_name)
                t0 = time.perf_counter()
                result = await provider.generate(
                    system=system_prompt,
                    user=user_message,
                    model=model,
                    max_tokens=self._settings.ai_max_tokens,
                    temperature=self._settings.ai_temperature,
                )
                result.processing_ms = int((time.perf_counter() - t0) * 1000)
                log.info(
                    "ai.success",
                    provider=provider_name,
                    model=result.model,
                    tokens=result.tokens_used,
                    processing_ms=result.processing_ms,
                )
                return result
            except Exception as e:
                log.warning(
                    "ai.provider_failed",
                    provider=provider_name,
                    model=model,
                    error=str(e),
                )
                last_error = e
                continue

        raise RuntimeError(
            f"All AI providers failed. Last error: {last_error}"
        ) from last_error

    async def list_models(self) -> dict[str, list[str]]:
        """Return available models keyed by provider name."""
        result: dict[str, list[str]] = {}

        for provider_name in ("ollama", "openai", "claude"):
            try:
                provider = self._get_provider(provider_name)
                models = await provider.list_models()
                result[provider_name] = models
            except Exception as e:
                log.warning("ai.list_models_failed", provider=provider_name, error=str(e))
                result[provider_name] = []

        return result

    # ── Internals ──────────────────────────────────────────────────────────────

    def _build_chain(self, override: Optional[str]) -> list[str]:
        primary = self._settings.ai_provider
        fallback = self._settings.ai_fallback_provider

        if override:
            return [override] + [p for p in [primary, fallback] if p != override]
        return [primary, fallback]

    def _resolve_model(self, provider_name: str, model_override: Optional[str]) -> str:
        if model_override:
            return model_override
        if provider_name == self._settings.ai_provider:
            return self._settings.ai_model
        if provider_name == self._settings.ai_fallback_provider:
            return self._settings.ai_fallback_model
        # Sane defaults per provider
        defaults = {
            "ollama": "llama3.2",
            "openai": "gpt-4o-mini",
            "claude": "claude-3-haiku-20240307",
        }
        return defaults.get(provider_name, "llama3.2")

    def _get_provider(self, name: str) -> object:
        if name not in self._provider_cache:
            self._provider_cache[name] = self._create_provider(name)
        return self._provider_cache[name]

    def _create_provider(self, name: str) -> object:
        if name == "ollama":
            from ai.providers.ollama_provider import OllamaProvider
            return OllamaProvider(base_url=self._settings.ai_ollama_base_url)
        if name == "openai":
            from ai.providers.openai_provider import OpenAIProvider
            return OpenAIProvider(api_key=self._settings.openai_api_key)
        if name == "claude":
            from ai.providers.claude_provider import ClaudeProvider
            return ClaudeProvider(api_key=self._settings.anthropic_api_key)
        raise ValueError(f"Unknown AI provider: {name!r}")

    @staticmethod
    def _build_user_message(text: str, context: Optional[str]) -> str:
        parts = [f"TEXT TO ANALYZE:\n{text}"]
        if context:
            parts.append(f"ADDITIONAL CONTEXT:\n{context}")
        return "\n\n".join(parts)
