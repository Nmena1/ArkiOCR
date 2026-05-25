# SKILL: Seguridad — OAuth2/OIDC & Zero Trust

**Dominio:** security  
**Versión:** v1.0.0  
**Capa:** 3 — Obligatorio  
**Dependencias:** core/v1.0.0  

---

## CUÁNDO CARGAR ESTE SKILL

- Request menciona: autenticación, autorización, JWT, tokens, login, SSO, OIDC
- Diseño de APIs que requieren protección
- Revisión de código con flujos de autenticación
- Integración con IdP (Identity Provider)
- Contextos gubernamentales (siempre)

---

## ESTÁNDARES Y REFERENCIAS OBLIGATORIAS

```yaml
standards:
  oauth2: RFC-6749
  oidc: OpenID Connect Core 1.0
  jwt: RFC-7519
  pkce: RFC-7636          # obligatorio para SPAs y apps móviles
  token_revocation: RFC-7009
  dpop: RFC-9449           # para alto valor / gubernamental
  mtls: RFC-8705           # para comunicación service-to-service
  
security_frameworks:
  - OWASP_ASVS_v4: Level 2 mínimo, Level 3 para gov
  - NIST_SP_800-63B: autenticación digital
  - CIS_Benchmark: validar configuraciones IdP
```

---

## FLUJOS OAUTH2 — CUÁNDO USAR CADA UNO

```
┌─────────────────────────────────────────────────────────────┐
│  ¿Qué tipo de cliente?                                      │
│                                                             │
│  SPA / App Móvil ──────→ Authorization Code + PKCE  ✅     │
│  Web App (servidor) ───→ Authorization Code + state ✅     │
│  Service-to-Service ──→ Client Credentials          ✅     │
│  CLI / Device ─────────→ Device Authorization Grant ✅     │
│                                                             │
│  ❌ NUNCA usar Implicit Flow (deprecado RFC-6749 S10)       │
│  ❌ NUNCA usar ROPC (Resource Owner Password) excepto       │
│     migración legacy con justificación documentada         │
└─────────────────────────────────────────────────────────────┘
```

---

## IMPLEMENTACIÓN NESTJS — AUTH MODULE COMPLETO

### Módulo de Autenticación (auth.module.ts)
```typescript
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtStrategy } from './strategies/jwt.strategy';
import { OidcStrategy } from './strategies/oidc.strategy';
import { TokenService } from './services/token.service';
import { AuthGuard } from './guards/auth.guard';
import { RolesGuard } from './guards/roles.guard';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (config: ConfigService) => ({
        // NUNCA hardcodear secret — siempre desde variables de entorno
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: config.get<string>('JWT_ACCESS_EXPIRES', '15m'),
          issuer: config.getOrThrow<string>('JWT_ISSUER'),
          audience: config.getOrThrow<string>('JWT_AUDIENCE'),
          algorithm: 'RS256', // SIEMPRE asimétrico en prod
        },
      }),
    }),
  ],
  providers: [
    JwtStrategy,
    OidcStrategy,
    TokenService,
    AuthGuard,
    RolesGuard,
  ],
  exports: [JwtModule, PassportModule, TokenService, AuthGuard, RolesGuard],
})
export class AuthModule {}
```

