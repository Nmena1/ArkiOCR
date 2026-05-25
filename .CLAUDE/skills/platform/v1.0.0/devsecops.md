# SKILL: Platform — DevSecOps & Observabilidad

**Dominio:** platform  
**Versión:** v1.0.0  
**Capa:** 1 — Obligatorio  
**Dependencias:** core/v1.0.0, platform/gcp-standards.md  

---

## CUÁNDO CARGAR ESTE SKILL

- Diseño o revisión de pipelines CI/CD
- Configuración de monitoreo/alertas
- Revisión de Dockerfiles y manifiestos K8s
- Análisis de seguridad en pipeline
- Configuración de observabilidad

---

## PIPELINE CI/CD — ARQUITECTURA DEVSECOPS

```
┌─────────────────────────────────────────────────────────────────┐
│  Pipeline DevSecOps Enterprise                                   │
│                                                                 │
│  COMMIT → [pre-commit hooks] → [PUSH] → [CI Pipeline]          │
│                                                                 │
│  CI Pipeline:                                                   │
│  ┌──────┐ ┌──────────┐ ┌────────┐ ┌──────────┐ ┌──────────┐  │
│  │ lint │→│ unit test│→│ SAST   │→│ SCA/deps │→│ build    │  │
│  │ fmt  │ │ coverage │ │(Semgrep│ │(Snyk/     │ │(Docker)  │  │
│  └──────┘ └──────────┘ │ SonarQ)│ │Trivy)     │ └──────────┘  │
│                        └────────┘ └──────────┘                 │
│                                          ↓                      │
│  ┌──────────────────────────────────────────────┐              │
│  │ Image Security:                              │              │
│  │ Trivy scan → Sign (cosign) → Push to GAR    │              │
│  └──────────────────────────────────────────────┘              │
│                          ↓                                     │
│  CD Pipeline:                                                   │
│  [staging deploy] → [integration tests] → [DAST] → [approval] │
│                                                    → [prod deploy]│
└─────────────────────────────────────────────────────────────────┘
```

---

## CLOUD BUILD — PIPELINE COMPLETO

