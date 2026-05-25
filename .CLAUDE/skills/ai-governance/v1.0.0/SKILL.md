# SKILL: AI Governance — Orquestación Multi-Agent & Revisión de PRs

**Dominio:** ai-governance  
**Versión:** v1.0.0  
**Capa:** 6 — Especializado  
**Dependencias:** core/v1.0.0, platform/observability.md, security/v1.0.0  

---

## CUÁNDO CARGAR ESTE SKILL

- Diseño de sistemas multi-agent o pipelines de IA
- Revisión automatizada de Pull Requests
- Generación de documentación técnica
- Evaluación de calidad de código con IA
- Cualquier mención de: agente, LLM, orquestación, pipeline IA, RAG

---

## PATRONES DE ORQUESTACIÓN MULTI-AGENT

### Patrón 1: Orquestador + Especialistas (Más común en enterprise)

```
┌─────────────────────────────────────────────────────────────────┐
│  Orchestrator Agent (Planning + Routing)                        │
│  - Recibe tarea del usuario                                     │
│  - Determina qué agentes especialistas necesita                 │
│  - Agrega y reconcilia resultados                               │
│  - Mantiene contexto global del task                            │
└────────────────┬────────────────────────────────────────────────┘
                 │ dispatches subtasks
        ┌────────┼────────┬──────────┐
        ▼        ▼        ▼          ▼
   [Arch Agent] [Sec Agent] [Code Agent] [Docs Agent]
   Valida       Revisa      Genera       Genera
   diseño       seguridad   código       documentos
```

### Patrón 2: Pipeline Secuencial (Para flujos deterministas)

```
Input → [Parser Agent] → [Analyzer Agent] → [Generator Agent] → [Validator Agent] → Output

Cada agente tiene:
- Un único rol y responsabilidad
- Input/output tipado con schemas
- Capacidad de error con mensaje estructurado
- Timeout configurable
```

### Patrón 3: Critic + Generator (Para alta calidad)

```
Input → [Generator] → [Critic] → ¿Aprobado?
                          ↑          │ NO
                          └──────────┘ (max N iteraciones)
                                   │ SÍ
                                   ▼
                                Output
```

---

## IMPLEMENTACIÓN — AGENT FRAMEWORK BASE

```typescript
// agents/base/agent.interface.ts
export interface AgentConfig {
  name: string;
  role: string;
  model: string;               // e.g. "gemini-1.5-pro"
  maxTokens: number;
  temperature: number;         // 0 para código/técnico, 0.7 para síntesis
  timeout: number;             // ms
  retryConfig: {
    maxRetries: number;
    backoffMs: number;
  };
  skills: string[];            // Lista de skill paths a cargar
  guardrails: GuardrailConfig;
}

export interface AgentMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  metadata?: {
    agentName: string;
    timestamp: string;
    traceId: string;
    tokenCount?: number;
  };
}

export interface AgentResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
  metadata: {
    agentName: string;
    duration: number;
    tokenCount: number;
    modelUsed: string;
    traceId: string;
  };
}

// agents/base/agent.abstract.ts
export abstract class BaseAgent<TInput, TOutput> {
  protected readonly logger: StructuredLogger;
  protected readonly tracer: Tracer;
  
  constructor(
    protected readonly config: AgentConfig,
    protected readonly llmClient: LLMClient,
  ) {}
  
  async execute(input: TInput, context: ExecutionContext): Promise<AgentResult<TOutput>> {
    const span = this.tracer.startSpan(`agent.${this.config.name}.execute`);
    const startTime = Date.now();
    
    try {
      // 1. Validar input con schema
      await this.validateInput(input);
      
      // 2. Construir prompt con skills cargados
      const systemPrompt = await this.buildSystemPrompt();
      const userPrompt = this.buildUserPrompt(input, context);
      
      // 3. Aplicar guardrails antes de llamar al LLM
      await this.applyInputGuardrails(userPrompt);
      
      // 4. Llamar al LLM con retry
      const response = await this.callLLMWithRetry(systemPrompt, userPrompt);
      
      // 5. Parsear y validar output
      const parsedOutput = await this.parseOutput(response);
      
      // 6. Aplicar guardrails de output
      await this.applyOutputGuardrails(parsedOutput);
      
      // 7. Registrar en audit log
      this.auditLog({
        action: 'agent_execution',
        agentName: this.config.name,
        inputSummary: this.summarizeInput(input),
        outputSummary: this.summarizeOutput(parsedOutput),
        duration: Date.now() - startTime,
      });
      
      span.setStatus({ code: SpanStatusCode.OK });
      
      return {
        success: true,
        data: parsedOutput,
        metadata: {
          agentName: this.config.name,
          duration: Date.now() - startTime,
          tokenCount: response.usage.totalTokens,
          modelUsed: this.config.model,
          traceId: context.traceId,
        },
      };
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
      this.logger.error(`Agent ${this.config.name} failed`, error);
      
      return {
        success: false,
        error: {
          code: error.code || 'AGENT_ERROR',
          message: error.message,
          retryable: this.isRetryableError(error),
        },
        metadata: {
          agentName: this.config.name,
          duration: Date.now() - startTime,
          tokenCount: 0,
          modelUsed: this.config.model,
          traceId: context.traceId,
        },
      };
    } finally {
      span.end();
    }
  }
  
  protected abstract buildUserPrompt(input: TInput, context: ExecutionContext): string;
  protected abstract parseOutput(response: LLMResponse): Promise<TOutput>;
  protected abstract validateInput(input: TInput): Promise<void>;
}
```