### JWT Strategy con validaciones enterprise
```typescript
import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { passportJwtSecret } from 'jwks-rsa';
import { JwtPayload } from '../interfaces/jwt-payload.interface';
import { TokenBlacklistService } from '../services/token-blacklist.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly logger = new Logger(JwtStrategy.name);

  constructor(
    private readonly config: ConfigService,
    private readonly blacklist: TokenBlacklistService,
  ) {
    super({
      // JWKS URI para validar con clave pública del IdP
      secretOrKeyProvider: passportJwtSecret({
        cache: true,
        rateLimit: true,
        jwksRequestsPerMinute: 5,
        jwksUri: config.getOrThrow<string>('OIDC_JWKS_URI'),
      }),
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      algorithms: ['RS256', 'ES256'], // Nunca 'none', nunca HS256 solo
      issuer: config.getOrThrow<string>('OIDC_ISSUER'),
      audience: config.getOrThrow<string>('JWT_AUDIENCE'),
      passReqToCallback: true,
    });
  }

  async validate(request: Request, payload: JwtPayload): Promise<JwtPayload> {
    // 1. Verificar que no esté en blacklist (token revocado)
    const jti = payload.jti;
    if (!jti) {
      throw new UnauthorizedException('Token sin identificador único (jti)');
    }

    const isRevoked = await this.blacklist.isRevoked(jti);
    if (isRevoked) {
      this.logger.warn(`Token revocado intentando acceso: jti=${jti}`);
      throw new UnauthorizedException('Token revocado');
    }

    // 2. Verificar claims obligatorios
    if (!payload.sub || !payload.email) {
      throw new UnauthorizedException('Claims obligatorios ausentes');
    }

    // 3. Log de acceso (SIN incluir datos sensibles)
    this.logger.log(`Auth exitosa: sub=${payload.sub}, scope=${payload.scope}`);

    return payload;
  }
}
```

### Interface JWT Payload (tipado completo)
```typescript
export interface JwtPayload {
  // Claims estándar RFC-7519
  sub: string;        // Subject (user ID)
  iss: string;        // Issuer
  aud: string | string[];  // Audience
  exp: number;        // Expiration
  iat: number;        // Issued at
  jti: string;        // JWT ID (para revocación)
  
  // Claims OIDC estándar
  email: string;
  email_verified: boolean;
  name?: string;
  given_name?: string;
  family_name?: string;
  
  // Claims enterprise custom
  roles: string[];
  permissions: string[];
  tenant_id?: string;
  
  // Claims gubernamentales (cuando aplique)
  curp?: string;      // SIEMPRE enmascarar en logs
  rfc?: string;       // SIEMPRE enmascarar en logs
  dependencia_id?: string;
}
```

### Decorator de Roles
```typescript
import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

// Uso:
// @Roles('admin', 'auditor')
// @UseGuards(AuthGuard, RolesGuard)
// async getReporteSensible() { ... }
```

---

## CONFIGURACIÓN DE TOKENS — REGLAS DE EXPIRACIÓN

```typescript
// config/auth.config.ts
export const authConfig = {
  accessToken: {
    expiresIn: '15m',   // MÁXIMO 15 minutos para alto riesgo
    algorithm: 'RS256',
  },
  refreshToken: {
    expiresIn: '7d',
    rotation: true,       // Rotation obligatoria en cada uso
    absoluteExpiry: '30d', // Expiración absoluta (incluso con refresh)
    familyDetection: true, // Detectar robo de refresh token
  },
  idToken: {
    expiresIn: '1h',      // Solo para autenticación, no autorización
  },
  
  // Gubernamental: reducir ventanas
  governmentProfile: {
    accessToken: { expiresIn: '5m' },
    refreshToken: { expiresIn: '8h', absoluteExpiry: '12h' },
    requireMfa: true,
    requireDeviceBinding: true, // DPoP RFC-9449
  },
};
```

---

## PKCE IMPLEMENTATION (para SPAs)

```typescript
// utils/pkce.util.ts
import { createHash, randomBytes } from 'crypto';

export function generateCodeVerifier(): string {
  // RFC-7636: mínimo 43 caracteres, máximo 128
  return randomBytes(32).toString('base64url');
}

export function generateCodeChallenge(verifier: string): string {
  return createHash('sha256')
    .update(verifier)
    .digest('base64url');
  // method: 'S256' — NUNCA usar 'plain'
}

// Almacenamiento del code_verifier:
// ✅ sessionStorage (no localStorage — XSS risk menor)
// ✅ En memoria (desaparece al cerrar tab)
// ❌ NUNCA en localStorage para apps de alto riesgo
// ❌ NUNCA en cookies sin httpOnly + Secure
```

