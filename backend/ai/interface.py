"""
ARKI — AI Service Abstraction Layer

Architecture: Strategy Pattern
- AIService (abstract base)
  ├── OpenAIService   (cloud: gpt-4o-mini / gpt-4o)
  └── OllamaService   (local: llama3.2 / llama3.2:70b)

Rules from skills/ai-recommender.md:
- gpt-4o-mini for MINI tier (fast, <1.5s target)
- gpt-4o for FULL tier (deep, manual only)
- Always JSON-structured output
- Track cost per session
- Hard stop at $0.50/session
- Temperature: 0.3 (consistency > creativity)
"""

from __future__ import annotations

import abc
import json
import time
from typing import Optional

import structlog

from api.models import AIResponse, AIResponseType, CodeBlock, OCRResult

log = structlog.get_logger("arki.ai")


# ── System Prompt ──────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """You are ARKI, an expert technical AI assistant.
You analyze captured screen content (OCR output) and provide clear, educational responses.

RESPONSE RULES:
- Respond ONLY with valid JSON. No markdown, no text outside JSON.
- Be concise but complete. Users read this in a desktop overlay.
- Prioritize actionability and educational value.
- For code: explain what it does, then how to improve it.
- For math: show step-by-step reasoning.
- For errors: identify root cause and provide fix.