---

## AGENTE ESPECIALIZADO — PR REVIEWER

```typescript
// agents/pr-reviewer/pr-reviewer.agent.ts

interface PRReviewInput {
  prTitle: string;
  prDescription: string;
  diff: string;           // git diff del PR
  changedFiles: string[];
  targetBranch: string;
  repoContext: string;    // README, arquitectura, convenciones
}

interface PRReviewOutput {
  summary: string;
  decision: 'APPROVE' | 'REQUEST_CHANGES' | 'NEEDS_DISCUSSION';
  securityFindings: SecurityFinding[];
  codeQuality: CodeQualityIssue[];
  architectureNotes: string[];
  suggestedImprovements: Improvement[];
  estimatedRisk: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}

@Injectable()
export class PRReviewerAgent extends BaseAgent<PRReviewInput, PRReviewOutput> {
  
  protected async buildSystemPrompt(): Promise<string> {
    // Cargar skills relevantes para revisión de código
    const coreSkill = await loadSkill('core/v1.0.0/SKILL.md');
    const securitySkill = await loadSkill('security/v1.0.0/vulnerability-review.md');
    const codeReviewSkill = await loadSkill('development/v1.0.0/code-review.md');
    const apiSkill = await loadSkill('architecture/v1.0.0/api-design.md');
    
    return `
${coreSkill}

## Tu rol en esta tarea
Eres un Staff Engineer revisando un Pull Request. Tu revisión debe ser:
- Técnicamente rigurosa y específica
- Constructiva (señalar problema + solución)
- Priorizada (CRITICAL > HIGH > MEDIUM > LOW)
- Basada en evidencia (citar líneas específicas del diff)

## Criterios de evaluación

### CRITICAL (bloquear merge):
- Vulnerabilidades de seguridad (inyección, auth bypass, secretos expuestos)
- Data loss sin mecanismo de recuperación
- Breaking change sin versionado
- Tests ausentes en código de negocio crítico

### HIGH (request changes):
- Violaciones de patrones arquitecturales del proyecto
- Código sin manejo de errores en paths críticos
- Race conditions o problemas de concurrencia
- Violaciones de principio de mínimo privilegio

### MEDIUM (sugerencia fuerte):
- Código duplicado significativo
- Complejidad ciclomática alta (> 10)
- Falta de observabilidad en operaciones clave
- Nombres de variables/funciones poco descriptivos

### LOW (opcional):
- Mejoras de legibilidad
- Optimizaciones menores
- Documentación adicional

${securitySkill}
${codeReviewSkill}
`;
  }
  
  protected buildUserPrompt(input: PRReviewInput): string {
    return `
## PR a revisar: "${input.prTitle}"

**Descripción:**
${input.prDescription}

**Rama destino:** ${input.targetBranch}

**Archivos modificados (${input.changedFiles.length}):**
${input.changedFiles.map(f => `- ${f}`).join('\n')}

**Contexto del repositorio:**
${input.repoContext}