```yaml
# cloudbuild.yaml
substitutions:
  _REGION: us-central1
  _GAR_REPO: ${PROJECT_ID}/docker
  _SERVICE_NAME: mi-servicio

options:
  logging: CLOUD_LOGGING_ONLY
  machineType: E2_HIGHCPU_8
  env:
    - DOCKER_BUILDKIT=1

steps:
  # 1. Lint y formato
  - name: node:20-alpine
    id: lint
    entrypoint: sh
    args:
      - -c
      - |
        npm ci --prefer-offline
        npm run lint
        npm run format:check
    waitFor: ['-']

  # 2. Tests unitarios con cobertura
  - name: node:20-alpine
    id: unit-tests
    entrypoint: sh
    args:
      - -c
      - |
        npm run test:ci -- --coverage --coverageReporters=lcov
        # Fallar si cobertura < 80%
        npx coverage-threshold --lines 80 --branches 75 --functions 80
    waitFor: ['lint']

  # 3. SAST — Análisis estático de seguridad
  - name: returntocorp/semgrep
    id: sast
    entrypoint: semgrep
    args:
      - --config=p/owasp-top-ten
      - --config=p/nodejs
      - --config=p/secrets
      - --error          # Fallar en hallazgos HIGH+
      - --json
      - --output=/workspace/semgrep-results.json
      - .
    waitFor: ['-']

  # 4. SCA — Análisis de dependencias
  - name: aquasec/trivy
    id: sca-deps
    args:
      - fs
      - --security-checks=vuln,secret
      - --severity=HIGH,CRITICAL
      - --exit-code=1    # Fallar en HIGH/CRITICAL
      - --format=json
      - --output=/workspace/trivy-deps.json
      - .
    waitFor: ['unit-tests']

  # 5. Build de imagen con BuildKit (multi-stage)
  - name: gcr.io/cloud-builders/docker
    id: build-image
    args:
      - build
      - --tag=$_REGION-docker.pkg.dev/$PROJECT_ID/$_GAR_REPO/$_SERVICE_NAME:$SHORT_SHA
      - --tag=$_REGION-docker.pkg.dev/$PROJECT_ID/$_GAR_REPO/$_SERVICE_NAME:latest
      - --cache-from=$_REGION-docker.pkg.dev/$PROJECT_ID/$_GAR_REPO/$_SERVICE_NAME:latest
      - --build-arg=BUILDKIT_INLINE_CACHE=1
      - --label=git-commit=$SHORT_SHA
      - --label=build-date=$BUILD_ID
      - .
    waitFor: ['sast', 'sca-deps']

  # 6. Scan de imagen Docker
  - name: aquasec/trivy
    id: image-scan
    args:
      - image
      - --severity=HIGH,CRITICAL
      - --exit-code=1
      - --ignore-unfixed
      - --format=sarif
      - --output=/workspace/trivy-image.sarif
      - $_REGION-docker.pkg.dev/$PROJECT_ID/$_GAR_REPO/$_SERVICE_NAME:$SHORT_SHA
    waitFor: ['build-image']

  # 7. Firmar imagen (supply chain security)
  - name: gcr.io/projectsigstore/cosign
    id: sign-image
    args:
      - sign
      - --key=gcpkms://projects/$PROJECT_ID/locations/global/keyRings/signing/cryptoKeys/cosign
      - $_REGION-docker.pkg.dev/$PROJECT_ID/$_GAR_REPO/$_SERVICE_NAME:$SHORT_SHA
    waitFor: ['image-scan']

  # 8. Push de imagen
  - name: gcr.io/cloud-builders/docker
    id: push-image
    args:
      - push
      - --all-tags
      - $_REGION-docker.pkg.dev/$PROJECT_ID/$_GAR_REPO/$_SERVICE_NAME
    waitFor: ['sign-image']

  # 9. Deploy a staging (GitOps via Artifact Registry Update)
  - name: gcr.io/cloud-builders/gcloud
    id: update-staging-manifest
    entrypoint: sh
    args:
      - -c
      - |
        # Actualizar imagen en kustomize overlay de staging
        # El CD (Argo CD) tomará el cambio automáticamente
        gcloud artifacts docker images describe \
          $_REGION-docker.pkg.dev/$PROJECT_ID/$_GAR_REPO/$_SERVICE_NAME:$SHORT_SHA \
          --format="value(image_summary.digest)" > /workspace/image-digest.txt
        
        echo "Image digest: $(cat /workspace/image-digest.txt)"
    waitFor: ['push-image']

artifacts:
  objects:
    location: gs://${PROJECT_ID}-build-artifacts/$BUILD_ID/
    paths:
      - /workspace/semgrep-results.json
      - /workspace/trivy-deps.json
      - /workspace/trivy-image.sarif
```

---

## DOCKERFILE — TEMPLATE HARDENED

```dockerfile
# Multi-stage build para imagen mínima
# Stage 1: Builder
FROM node:20-alpine AS builder

# No correr como root
RUN addgroup -g 1001 -S appgroup && \
    adduser -u 1001 -S appuser -G appgroup

WORKDIR /app

# Copiar dependencias primero (mejor cache)
COPY package*.json ./
COPY tsconfig*.json ./

# Instalar TODAS las dependencias (incluyendo dev para build)
RUN npm ci

COPY src/ ./src/

RUN npm run build

# Stage 2: Production
FROM node:20-alpine AS production

# Labels de trazabilidad
LABEL org.opencontainers.image.vendor="Dependencia MX" \
      org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.revision="${GIT_SHA}"

# Actualizaciones de seguridad del OS
RUN apk upgrade --no-cache && \
    apk add --no-cache dumb-init

# Usuario no root
RUN addgroup -g 1001 -S appgroup && \
    adduser -u 1001 -S appuser -G appgroup

WORKDIR /app

# Solo dependencias de producción
COPY package*.json ./
RUN npm ci --omit=dev && \
    npm cache clean --force

# Copiar build desde stage anterior
COPY --from=builder --chown=appuser:appgroup /app/dist ./dist

# No escribir archivos temporales en el contenedor
RUN chmod -R 555 /app

USER appuser

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

EXPOSE 3000

# dumb-init para manejo correcto de señales
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/main.js"]
```

---

## KUBERNETES — DEPLOYMENT HARDENED

