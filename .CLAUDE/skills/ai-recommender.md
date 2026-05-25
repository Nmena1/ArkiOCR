# Skill: ai-recommender

## Propósito
Generar recomendaciones técnicas accionables para Noel en <3 segundos,
usando exclusivamente trigger-based inference. Nunca polling.

---

## REGLAS OBLIGATORIAS

1. **Solo trigger-based.** Nunca llamar al modelo por timer o polling.
2. **Cooldown mínimo 30 segundos** entre llamadas (no aplica a triggers CRITICAL).
3. **gpt-4o-mini** para todos los triggers realtime (latencia objetivo: <1.5s).
4. **gpt-4o** solo bajo demanda manual explícita desde la UI (botón "Análisis profundo").
5. **Output siempre JSON estructurado.** El frontend renderiza JSON, no texto libre.
6. **MAX 1000 tokens de input** por llamada. Usar payload del context engine.
7. **MAX 300 tokens de output** por llamada.
8. **Presupuesto por sesión**: alert en $0.30, hard stop en $0.50.

---

## TRIGGERS ACTIVOS

```python
# triggers/detector.py — lista canónica, no modificar sin actualizar este skill

TRIGGERS = {

    # ── CRITICAL — pueden saltarse el cooldown ──────────────────────────────
    "question_to_noel": {
        "priority": "CRITICAL",
        "latency_target_ms": 1500,
        "patterns": [
            "Noel,", "Noel?", "Noel ¿", "¿qué opinas Noel",
            "¿cómo recomiendas", "¿qué propones", "tu recomendación",
            "le pregunto a Noel", "Noel qué piensas",
            "what do you think Noel", "Noel your recommendation",
        ],
        "condition": "speaker != 'Noel' AND contains_pattern",
    },
    "silence_after_question": {
        "priority": "CRITICAL",
        "latency_target_ms": 2000,
        "condition": "question_to_noel_detected AND Noel_silent_seconds > 3",
    },

    # ── HIGH — respetar cooldown salvo que el riesgo sea muy claro ──────────
    "architectural_risk": {
        "priority": "HIGH",
        "patterns": [
            "DB link", "database link", "conexión directa a base",
            "sin API", "acceso directo", "without API",
            "monolito", "sin versionamiento", "sin retry",
            "sin circuit breaker", "tight coupling", "acoplamiento fuerte",
            "sin capa de abstracción",
        ],
    },
    "security_risk": {
        "priority": "HIGH",
        "patterns": [
            "sin TLS", "HTTP ", "sin cifrado", "without encryption",
            "contraseña en código", "password in code", "hardcoded credential",
            "sin autenticación", "acceso sin token", "sin validación",
            "credenciales en config", "sin MFA",
        ],
    },

    # ── MEDIUM — respetar cooldown siempre ─────────────────────────────────
    "bad_practice": {
        "priority": "MEDIUM",
        "patterns": [
            "sync calls", "polling", "sin logging", "sin monitoreo",
            "deploy manual", "sin IaC", "sin pruebas", "no tests",
            "sin observabilidad", "sin alertas",
        ],
    },
    "contradiction_detected": {
        "priority": "MEDIUM",
        "condition": "current_statement contradicts earlier_decision in context",
    },

    # ── LOW — solo si no hubo trigger reciente ──────────────────────────────
    "improvement_opportunity": {
        "priority": "LOW",
        "patterns": [
            "hay problemas con", "no funciona bien", "es lento",
            "se cae seguido", "no escala", "difícil de mantener",
        ],
    },
}
```

---

## PATRONES ESTABLECIDOS

### System prompt (canónico — no modificar sin benchmark)
```python
SYSTEM_PROMPT = """
Eres un copiloto técnico silencioso para Noel (Solutions Architect senior).
Analizas fragmentos de reuniones técnicas enterprise/gubernamentales en tiempo real.

REGLAS:
- Responde SOLO con JSON válido. Sin markdown, sin texto fuera del JSON.
- Sé conciso. El usuario leerá esto en segundos mientras está en una reunión.
- Prioriza accionabilidad sobre exhaustividad.

FORMATO OBLIGATORIO:
{
  "type": "question_response | risk_alert | recommendation | question_suggestion",
  "urgency": "critical | high | medium | low",
  "headline": "<10 palabras — lo primero que Noel lee>",
  "content": "<recomendación principal, máx 60 palabras>",
  "supporting_points": ["<punto 1>", "<punto 2>", "<punto 3 opcional>"],
  "suggested_question": "<pregunta que Noel puede hacer ahora, opcional>",
  "patterns": ["<patrón arquitectónico relevante, opcional>"],
  "risks": ["<riesgo a mencionar, opcional>"]
}
"""
```