---

## ZERO TRUST — PRINCIPIOS Y VALIDACIONES

```yaml
zero_trust_checklist:
  
  network_level:
    - never_trust_internal_network: true
    - verify_every_request: true
    - micro_segmentation: true
    - service_mesh_mtls: true  # Istio/Anthos Service Mesh
    
  identity_level:
    - strong_mfa_required: true
    - continuous_verification: true  # No solo en login
    - device_health_check: true
    - user_behavior_analytics: true
    
  application_level:
    - least_privilege_tokens: true
    - token_binding: true  # DPoP o mTLS
    - request_signing: true
    - audit_every_action: true
    
  data_level:
    - encrypt_at_rest: true
    - encrypt_in_transit: true  # TLS 1.2 mínimo, 1.3 recomendado
    - data_classification: true
    - dlp_controls: true
```

---

## PATRONES ANTI-SEGURIDAD — DETECTAR Y RECHAZAR

```typescript
// ❌ NUNCA — JWT con algoritmo none
const maliciousToken = jwt.sign(payload, '', { algorithm: 'none' });

// ❌ NUNCA — Verificar JWT sin validar firma
const decoded = jwt.decode(token); // decode ≠ verify

// ❌ NUNCA — CORS wildcard en API autenticada
app.use(cors({ origin: '*' })); // Permite CSRF

// ❌ NUNCA — Almacenar tokens en localStorage sin consideraciones
localStorage.setItem('access_token', token); // Vulnerable a XSS

// ❌ NUNCA — Exponer JWKs sin rate limiting
app.get('/.well-known/jwks.json', handler); // Sin protección DoS

// ✅ SIEMPRE — Validar issuer y audience
jwt.verify(token, publicKey, {
  algorithms: ['RS256'],
  issuer: process.env.EXPECTED_ISSUER,
  audience: process.env.EXPECTED_AUDIENCE,
});
```

---

## INTEGRACIÓN CON GCP — WORKLOAD IDENTITY

```terraform
# Workload Identity para servicios GCP (mejor que SA keys)
resource "google_service_account" "app_sa" {
  account_id   = "app-service-account"
  display_name = "Application Service Account"
  project      = var.project_id
}

resource "google_service_account_iam_binding" "workload_identity_binding" {
  service_account_id = google_service_account.app_sa.name
  role               = "roles/iam.workloadIdentityUser"

  members = [
    "serviceAccount:${var.project_id}.svc.id.goog[${var.namespace}/${var.k8s_service_account}]"
  ]
}

# Anotar KSA (Kubernetes Service Account)
resource "kubernetes_service_account" "app_ksa" {
  metadata {
    name      = var.k8s_service_account
    namespace = var.namespace
    annotations = {
      "iam.gke.io/gcp-sa-email" = google_service_account.app_sa.email
    }
  }
}
```

---

## CHECKLIST DE REVISIÓN — AUTENTICACIÓN

```
Antes de aprobar cualquier implementación de auth, verificar:

□ ¿Se usa RS256/ES256? (no HS256 en prod con múltiples servicios)
□ ¿Se validan issuer y audience en JWT?
□ ¿Existe mecanismo de revocación de tokens?
□ ¿Los refresh tokens tienen rotación activada?
□ ¿Se usa PKCE en flujos de código de autorización?
□ ¿Los tokens no contienen PII innecesaria en el payload?
□ ¿Los endpoints sensibles requieren MFA en contextos gov?
□ ¿El JWKS endpoint tiene rate limiting?
□ ¿Las cookies usan httpOnly, Secure, SameSite=Strict?
□ ¿Existe logging de eventos de autenticación (éxito y fallo)?
□ ¿Los logs no exponen tokens ni PII?
□ ¿Hay detección de brute force / account enumeration?
```
