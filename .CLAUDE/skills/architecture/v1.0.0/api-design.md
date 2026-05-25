# SKILL: Architecture — API Design Standards

**Dominio:** architecture  
**Versión:** v1.0.0  
**Capa:** 2 — Obligatorio  
**Dependencias:** core/v1.0.0, security/v1.0.0/oauth2-oidc.md  

---

## CUÁNDO CARGAR ESTE SKILL

- Diseño de nuevas APIs (REST, GraphQL, gRPC)
- Revisión de contratos de API
- Diseño de integraciones entre servicios
- OpenAPI/Swagger spec review

---

## PRINCIPIOS FUNDAMENTALES DE DISEÑO DE API

```
1. CONTRACT FIRST — Primero el contrato (OpenAPI spec), luego el código
2. BACKWARD COMPATIBLE — Nunca romper contratos existentes
3. SECURE BY DEFAULT — Auth requerido por defecto, explícito para público
4. IDEMPOTENT WRITES — PUT/PATCH/DELETE siempre idempotentes
5. CONSISTENT ERRORS — Mismo formato de error en toda la API
6. VERSIONED — URL versioning (/v1/) para APIs públicas/gubernamentales
7. DOCUMENTED — Todo endpoint documentado con ejemplos
```

---

## ESTÁNDAR REST — NAMING CONVENTIONS

```
Recursos (sustantivos, plural):
  ✅ GET    /v1/usuarios
  ✅ GET    /v1/usuarios/{id}
  ✅ POST   /v1/usuarios
  ✅ PUT    /v1/usuarios/{id}        (reemplaza completo)
  ✅ PATCH  /v1/usuarios/{id}        (actualización parcial)
  ✅ DELETE /v1/usuarios/{id}
  ✅ GET    /v1/usuarios/{id}/permisos  (sub-recursos)

  ❌ GET  /v1/getUsuario
  ❌ POST /v1/crearUsuario
  ❌ POST /v1/usuario/delete

Acciones que no son CRUD (usar verbos en el sub-recurso):
  ✅ POST /v1/usuarios/{id}/activar
  ✅ POST /v1/usuarios/{id}/desactivar
  ✅ POST /v1/pagos/{id}/reembolsar
  ✅ POST /v1/sesiones/{id}/revocar

Filtros y paginación:
  ✅ GET /v1/usuarios?estado=activo&page=1&limit=20&sort=nombre:asc
  ✅ GET /v1/expedientes?fecha_desde=2024-01-01&fecha_hasta=2024-12-31
```

---

## HTTP STATUS CODES — MAPA COMPLETO

```yaml
success:
  200: OK (GET, PUT, PATCH — con body)
  201: Created (POST — con Location header)
  202: Accepted (operaciones asíncronas — con job ID)
  204: No Content (DELETE exitoso)

client_errors:
  400: Bad Request (validación de input fallida — con detalles)
  401: Unauthorized (no autenticado — falta o inválido el token)
  403: Forbidden (autenticado pero sin permisos)
  404: Not Found (recurso no existe)
  409: Conflict (estado inválido, duplicate key)
  410: Gone (recurso eliminado permanentemente)
  422: Unprocessable Entity (entidad válida sintácticamente, semánticamente inválida)
  429: Too Many Requests (rate limit — con Retry-After header)

server_errors:
  500: Internal Server Error (error no controlado — no exponer detalles)
  502: Bad Gateway (upstream fallo)
  503: Service Unavailable (circuit breaker abierto, mantenimiento)
  504: Gateway Timeout

REGLAS:
  ❌ NUNCA retornar 200 con { success: false } en el body
  ❌ NUNCA usar 500 para errores de negocio
  ❌ NUNCA exponer stack traces en 500
  ✅ SIEMPRE retornar el código HTTP correcto
```

---

## FORMATO ESTÁNDAR DE ERRORES (RFC-7807 Problem Details)