REQUIRED JSON FORMAT:
{
  "type": "explanation | solution | optimization | translation | math_solution | code_review | error",
  "headline": "<10 words — first thing user reads>",
  "content": "<main response, markdown allowed, max 300 words>",
  "supporting_points": ["<point 1>", "<point 2>"],
  "code_blocks": [{"language": "python", "code": "...", "explanation": "..."}],
  "suggested_follow_up": "<optional question to explore further>"
}"""


# ── Abstract Base ──────────────────────────────────────────────────────────────

class AIService(abc.ABC):
    """Abstract AI service. All providers implement this interface."""

    @property
    @abc.abstractmethod
    def provider_name(self) -> str:
        ...

    @abc.abstractmethod
    async def check_availability(self) -> bool:
        ...

    @abc.abstractmethod
    async def _call_model(
        self,
        prompt: str,
        model_tier: str,
        max_tokens: int,
    ) -> tuple[str, int, int]:
        """
        Call the model with a prompt.
        Returns: (response_text, input_tokens, output_tokens)
        """
        ...

    async def analyze(
        self,
        ocr_result: OCRResult,
        analysis_type: str = "explain",
        context: Optional[str] = None,
        model_tier: str = "mini",
    ) -> AIResponse:
        """
        Run AI analysis on an OCR result.
        Never raises — errors are captured in AIResponse.error.
        """
        try:
            prompt = self._build_prompt(ocr_result, analysis_type, context)
            t0 = time.perf_counter()

            response_text, input_tokens, output_tokens = await self._call_model(
                prompt=prompt,
                model_tier=model_tier,
                max_tokens=500 if model_tier == "full" else 300,
            )

            latency_ms = int((time.perf_counter() - t0) * 1000)
            parsed = self._parse_response(response_text)

            cost = self._calculate_cost(input_tokens, output_tokens, model_tier)

            return AIResponse(
                type=AIResponseType(parsed.get("type", "explanation")),
                headline=parsed.get("headline", "Analysis complete"),
                content=parsed.get("content", response_text),
                supporting_points=parsed.get("supporting_points", []),
                code_blocks=[CodeBlock(**cb) for cb in parsed.get("code_blocks", [])],
                suggested_follow_up=parsed.get("suggested_follow_up"),
                provider=self.provider_name,
                model=self._get_model_name(model_tier),
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                latency_ms=latency_ms,
                session_cost_usd=cost,
            )

        except Exception as e:
            log.error("ai.analyze_error", provider=self.provider_name, error=str(e))
            return AIResponse(
                type=AIResponseType.ERROR,
                headline="Analysis failed",
                content=f"The AI analysis encountered an error: {e}",
                provider=self.provider_name,
                model=self._get_model_name(model_tier),
                input_tokens=0,
                output_tokens=0,
                error=str(e),
            )

    # ── Prompt builder ─────────────────────────────────────────────────────────

    @staticmethod
    def _build_prompt(
        ocr_result: OCRResult,
        analysis_type: str,
        context: Optional[str],
    ) -> str:
        content_info = f"Content Type: {ocr_result.content_type.value}"
        if ocr_result.detected_language:
            content_info += f" ({ocr_result.detected_language.value})"

        instructions = {
            "explain":   "Explain what this content does/means. Focus on clarity.",
            "solve":     "Solve the problem shown. Provide step-by-step reasoning.",
            "optimize":  "Review and optimize this code/content. Show improvements.",
            "translate": "Translate/convert this content to a different format or language.",
        }.get(analysis_type, "Analyze this content and provide insights.")

        parts = [
            f"TASK: {instructions}",
            f"{content_info}",
            f"CONTENT:\n{ocr_result.cleaned_text[:2000]}",  # Limit to 2000 chars
        ]
        if context:
            parts.append(f"ADDITIONAL CONTEXT: {context[:200]}")

        return "\n\n".join(parts)

    # ── Response parser ────────────────────────────────────────────────────────

    @staticmethod
    def _parse_response(text: str) -> dict:
        """Parse JSON response from model, with fallback."""
        # Try direct JSON parse
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            pass

        # Try extracting JSON from markdown code block
        import re
        match = re.search(r'```(?:json)?\s*(\{.*?\})\s*```', text, re.DOTALL)
        if match:
            try:
                return json.loads(match.group(1))
            except json.JSONDecodeError:
                pass

        # Fallback: wrap raw text in minimal structure
        log.warning("ai.json_parse_failed", text_preview=text[:100])
        return {
            "type": "explanation",
            "headline": "Analysis result",
            "content": text,
            "supporting_points": [],
        }

    @abc.abstractmethod
    def _get_model_name(self, model_tier: str) -> str:
        ...

    @abc.abstractmethod
    def _calculate_cost(self, input_tokens: int, output_tokens: int, model_tier: str) -> float:
        ...


# ── OpenAI Provider ───────────────────────────────────────────────────────────

class OpenAIService(AIService):
    """
    OpenAI GPT-4o-mini (MINI) / GPT-4o (FULL) provider.
    Pricing (update if changes):
      gpt-4o-mini: $0.15/1M input, $0.60/1M output
      gpt-4o:      $2.50/1M input, $10.00/1M output
    """

    # Pricing per 1M tokens
    _PRICING = {
        "mini": {"input": 0.15,  "output": 0.60},
        "full": {"input": 2.50,  "output": 10.00},
    }

    def __init__(self, config):
        from openai import AsyncOpenAI
        self._client    = AsyncOpenAI(api_key=config.openai_api_key)
        self._models    = {
            "mini": config.openai_default_model,   # gpt-4o-mini
            "full": config.openai_analysis_model,  # gpt-4o
        }
        self._temperature = config.openai_temperature
        self._api_key_set = bool(config.openai_api_key)

    @property
    def provider_name(self) -> str:
        return "openai"

    def _get_model_name(self, model_tier: str) -> str:
        return self._models.get(model_tier, self._models["mini"])

    def _calculate_cost(self, input_tokens: int, output_tokens: int, model_tier: str) -> float:
        pricing = self._PRICING.get(model_tier, self._PRICING["mini"])
        return (input_tokens / 1_000_000) * pricing["input"] + \
               (output_tokens / 1_000_000) * pricing["output"]

    async def check_availability(self) -> bool:
        if not self._api_key_set:
            log.warning("ai.openai_no_api_key")
            return False
        try:
            await self._client.models.list()
            return True
        except Exception as e:
            log.warning("ai.openai_unavailable", error=str(e))
            return False

    async def _call_model(
        self,
        prompt: str,
        model_tier: str,
        max_tokens: int,
    ) -> tuple[str, int, int]:
        model = self._get_model_name(model_tier)

        response = await self._client.chat.completions.create(
            model=model,
            max_tokens=max_tokens,
            temperature=self._temperature,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user",   "content": prompt},
            ],
        )

        content       = response.choices[0].message.content or ""
        input_tokens  = response.usage.prompt_tokens if response.usage else 0
        output_tokens = response.usage.completion_tokens if response.usage else 0

        log.info(
            "ai.openai_call",
            model=model,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cost=self._calculate_cost(input_tokens, output_tokens, model_tier),
        )

        return content, input_tokens, output_tokens


# ── Ollama Provider ───────────────────────────────────────────────────────────

class OllamaService(AIService):
    """
    Local Ollama provider (llama3.2 / llama3.2:70b).
    Privacy-first: no data leaves the machine.
    Requires Ollama running: https://ollama.ai
    Cost: $0 (local compute only)
    """

    def __init__(self, config):
        self._base_url = config.ollama_base_url.rstrip('/')
        self._models   = {
            "mini": config.ollama_default_model,   # llama3.2
            "full": config.ollama_analysis_model,  # llama3.2:70b
        }

    @property
    def provider_name(self) -> str:
        return "ollama"

    def _get_model_name(self, model_tier: str) -> str:
        return self._models.get(model_tier, self._models["mini"])

    def _calculate_cost(self, input_tokens: int, output_tokens: int, model_tier: str) -> float:
        return 0.0  # Local inference has no API cost

    async def check_availability(self) -> bool:
        import httpx
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                response = await client.get(f"{self._base_url}/api/tags")
                return response.status_code == 200
        except Exception as e:
            log.warning("ai.ollama_unavailable", error=str(e))
            return False

    async def _call_model(
        self,
        prompt: str,
        model_tier: str,
        max_tokens: int,
    ) -> tuple[str, int, int]:
        import httpx

        model = self._get_model_name(model_tier)
        full_prompt = f"{SYSTEM_PROMPT}\n\n---\n\n{prompt}"

        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                f"{self._base_url}/api/generate",
                json={
                    "model":  model,
                    "prompt": full_prompt,
                    "stream": False,
                    "options": {
                        "temperature": 0.3,
                        "num_predict": max_tokens,
                    },
                },
            )
            response.raise_for_status()
            data = response.json()

        content       = data.get("response", "")
        input_tokens  = data.get("prompt_eval_count", 0)
        output_tokens = data.get("eval_count", 0)

        log.info(
            "ai.ollama_call",
            model=model,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
        )

        return content, input_tokens, output_tokens


# ── Factory ───────────────────────────────────────────────────────────────────

def get_ai_service(config) -> AIService:
    """
    Factory: return the appropriate AI service based on config.
    AUTO mode: try Ollama first (local/free), fallback to OpenAI.
    """
    from config import AIProvider

    provider = config.ai_provider

    if provider == AIProvider.OPENAI:
        return OpenAIService(config)

    if provider == AIProvider.OLLAMA:
        return OllamaService(config)

    # AUTO: Ollama first (privacy-first, free), fallback to OpenAI
    # Actual availability is checked at runtime in the route handlers
    return OllamaService(config)