### User prompt template
```python
USER_PROMPT_TEMPLATE = """
TEMA: {meeting_topic}
MODO: {audio_mode}

RESUMEN:
{rolling_summary}

ÚLTIMOS MINUTOS:
{active_window}

TRIGGER: {trigger_type}
FRAGMENTO: "{trigger_text}"

Genera recomendación inmediata para Noel.
"""
```

### AIRecommender con cooldown y cost tracking
```python
class AIRecommender:
    def __init__(self, config: Config):
        self.last_call_ts: float = 0
        self.cooldown_s: int = config.trigger_cooldown_seconds  # default: 30
        self.session_cost: float = 0.0
        self.client = AsyncOpenAI(api_key=config.openai_api_key)

    async def recommend(
        self,
        trigger: dict,
        context_payload: str,
    ) -> dict | None:

        # Hard stop por presupuesto
        if self.session_cost >= config.session_cost_max_usd:
            logger.warning("Presupuesto de sesión alcanzado. Recomendaciones pausadas.")
            return None

        # Cooldown (CRITICAL lo omite)
        now = time.time()
        is_critical = trigger["priority"] == "CRITICAL"
        if not is_critical and (now - self.last_call_ts) < self.cooldown_s:
            return None

        self.last_call_ts = now

        response = await self.client.chat.completions.create(
            model="gpt-4o-mini",
            max_tokens=300,
            temperature=0.3,      # respuestas consistentes, no creativas
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user",   "content": context_payload},
            ],
        )

        self._track_cost(response.usage)
        return json.loads(response.choices[0].message.content)

    def _track_cost(self, usage):
        # gpt-4o-mini pricing (actualizar si cambia)
        input_cost  = (usage.prompt_tokens     / 1_000_000) * 0.15
        output_cost = (usage.completion_tokens / 1_000_000) * 0.60
        self.session_cost += input_cost + output_cost
        logger.info(f"Costo acumulado sesión: ${self.session_cost:.4f}")
```

---

## EJEMPLOS DE OUTPUT ESPERADO

```json
// Pregunta dirigida a Noel sobre autenticación
{
  "type": "question_response",
  "urgency": "critical",
  "headline": "Autenticación entre instituciones → Federación IAM",
  "content": "Recomendar OIDC + federación IAM con API Gateway como punto de control central. Separar trust boundaries por tenant.",
  "supporting_points": [
    "Validar token expiration y refresh strategy",
    "Definir trust boundaries entre instituciones",
    "Asegurar tenant isolation en el API Gateway"
  ],
  "suggested_question": "¿Cuál es el modelo de confianza entre las instituciones participantes?",
  "patterns": ["Federated Identity", "API Gateway Pattern", "Zero Trust"]
}

// Riesgo de acoplamiento fuerte detectado
{
  "type": "risk_alert",
  "urgency": "high",
  "headline": "⚠️ Acoplamiento fuerte: DB links = riesgo alto",
  "content": "Conexión directa entre BD de SAP y el sistema destino genera acoplamiento fuerte, dificulta versionamiento y falla en cascada.",
  "supporting_points": [
    "Evaluar APIs desacopladas o event-driven integration",
    "DB links imposibilitan escalar o cambiar tecnología independientemente",
    "Riesgo de propagación de fallos entre sistemas"
  ],
  "suggested_question": "¿Cómo manejarán versionamiento y resiliencia si SAP cambia su esquema?",
  "risks": ["Tight coupling", "Single point of failure", "No versioning strategy"]
}
```

---

## ANTI-PATTERNS

- ❌ Llamar al modelo cada N segundos (polling)
- ❌ Texto libre en el output (siempre JSON)
- ❌ Usar `gpt-4o` para triggers realtime
- ❌ Ignorar cooldown para triggers MEDIUM o LOW
- ❌ No trackear costo por sesión
- ❌ Continuar recomendaciones cuando se supera el presupuesto

---

## DEPENDENCIAS FIJADAS

```
openai>=1.30.0
tiktoken>=0.5.0
```

---

## DECISIONES CERRADAS

| Qué | Decisión |
|-----|----------|
| Modelo realtime | gpt-4o-mini |
| Modelo análisis profundo | gpt-4o (solo manual) |
| Output format | JSON estructurado siempre |
| Cooldown | 30s (MEDIUM/LOW), 0s (CRITICAL) |
| Presupuesto alert | $0.30/sesión |
| Presupuesto hard stop | $0.50/sesión |
| Temperature | 0.3 (consistencia > creatividad) |