**Diff completo:**
\`\`\`diff
${input.diff}
\`\`\`

## Instrucciones de output

Responde con JSON válido siguiendo exactamente esta estructura:
{
  "summary": "Descripción en 2-3 oraciones de qué hace este PR",
  "decision": "APPROVE | REQUEST_CHANGES | NEEDS_DISCUSSION",
  "estimatedRisk": "LOW | MEDIUM | HIGH | CRITICAL",
  "securityFindings": [
    {
      "severity": "CRITICAL | HIGH | MEDIUM | LOW",
      "file": "path/al/archivo.ts",
      "line": 42,
      "cwe": "CWE-89",
      "description": "Descripción del hallazgo",
      "remediation": "Código o pasos específicos para resolver"
    }
  ],
  "codeQuality": [
    {
      "severity": "HIGH | MEDIUM | LOW",
      "file": "path/al/archivo.ts",
      "line": 100,
      "rule": "nombre-de-regla",
      "description": "Descripción del problema",
      "suggestion": "Código sugerido"
    }
  ],
  "architectureNotes": ["nota 1", "nota 2"],
  "suggestedImprovements": [
    {
      "priority": "HIGH | MEDIUM | LOW",
      "description": "Descripción de la mejora",
      "rationale": "Por qué es importante"
    }
  ]
}
`;
  }
}
```

---

## GUARDRAILS DE AGENTES — POLÍTICAS

```typescript
// agents/guardrails/guardrail.service.ts

export class GuardrailService {
  
  // Guardrails de INPUT
  async validateInput(prompt: string, agentRole: string): Promise<void> {
    
    // 1. Detectar prompt injection
    const injectionPatterns = [
      /ignore previous instructions/i,
      /disregard your system prompt/i,
      /act as .* without restrictions/i,
      /DAN mode/i,
      /jailbreak/i,
    ];
    
    if (injectionPatterns.some(p => p.test(prompt))) {
      throw new GuardrailViolationError('Posible prompt injection detectado', 'INJECTION_ATTEMPT');
    }
    
    // 2. Detectar exfiltración de datos
    if (prompt.includes('send to') && prompt.includes('http')) {
      throw new GuardrailViolationError('Posible exfiltración de datos', 'DATA_EXFILTRATION');
    }
    
    // 3. Validar tamaño del contexto
    const tokenCount = estimateTokens(prompt);
    if (tokenCount > 100000) {
      throw new GuardrailViolationError('Contexto excede límite permitido', 'CONTEXT_TOO_LARGE');
    }
  }
  
  // Guardrails de OUTPUT
  async validateOutput(output: string, agentRole: string): Promise<void> {
    
    // 1. Nunca retornar secretos o credenciales
    const secretPatterns = [
      /[A-Za-z0-9+/]{40,}={0,2}/,  // Base64 largo (posible API key)
      /-----BEGIN (RSA |EC )?PRIVATE KEY-----/,
      /AIza[0-9A-Za-z-_]{35}/,  // Google API Key
      /ghp_[0-9A-Za-z]{36}/,    // GitHub PAT
    ];
    
    if (secretPatterns.some(p => p.test(output))) {
      this.logger.error('Output contiene posible secreto — BLOQUEADO');
      throw new GuardrailViolationError('Output contiene datos sensibles', 'SECRET_IN_OUTPUT');
    }
    
    // 2. Para agentes de código: no ejecutar comandos destructivos
    if (agentRole === 'code-generator') {
      const dangerousPatterns = [
        /rm -rf/,
        /DROP TABLE/i,
        /DELETE FROM.*WHERE\s+1=1/i,
        /format c:/i,
      ];
      
      if (dangerousPatterns.some(p => p.test(output))) {
        throw new GuardrailViolationError('Código potencialmente destructivo detectado', 'DANGEROUS_CODE');
      }
    }
  }
}
```

---

## DOCUMENTACIÓN TÉCNICA — REGLAS DE GENERACIÓN

```
## Estándares para documentación generada por agente

### ADR (Architecture Decision Records)
Cada decisión técnica significativa genera un ADR:

Archivo: docs/adr/ADR-{NNN}-{titulo-kebab}.md

Contenido obligatorio:
- Número correlativo
- Fecha
- Estado: [Proposed | Accepted | Deprecated | Superseded by ADR-XXX]
- Contexto: ¿Qué problema estamos resolviendo?
- Decisión: ¿Qué decidimos?
- Consecuencias: Trade-offs, impacto positivo y negativo
- Alternativas consideradas
- Referencias

### README de Servicio
Secciones obligatorias:
1. Propósito y contexto de negocio
2. Arquitectura (diagrama o descripción)
3. Dependencias y requisitos
4. Configuración (variables de entorno con descripción)
5. Cómo ejecutar localmente
6. Cómo ejecutar tests
7. API Reference (o link a OpenAPI)
8. Despliegue
9. Monitoreo y alertas
10. Contacto del equipo