```yaml
# k8s/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: mi-servicio
  namespace: production
  labels:
    app: mi-servicio
    version: "1.0.0"
    tier: backend
spec:
  replicas: 3
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0  # Zero downtime
  selector:
    matchLabels:
      app: mi-servicio
  template:
    metadata:
      labels:
        app: mi-servicio
        version: "1.0.0"
      annotations:
        # Prometheus scraping
        prometheus.io/scrape: "true"
        prometheus.io/port: "3000"
        prometheus.io/path: "/metrics"
    spec:
      serviceAccountName: mi-servicio-sa
      
      # Seguridad a nivel Pod
      securityContext:
        runAsNonRoot: true
        runAsUser: 1001
        runAsGroup: 1001
        fsGroup: 1001
        seccompProfile:
          type: RuntimeDefault
      
      # Tolerations para nodos con taints específicos
      affinity:
        podAntiAffinity:
          requiredDuringSchedulingIgnoredDuringExecution:
            - labelSelector:
                matchExpressions:
                  - key: app
                    operator: In
                    values: [mi-servicio]
              topologyKey: kubernetes.io/hostname
      
      containers:
        - name: mi-servicio
          image: us-central1-docker.pkg.dev/PROJECT/docker/mi-servicio:SHA
          imagePullPolicy: Always
          
          ports:
            - containerPort: 3000
              protocol: TCP
          
          # Seguridad a nivel container
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop: [ALL]
          
          # Resources SIEMPRE definidos
          resources:
            requests:
              cpu: 100m
              memory: 128Mi
            limits:
              cpu: 500m
              memory: 512Mi
          
          # Variables de entorno (NO secretos hardcodeados)
          env:
            - name: NODE_ENV
              value: production
            - name: PORT
              value: "3000"
            - name: GCP_PROJECT_ID
              valueFrom:
                fieldRef:
                  fieldPath: metadata.annotations['cluster-name']
          
          # Secretos desde Secret Manager vía Workload Identity
          # (NO envVars con secretos directos)
          
          # Probes
          livenessProbe:
            httpGet:
              path: /health/live
              port: 3000
            initialDelaySeconds: 10
            periodSeconds: 30
            failureThreshold: 3
          
          readinessProbe:
            httpGet:
              path: /health/ready
              port: 3000
            initialDelaySeconds: 5
            periodSeconds: 10
            failureThreshold: 3
          
          startupProbe:
            httpGet:
              path: /health/live
              port: 3000
            initialDelaySeconds: 5
            periodSeconds: 5
            failureThreshold: 12  # 60 segundos total para arrancar
          
          # Volumen temporal para archivos (readOnlyRootFilesystem)
          volumeMounts:
            - name: tmp-dir
              mountPath: /tmp
      
      volumes:
        - name: tmp-dir
          emptyDir: {}
      
      # Graceful shutdown
      terminationGracePeriodSeconds: 60
```

---

## OBSERVABILIDAD — TRES PILARES

### 1. Métricas (Prometheus + Managed Prometheus GCP)

```typescript
// monitoring/metrics.service.ts
import { Injectable, OnModuleInit } from '@nestjs/common';
import { Counter, Histogram, Gauge, Registry } from 'prom-client';

@Injectable()
export class MetricsService implements OnModuleInit {
  private readonly registry: Registry;
  
  // Métricas HTTP estándar (RED: Rate, Errors, Duration)
  readonly httpRequestsTotal: Counter;
  readonly httpRequestDuration: Histogram;
  readonly httpRequestsInFlight: Gauge;
  
  // Métricas de negocio
  readonly usuariosActivos: Gauge;
  readonly transaccionesTotal: Counter;
  
  onModuleInit() {
    this.httpRequestsTotal = new Counter({
      name: 'http_requests_total',
      help: 'Total HTTP requests',
      labelNames: ['method', 'route', 'status_code'],
      registers: [this.registry],
    });
    
    this.httpRequestDuration = new Histogram({
      name: 'http_request_duration_seconds',
      help: 'HTTP request latency in seconds',
      labelNames: ['method', 'route', 'status_code'],
      buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5],
      registers: [this.registry],
    });
    
    this.httpRequestsInFlight = new Gauge({
      name: 'http_requests_in_flight',
      help: 'Number of HTTP requests currently being processed',
      registers: [this.registry],
    });
  }
}
```

### 2. Logging Estructurado (JSON)