```typescript
// interfaces/api-error.interface.ts
export interface ApiError {
  // RFC-7807 campos estándar
  type: string;       // URI que identifica el tipo de problema
  title: string;      // Descripción corta, legible por humanos
  status: number;     // HTTP status code
  detail: string;     // Descripción específica de esta instancia
  instance: string;   // URI de esta instancia del problema (request ID)
  
  // Extensiones enterprise
  code: string;       // Código interno para i18n y support
  timestamp: string;  // ISO-8601
  traceId: string;    // Distributed trace ID
  
  // Para errores de validación (400/422)
  errors?: ValidationError[];
}

interface ValidationError {
  field: string;
  code: string;
  message: string;
  rejectedValue?: unknown;
}

// Ejemplo de respuesta 400:
const errorResponse: ApiError = {
  type: "https://api.example.gov/errors/validation-error",
  title: "Error de validación",
  status: 400,
  detail: "Los datos enviados no cumplen con el formato requerido",
  instance: "/v1/usuarios/registro",
  code: "USER_001",
  timestamp: "2024-01-15T10:30:00.000Z",
  traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
  errors: [
    {
      field: "email",
      code: "INVALID_FORMAT",
      message: "El email no tiene un formato válido",
      rejectedValue: "usuario@",
    },
    {
      field: "curp",
      code: "INVALID_LENGTH",
      message: "La CURP debe tener 18 caracteres",
      rejectedValue: "[REDACTED]",  // PII siempre redactada en respuestas de error
    }
  ]
};
```

---

## OPENAPI 3.1 — TEMPLATE ENTERPRISE

```yaml
# api/openapi.yaml
openapi: 3.1.0
info:
  title: API de Gestión de Usuarios
  description: |
    API REST para gestión de usuarios institucionales.
    
    ## Autenticación
    Todos los endpoints requieren Bearer token (JWT) obtenido via OIDC.
    Ver [flujo de autenticación](/docs/auth).
    
    ## Rate Limiting
    - Estándar: 100 req/min por usuario
    - Elevado: 1000 req/min para integraciones institucionales
    
    ## Versionado
    Esta API sigue versionado semántico. Los cambios breaking 
    incrementan la versión mayor (/v1 → /v2).
    
  version: 1.3.0
  contact:
    name: Equipo de Arquitectura
    email: arquitectura@dependencia.gob.mx
  license:
    name: MIT

servers:
  - url: https://api.dependencia.gob.mx/v1
    description: Producción
  - url: https://api-staging.dependencia.gob.mx/v1
    description: Staging (solo acceso interno)

# Seguridad global — todos los endpoints la requieren por defecto
security:
  - bearerAuth: []

components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT
      description: |
        JWT obtenido del IdP corporativo. 
        Incluir como: Authorization: Bearer {token}
  
  schemas:
    Usuario:
      type: object
      required: [id, email, nombre, estado, createdAt]
      properties:
        id:
          type: string
          format: uuid
          readOnly: true
          example: "550e8400-e29b-41d4-a716-446655440000"
        email:
          type: string
          format: email
          example: "usuario@dependencia.gob.mx"
        nombre:
          type: string
          minLength: 2
          maxLength: 100
          example: "Juan Pérez García"
        estado:
          type: string
          enum: [activo, inactivo, suspendido, pendiente_verificacion]
        createdAt:
          type: string
          format: date-time
          readOnly: true
        # NUNCA incluir: contraseñas, tokens, curp, datos sensibles en responses por defecto
    
    CreateUsuarioRequest:
      type: object
      required: [email, nombre, rol]
      properties:
        email:
          type: string
          format: email
        nombre:
          type: string
          minLength: 2
          maxLength: 100
        rol:
          type: string
          enum: [usuario, supervisor, administrador]
    
    PaginatedResponse:
      type: object
      properties:
        data:
          type: array
          items: {}
        pagination:
          type: object
          properties:
            page: { type: integer }
            limit: { type: integer }
            total: { type: integer }
            totalPages: { type: integer }
            hasNext: { type: boolean }
            hasPrev: { type: boolean }
    
    ApiError:
      type: object
      required: [type, title, status, detail, instance, timestamp, traceId]
      properties:
        type: { type: string, format: uri }
        title: { type: string }
        status: { type: integer }
        detail: { type: string }
        instance: { type: string }
        code: { type: string }
        timestamp: { type: string, format: date-time }
        traceId: { type: string }
        errors:
          type: array
          items:
            type: object
            properties:
              field: { type: string }
              code: { type: string }
              message: { type: string }
  
  headers:
    X-Request-Id:
      description: ID único de la solicitud para trazabilidad
      schema:
        type: string
        format: uuid
    X-Rate-Limit-Remaining:
      description: Solicitudes restantes en la ventana actual
      schema:
        type: integer
    Retry-After:
      description: Segundos hasta próxima solicitud permitida (solo en 429)
      schema:
        type: integer

paths:
  /usuarios:
    get:
      summary: Listar usuarios
      operationId: listUsuarios
      tags: [Usuarios]
      parameters:
        - name: estado
          in: query
          schema:
            type: string
            enum: [activo, inactivo]
        - name: page
          in: query
          schema:
            type: integer
            minimum: 1
            default: 1
        - name: limit
          in: query
          schema:
            type: integer
            minimum: 1
            maximum: 100
            default: 20
      responses:
        '200':
          description: Lista paginada de usuarios
          headers:
            X-Request-Id:
              $ref: '#/components/headers/X-Request-Id'
          content:
            application/json:
              schema:
                allOf:
                  - $ref: '#/components/schemas/PaginatedResponse'
                  - type: object
                    properties:
                      data:
                        type: array
                        items:
                          $ref: '#/components/schemas/Usuario'
        '401':
          description: No autenticado
          content:
            application/problem+json:
              schema:
                $ref: '#/components/schemas/ApiError'
        '429':
          description: Rate limit excedido
          headers:
            Retry-After:
              $ref: '#/components/headers/Retry-After'
```