### Comentarios en código
Reglas:
✅ Comentar el "POR QUÉ", no el "QUÉ"
✅ TODO con ticket: // TODO(TICKET-123): descripción
✅ Documentar decisiones no obvias con contexto
❌ No comentar lo que el código ya dice claramente
❌ No comentarios obsoletos (mentira documental)
❌ No código comentado en prod (usar git history)
```

---

## SKILL REGISTRY — CONFIGURACIÓN YAML

```yaml
# SKILL_REGISTRY.yaml
version: "1.0"
agent_name: "enterprise-solutions-architect"
description: "Principal/Staff Solutions Architect virtual"

# Orden de carga: menor índice = carga primero
skills:
  
  core:
    required: true
    load_order: 1
    files:
      - path: core/v1.0.0/SKILL.md
        always_load: true
      - path: core/v1.0.0/security-guardrails.md
        always_load: true
    
  platform:
    required: true
    load_order: 2
    trigger_keywords:
      - gcp, kubernetes, k8s, terraform, cloud, gke
      - pipeline, ci/cd, cloud build, deploy
      - monitoring, observability, metrics, alerts
    files:
      - path: platform/v1.0.0/gcp-standards.md
      - path: platform/v1.0.0/kubernetes.md
      - path: platform/v1.0.0/terraform.md
      - path: platform/v1.0.0/devsecops.md
      - path: platform/v1.0.0/observability.md
    
  architecture:
    required: true
    load_order: 3
    trigger_keywords:
      - arquitectura, diseño, api, microservicio, servicio
      - event, kafka, pubsub, mensajería, async
      - base de datos, postgresql, redis, cache
    files:
      - path: architecture/v1.0.0/microservices.md
      - path: architecture/v1.0.0/api-design.md
      - path: architecture/v1.0.0/event-driven.md
    
  security:
    required: true
    load_order: 4
    trigger_keywords:
      - seguridad, auth, autenticación, autorización
      - jwt, token, oauth, oidc, sso
      - vulnerabilidad, cve, owasp, pentest
      - gobierno, gubernamental, dependencia, ciudadano
    files:
      - path: security/v1.0.0/oauth2-oidc.md
      - path: security/v1.0.0/zero-trust.md
      - path: security/v1.0.0/vulnerability-review.md
    
  development:
    required: false
    load_order: 5
    trigger_keywords:
      - nestjs, node, typescript, express
      - python, fastapi, django, flask
      - código, implementar, función, clase
      - test, unittest, jest, pytest
      - pr, pull request, revisión de código
    files:
      - path: development/v1.0.0/nodejs-nestjs.md
        triggers: [nestjs, node, typescript]
      - path: development/v1.0.0/python.md
        triggers: [python, fastapi, django]
      - path: development/v1.0.0/code-review.md
        triggers: [pr, pull request, review]
    
  integration:
    required: false
    load_order: 6
    trigger_keywords:
      - interoperabilidad, integración, conector
      - sat, imss, curp, rfc, gobierno, plataforma digital
      - kafka, pub/sub, event bus, mensajería
      - contrato, schema, openapi
    files:
      - path: integration/v1.0.0/gov-platforms.md
        triggers: [gobierno, gubernamental, sat, imss, curp]
      - path: integration/v1.0.0/interoperability.md
    
  ai_governance:
    required: false
    load_order: 7
    trigger_keywords:
      - agente, llm, ai, ia, chatbot, rag
      - orquestación, multi-agent, pipeline ia
      - documentación técnica, adr, diagrama
    files:
      - path: ai-governance/v1.0.0/ai-agent-orchestration.md
      - path: ai-governance/v1.0.0/pr-review.md
      - path: ai-governance/v1.0.0/docs-generation.md

model_config:
  default_model: "gemini-1.5-pro"
  temperature:
    code_generation: 0.1
    architecture_design: 0.3
    security_review: 0.0
    documentation: 0.4
    analysis: 0.2
  max_tokens: 8192
  timeout_ms: 60000

context_window_budget:
  core_skills_max_tokens: 4000
  domain_skills_max_tokens: 6000
  conversation_history_max_tokens: 8000
  response_reserved_tokens: 4000
  total_context: 32000

versioning:
  strategy: semantic
  compatibility: backward_only
  deprecation_notice_days: 90
  changelog_required: true
```
