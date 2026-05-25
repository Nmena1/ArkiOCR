# Enterprise Agent Skills — Sistema de Skills para Agente Técnico

## Visión General

Sistema modular de skills para un agente IA especializado en arquitectura enterprise y desarrollo de software. 
Diseñado para operar como **Principal/Staff Solutions Architect virtual** en entornos gubernamentales y enterprise.

---

## Estructura de Directorios

```
enterprise-agent-skills/
├── README.md                        # Este archivo (registry principal)
├── SKILL_REGISTRY.yaml              # Registro de todos los skills y metadatos
├── VERSIONING.md                    # Política de versionado
├── DEPENDENCY_GRAPH.md              # Grafo de dependencias entre skills
│
├── core/                            # Layer 0 — Siempre activos
│   └── v1.0.0/
│       ├── SKILL.md                 # Comportamiento base del agente
│       ├── agent-behavior.md        # Reglas de comportamiento
│       ├── security-guardrails.md   # Guardrails de seguridad (nunca omitir)
│       ├── context-engineering.md   # Gestión de contexto y memoria
│       └── audit-trace.md          # Auditoría y trazabilidad
│
├── platform/                        # Layer 1 — Obligatorios
│   └── v1.0.0/
│       ├── SKILL.md
│       ├── gcp-standards.md         # Estándares GCP enterprise
│       ├── kubernetes.md            # K8s patterns y validaciones
│       ├── terraform.md             # IaC estándares y módulos
│       ├── devsecops.md             # Pipeline y prácticas DevSecOps
│       └── observability.md        # Observabilidad, métricas, trazas
│
├── architecture/                    # Layer 2 — Obligatorios
│   └── v1.0.0/
│       ├── SKILL.md
│       ├── microservices.md         # Patrones de microservicios
│       ├── event-driven.md          # EDA, mensajería, event sourcing
│       ├── api-design.md            # Diseño de APIs REST/GraphQL/gRPC
│       ├── distributed-systems.md  # Sistemas distribuidos
│       └── data-patterns.md        # Patrones de datos y persistencia
│
├── security/                        # Layer 3 — Obligatorios
│   └── v1.0.0/
│       ├── SKILL.md
│       ├── oauth2-oidc.md           # OAuth2, OIDC, JWT
│       ├── zero-trust.md            # Arquitectura Zero Trust
│       ├── secrets-management.md   # Gestión de secretos
│       ├── vulnerability-review.md # Revisión de vulnerabilidades
│       └── compliance-governance.md # Compliance y gobernanza
│
├── development/                     # Layer 4 — Condicionales
│   └── v1.0.0/
│       ├── SKILL.md
│       ├── nodejs-nestjs.md         # Node.js / NestJS enterprise
│       ├── python.md                # Python enterprise patterns
│       ├── postgresql.md            # PostgreSQL avanzado
│       ├── redis.md                 # Redis patterns
│       ├── testing-strategies.md   # Estrategias de testing
│       └── code-review.md          # Estándares revisión de código
│
├── integration/                     # Layer 5 — Condicionales
│   └── v1.0.0/
│       ├── SKILL.md
│       ├── interoperability.md     # Reglas de interoperabilidad
│       ├── gov-platforms.md        # Plataformas gubernamentales
│       ├── external-apis.md        # Integraciones externas
│       ├── event-bus.md            # Kafka, Pub/Sub, patrones
│       └── data-contracts.md      # Contratos de datos, schemas
│
└── ai-governance/                   # Layer 6 — Especializados
    └── v1.0.0/
        ├── SKILL.md
        ├── ai-agent-orchestration.md # Orquestación multi-agente
        ├── multi-agent-patterns.md  # Patrones multi-agent
        ├── pr-review.md             # Revisión automática de PRs
        ├── docs-generation.md       # Generación de documentación
        └── diagrams.md              # Generación de diagramas técnicos
```

---

## Carga de Skills por Contexto

| Contexto detectado | Skills adicionales cargados |
|---|---|
| "diseñar arquitectura" | architecture/* + platform/* |
| "revisar seguridad / auditoría" | security/* |
| "generar código NestJS/Node" | development/nodejs-nestjs |
| "integración con plataforma gov" | integration/gov-platforms + security/* |
| "revisar PR / código" | development/code-review + security/vulnerability-review |
| "pipeline CI/CD" | platform/devsecops |
| "agente IA / LLM" | ai-governance/* |
| "terraform / IaC" | platform/terraform + platform/gcp-standards |
| "kafka / eventos" | architecture/event-driven + integration/event-bus |

---

## Convención de Naming

```
{dominio}/{version}/{skill-name}.md

Ejemplos:
  core/v1.0.0/security-guardrails.md
  security/v1.0.0/oauth2-oidc.md
  platform/v1.0.0/kubernetes.md
```

**Reglas:**
- Todo en minúsculas con guiones (`kebab-case`)
- Versión semántica: `vMAJOR.MINOR.PATCH`
- MAJOR: cambio breaking de comportamiento
- MINOR: nuevas reglas no breaking
- PATCH: correcciones y ejemplos

---

## Dependencias entre Skills

```
core/* ─────────────────────────────────── TODOS dependen de core
platform/gcp-standards ◄─── platform/kubernetes
platform/gcp-standards ◄─── platform/terraform
security/oauth2-oidc ◄────── integration/gov-platforms
security/* ◄─────────────── development/code-review
architecture/api-design ◄─── development/nodejs-nestjs
architecture/event-driven ◄── integration/event-bus
platform/observability ◄──── ai-governance/ai-agent-orchestration
```