---

## HEADERS OBLIGATORIOS

```typescript
// middleware/security-headers.middleware.ts
export function applySecurityHeaders(app: INestApplication): void {
  app.use((req, res, next) => {
    // Trazabilidad
    res.setHeader('X-Request-Id', req.headers['x-request-id'] || randomUUID());
    
    // Seguridad
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    
    // Content Security Policy para APIs (no HTML)
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    
    // Cache control para respuestas con datos sensibles
    if (req.path.includes('/usuarios') || req.path.includes('/expedientes')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    }
    
    // ❌ Nunca exponer tecnología
    res.removeHeader('X-Powered-By');
    res.removeHeader('Server');
    
    next();
  });
}
```

---

## RATE LIMITING — CONFIGURACIÓN

```typescript
// config/rate-limit.config.ts
import { ThrottlerModuleOptions } from '@nestjs/throttler';

export const rateLimitConfig: ThrottlerModuleOptions = {
  throttlers: [
    {
      name: 'short',
      ttl: 1000,   // 1 segundo
      limit: 5,    // 5 requests/segundo por IP
    },
    {
      name: 'medium',
      ttl: 60000,  // 1 minuto
      limit: 100,  // 100 requests/minuto por usuario autenticado
    },
    {
      name: 'long',
      ttl: 3600000, // 1 hora
      limit: 2000,  // 2000 requests/hora
    },
  ],
};

// Rate limits diferenciados por tipo de cliente
export const clientRateLimits = {
  anonymous:              { rpm: 20 },
  authenticated_user:     { rpm: 100 },
  service_account:        { rpm: 1000 },
  government_integration: { rpm: 5000 },
  internal_service:       { rpm: -1 },  // Sin límite (misma VPC)
};
```

---

## VALIDACIÓN DE INPUT — NESTJS DTO COMPLETO

```typescript
// dto/create-usuario.dto.ts
import { IsEmail, IsEnum, IsString, Length, Matches, IsOptional } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class CreateUsuarioDto {
  @ApiProperty({ example: 'usuario@dependencia.gob.mx' })
  @IsEmail({}, { message: 'El email debe tener formato válido' })
  @Transform(({ value }) => value?.toLowerCase().trim())
  email: string;

  @ApiProperty({ minLength: 2, maxLength: 100 })
  @IsString()
  @Length(2, 100, { message: 'El nombre debe tener entre 2 y 100 caracteres' })
  @Transform(({ value }) => value?.trim())
  nombre: string;

  @ApiProperty({ enum: ['usuario', 'supervisor', 'administrador'] })
  @IsEnum(['usuario', 'supervisor', 'administrador'])
  rol: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(18, 18, { message: 'La CURP debe tener exactamente 18 caracteres' })
  @Matches(/^[A-Z]{4}[0-9]{6}[HM]{1}[A-Z]{2}[A-Z0-9]{3}[0-9A-Z]{1}[0-9]{1}$/, {
    message: 'Formato de CURP inválido',
  })
  @Transform(({ value }) => value?.toUpperCase().trim())
  curp?: string;  // Solo requerido en contextos gubernamentales
}

// main.ts — Habilitar validación global
app.useGlobalPipes(
  new ValidationPipe({
    whitelist: true,      // Eliminar propiedades no declaradas
    forbidNonWhitelisted: true,  // Error si hay propiedades extra
    transform: true,      // Transformar tipos automáticamente
    transformOptions: {
      enableImplicitConversion: false,  // Explícito siempre
    },
    stopAtFirstError: false,  // Retornar TODOS los errores
  })
);
```