```typescript
// logging/logger.service.ts
import { Injectable, LoggerService } from '@nestjs/common';
import pino from 'pino';

@Injectable()
export class StructuredLogger implements LoggerService {
  private readonly logger = pino({
    level: process.env.LOG_LEVEL || 'info',
    formatters: {
      level: (label) => ({ severity: label.toUpperCase() }),  // Cloud Logging format
    },
    base: {
      service: process.env.SERVICE_NAME,
      version: process.env.SERVICE_VERSION,
    },
    redact: {
      // NUNCA loggear datos sensibles
      paths: [
        'req.headers.authorization',
        'req.body.password',
        'req.body.curp',
        'req.body.rfc',
        'req.body.token',
        '*.token',
        '*.secret',
        '*.password',
        '*.credential',
      ],
      censor: '[REDACTED]',
    },
  });
  
  log(message: string, context?: string, meta?: Record<string, unknown>) {
    this.logger.info({ context, ...meta }, message);
  }
  
  error(message: string, trace?: string, context?: string) {
    this.logger.error({ context, trace }, message);
  }
  
  // Método especializado para audit log
  audit(action: string, actor: string, resource: string, result: 'success' | 'failure', meta?: Record<string, unknown>) {
    this.logger.info({
      audit: true,
      action,
      actor,    // user ID, no email
      resource,
      result,
      timestamp: new Date().toISOString(),
      ...meta,
    }, `AUDIT: ${action}`);
  }
}
```

### 3. Distributed Tracing (OpenTelemetry)

```typescript
// tracing/otel.setup.ts — Ejecutar ANTES de importar módulos de app
import { NodeSDK } from '@opentelemetry/sdk-node';
import { TraceExporter } from '@google-cloud/opentelemetry-cloud-trace-exporter';
import { MetricExporter } from '@google-cloud/opentelemetry-cloud-monitoring-exporter';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { NestInstrumentation } from '@opentelemetry/instrumentation-nestjs-core';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { RedisInstrumentation } from '@opentelemetry/instrumentation-redis-4';

const sdk = new NodeSDK({
  traceExporter: new TraceExporter(),
  metricReader: new PeriodicExportingMetricReader({
    exporter: new MetricExporter(),
    exportIntervalMillis: 60000,
  }),
  instrumentations: [
    new HttpInstrumentation({
      ignoreIncomingRequestHook: (req) => req.url === '/health',
    }),
    new NestInstrumentation(),
    new PgInstrumentation(),
    new RedisInstrumentation(),
  ],
  serviceName: process.env.SERVICE_NAME,
  serviceVersion: process.env.SERVICE_VERSION,
});

sdk.start();
```

---

## ALERTAS — REGLAS SLO/SLA

```yaml
# monitoring/alerts.yaml (Cloud Monitoring)
alerts:
  
  # SLO: 99.9% disponibilidad
  - name: high_error_rate
    condition: |
      rate(http_requests_total{status_code=~"5.."}[5m]) 
      / rate(http_requests_total[5m]) > 0.01
    severity: CRITICAL
    channels: [pagerduty, slack-oncall]
    
  # SLO: p99 latencia < 500ms
  - name: high_latency_p99
    condition: |
      histogram_quantile(0.99, http_request_duration_seconds) > 0.5
    severity: HIGH
    channels: [slack-team]
    
  # Recursos
  - name: pod_crashlooping
    condition: |
      increase(kube_pod_container_status_restarts_total[15m]) > 3
    severity: CRITICAL
    channels: [pagerduty]
    
  # Seguridad
  - name: auth_failure_spike
    condition: |
      rate(http_requests_total{status_code="401"}[5m]) > 10
    severity: HIGH
    annotations:
      description: "Posible ataque de fuerza bruta o token comprometido"
    channels: [slack-security, pagerduty]
```

---

## HEALTH CHECKS — IMPLEMENTACIÓN COMPLETA

```typescript
// health/health.controller.ts
import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService, HttpHealthIndicator, 
         TypeOrmHealthIndicator, MicroserviceHealthIndicator } from '@nestjs/terminus';

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
    private readonly redis: MicroserviceHealthIndicator,
  ) {}

  @Get('live')
  // Liveness: ¿Está el proceso vivo? (sin dependencias externas)
  liveness() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  @Get('ready')
  @HealthCheck()
  // Readiness: ¿Puede atender tráfico? (con dependencias)
  readiness() {
    return this.health.check([
      () => this.db.pingCheck('database', { timeout: 3000 }),
      () => this.redis.pingCheck('redis', { timeout: 1000 }),
    ]);
  }
}
```
