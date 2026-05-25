---
name: goes-security-testing
description: "Genera tests de seguridad con un Custom HTML Reporter (sin Java ni Allure) cubriendo el Checklist de Ciberseguridad GOES, OWASP Top 10 y OWASP API Security Top 10. Configura Jest + custom reporter, y crea specs completas con evidencia JSON, trazabilidad regulatoria y clasificacion por epicas. El reporte HTML incluye sidebar con navegacion Epic-Feature-Story, modal de detalle, graficos SVG, tema oscuro, busqueda y export PDF. Activar cuando el usuario pida: tests de seguridad, checklist GOES, pentest tests, security specs, reporte de seguridad HTML, security report, o cualquier variante."
---

# GOES Security Testing — Skill para NestJS + Jest + Custom HTML Reporter

## Resumen

Este skill genera tests de seguridad profesionales para proyectos **NestJS + Jest** con un **Custom HTML Reporter** (sin Java, sin Allure).
Cubre **60 items** del Checklist de Ciberseguridad GOES, **OWASP Top 10** y **OWASP API Security Top 10**.

El reporte HTML es un archivo unico autocontenido con:
- Sidebar con navegacion por Epic > Feature > Story
- Modal de detalle con severity badges, tags, steps y evidencia JSON con syntax highlighting
- Graficos SVG (pie de pass/fail, barras por severity, donut OWASP)
- Tema oscuro, busqueda en tiempo real, export PDF

---

## PASO 1: Analizar el proyecto (EXHAUSTIVO — no solo services)

Antes de generar cualquier codigo, mapear TODA la superficie de seguridad del
proyecto. NO basta con listar `.service.ts` — la logica de seguridad vive
repartida en decoradores, guards, pipes, filtros, middleware, helpers, DTOs,
main.ts y archivos de configuracion. Recorrer cada categoria abajo y leer los
archivos relevantes ANTES de escribir un solo test.

### 1.1 Manifiesto y dependencias

```
- Leer package.json:
   * Framework (NestJS, Express, Fastify, etc.)
   * ORM (Prisma, TypeORM, Sequelize, Mongoose, Drizzle)
   * Version de Jest, ts-jest
   * Dependencias de auth: passport, @nestjs/jwt, @nestjs/passport, bcrypt,
     argon2, otplib, speakeasy
   * Hardening: helmet, cors, csurf, express-rate-limit, @nestjs/throttler,
     class-validator, class-transformer
   * Manejo de archivos: multer, @nestjs/platform-express, file-type, sharp
   * Logging: winston, pino, @nestjs/common Logger custom
- Leer .env.example o config/*.ts para identificar variables sensibles
  (JWT_SECRET, JWT_PUBLIC_KEY, BCRYPT_ROUNDS, CORS_ORIGINS, etc.)
- Leer tsconfig.json para detectar flags relevantes (strict, paths)
```

### 1.2 Bootstrap y configuracion global

Estos archivos definen reglas que aplican a TODA la app — sin leerlos los tests
asumen defaults equivocados.

```
- src/main.ts (o bootstrap.ts): leer COMPLETO
   * app.use(helmet(...))                      -> cubre R44-R50
   * app.enableCors(...)                       -> cubre R38-R41
   * app.useGlobalPipes(new ValidationPipe(...))-> cubre R5, R11
   * app.useGlobalGuards(...)                  -> cubre R9, R21, R33, R34
   * app.useGlobalInterceptors(...)            -> puede cubrir R10, audit
   * app.useGlobalFilters(...)                 -> cubre R8 (errores genericos)
   * app.use(cookieParser(...))                -> cubre R42, R51
   * app.setGlobalPrefix(...) y versionado
- src/app.module.ts: imports de ThrottlerModule, JwtModule, ConfigModule
- nest-cli.json (si aplica)
```

### 1.3 Endpoints — controllers + decoradores + DTOs

```
- Glob: src/**/*.controller.ts
   * Por cada controller identificar metodos HTTP (@Get, @Post, @Patch,
     @Delete) y sus rutas
   * Decoradores aplicados al controller y a cada metodo:
     - @UseGuards(...)                  -> quien protege
     - @Roles(...)                      -> cubre R9, R24, R34
     - @Public()                        -> endpoints sin auth
     - @Throttle(...) / @SkipThrottle() -> cubre R55
     - @ApiBearerAuth() / @ApiOperation
   * Parametros: @Body() DTO, @Param(), @Query(), @Headers()
   * Excepciones que el metodo puede lanzar (BadRequest, Forbidden, etc.)
- Glob: src/**/*.dto.ts
   * Decoradores de class-validator: @IsString, @IsEmail, @MinLength,
     @MaxLength, @Matches, @IsUUID
   * Decoradores de class-transformer: @Transform, @Exclude (cubre R20, API3)
- Glob: src/**/*.entity.ts y src/**/*.schema.ts (Prisma schema, TypeORM
  entities, Mongoose schemas) - campos sensibles, indices unicos, relaciones
```

### 1.4 Guards, pipes, interceptors, filters, middleware

Estos son los componentes que IMPLEMENTAN la mayoria del checklist GOES - sin
leerlos los tests no saben que verificar.

```
- Glob: src/**/*.guard.ts        (JwtAuthGuard, RolesGuard, ThrottlerGuard)
- Glob: src/**/*.strategy.ts     (JwtStrategy, LocalStrategy de passport)
- Glob: src/**/*.pipe.ts         (ValidationPipe custom, ParseUUIDPipe)
- Glob: src/**/*.interceptor.ts  (LoggingInterceptor, TransformInterceptor)
- Glob: src/**/*.filter.ts       (AllExceptionsFilter, HttpExceptionFilter)
- Glob: src/**/*.middleware.ts   (helmet wrapper, request ID, audit log)
- Glob: src/**/*.decorator.ts    (decoradores custom: @CurrentUser, @Roles,
                                  @Public, @AuditAction)
```

### 1.5 Servicios, repositorios y helpers

```
- Glob: src/**/*.service.ts        (logica de negocio + auth/crypto)
- Glob: src/**/*.repository.ts     (acceso a datos)
- Glob: src/common/**/*.ts y src/utils/**/*.ts y src/helpers/**/*.ts
   * Funciones de hashing, comparacion timing-safe, generacion de UUID,
     sanitizacion, parseo de tokens. Estos archivos casi siempre contienen
     codigo critico para R15, R17, R20, R32.
- Glob: src/**/jwt.config.ts y src/**/auth.config.ts
- Glob: src/**/cors.config.ts y src/**/throttler.config.ts
```

### 1.6 Manejo de archivos (si aplica)

```
- Buscar multer.diskStorage / memoryStorage en cualquier parte
- Buscar @UseInterceptors(FileInterceptor(...))
- Buscar uso de file-type, sharp, fluent-ffmpeg
- Carpetas /uploads, /storage, /tmp (si existen)
   * Si el proyecto NO maneja archivos, omitir patrones 20 (file upload).
```

### 1.7 Tests existentes y configuracion de Jest

```
- Glob: **/*.spec.ts, **/*.e2e-spec.ts (NO sobreescribir si existen)
- jest.config.ts / jest.config.js / jest-e2e.config.ts
- test/jest-e2e.json
- Hay algun reporter ya configurado? Si es jest-html-reporters, allure-jest,
  etc., desinstalarlo (este skill usa el reporter custom, no se necesita otro).
```

### 1.8 CI/CD y secretos (verificacion ligera)

```
- .github/workflows/*.yml o .gitlab-ci.yml: hay job de seguridad?
- .env (NO leer su contenido si esta gitignored - solo verificar que NO esta
  commiteado, eso ya cubre parte de R3)
- .gitignore: confirmar que /node_modules, /dist, /coverage, /reports,
  *.env estan excluidos
```

### 1.9 Salida del analisis (mental - no escribir archivos)

Antes de pasar al paso siguiente, generar un mapa interno con:
- Lista de modulos/recursos del proyecto.
- Por cada modulo: que controllers expone, que servicios tiene, que guards lo
  protegen, que DTOs valida.
- Que items del checklist GOES YA estan implementados (porque encontraste el
  guard / pipe / decorador correspondiente) -> testear.
- Que items del checklist NO se ven implementados -> marcar como "test que
  falla" o "test omitido" + recomendacion en `_recommendations.md`.
- Que items NO aplican (por ejemplo, R57-R60 si el proyecto no maneja
  archivos) -> generar el test de igual manera, pero llamar
  `t.notApplicable('Reason')` en lugar de assertions reales. El reporter
  los marca como skipped (icono ⊘ amarillo) con badge "N/A" y el motivo
  en el modal. NO hacer `it.skip(...)` (pierde metadata) ni dejar el item
  fuera del reporte (no queda trazabilidad).

---

## PASO 2: Instalar dependencias (si no existen)

Verificar en package.json y solo instalar lo que falte:

```bash
npm install --save-dev ts-jest @types/jest
```

**NO instalar Allure, allure-commandline, allure-jest ni jest-html-reporters.** Este sistema usa un reporter custom puro Node.js que no necesita Java ni dependencias externas de reporte.

---

## PASO 3: Configurar el custom reporter

Este skill incluye el reporter bundled en `.claude/skills/goes-security-testing/reporter/`. **NO copiar los archivos** — referenciarlos directamente para evitar duplicados.

El reporter consiste en dos archivos:

- **`reporter/html-reporter.js`** — Jest custom reporter (JavaScript puro, ~1600 lineas). Implementa `onRunComplete(testContexts, results)`: lee metadata JSON temporales, cruza con resultados de Jest, genera HTML autocontenido con sidebar, charts SVG, dark theme, busqueda y export PDF.
- **`reporter/metadata.ts`** — Collector de metadata. Exporta `report()` y `AllureCompat`. Cada test registra epic, feature, story, severity, tags, steps, evidencia. Se escribe a archivos JSON temporales via `flush()`.

**NO modificar los archivos del reporter.** Estan listos para usar.

La estructura del proyecto sera:

```
test/security/
├── *.security-html.spec.ts         ← Archivos de specs de seguridad
└── jest-security-html.config.ts    ← Config de Jest (apunta a .claude/ reporter)
```

---

## PASO 4: Configurar Jest

### jest-security-html.config.ts

```typescript
import type { Config } from 'jest';
import * as path from 'path';

const reporterPath = path.resolve(__dirname, '../../.claude/skills/goes-security-testing/reporter');

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '../..',
  testMatch: ['<rootDir>/test/security/**/*.security-html.spec.ts'],
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  testEnvironment: 'node',
  moduleNameMapper: {
    '^src/(.*)$': '<rootDir>/src/$1',
    '^@security-reporter/(.*)$': path.join(reporterPath, '$1'),
  },
  reporters: [
    'default',
    [
      path.join(reporterPath, 'html-reporter.js'),
      {
        outputPath: './reports/security/security-report.html',
        // Personalizacion del HTML reporter (todas opcionales).
        // Si projectName no se define, el reporter intentara leerlo del package.json
        // del rootDir del proyecto bajo test, y caera a 'Security Report' como fallback.
        // projectName: 'Mi Proyecto GOES',
        // reportTitle: 'Reporte de Seguridad GOES',
      },
    ],
  ],
};

export default config;
```

El alias `@security-reporter` permite que los specs importen metadata limpiamente:

```typescript
import { report } from '@security-reporter/metadata';
```

### Scripts npm (agregar a package.json)

Agregar `test:security:html` y `test:all`. Si los scripts `test` o `test:e2e`
no existen en el proyecto (proyecto NestJS recien creado), agregarlos tambien
con los defaults estandar.

```json
{
  "test": "jest",
  "test:e2e": "jest --config ./test/jest-e2e.json",
  "test:security:html": "jest --config test/security/jest-security-html.config.ts --verbose",
  "test:all": "npm test && npm run test:e2e && npm run test:security:html"
}
```

Notas para la IA al actualizar `package.json`:
- Si `test`, `test:e2e` u otros scripts ya existen en el proyecto, NO
  sobrescribirlos: solo verificar que `test:security:html` y `test:all`
  esten presentes.
- Si el proyecto usa pnpm o yarn, ajustar `test:all` a
  `pnpm test && pnpm test:e2e && pnpm test:security:html` o equivalente con
  yarn.
- Si el proyecto NO tiene tests E2E configurados, el `test:all` puede omitir
  ese paso: `npm test && npm run test:security:html`.

Para generar SOLO el reporte de seguridad:
```bash
npm run test:security:html
# El HTML se genera en reports/security/security-report.html
```

Para correr la suite completa (unit + e2e + seguridad):
```bash
npm run test:all
```

---

## PASO 5: Crear archivos de soporte

### .gitignore (agregar si no existen)
```
/coverage
/reports
```

### eslint.config.mjs (agregar override para archivos de test)
```javascript
// Dentro del array de configuracion, agregar:
{
  files: ['**/*.spec.ts', '**/*.e2e-spec.ts', 'test/**/*.ts'],
  rules: {
    '@typescript-eslint/no-unsafe-assignment': 'off',
    '@typescript-eslint/no-unsafe-member-access': 'off',
    '@typescript-eslint/no-unsafe-call': 'off',
    '@typescript-eslint/no-unsafe-return': 'off',
    '@typescript-eslint/no-unsafe-argument': 'off',
    '@typescript-eslint/no-unused-vars': 'warn',
    '@typescript-eslint/require-await': 'off',
  },
}
```

---

## PASO 6: Generar tests

Para CADA servicio/controller del proyecto, crear un archivo `.security-html.spec.ts` siguiendo las reglas de este skill.

### Estructura obligatoria de cada test

Hay dos patrones equivalentes. Usar el que resulte mas conveniente:

#### Patron A: report() directo (recomendado para tests nuevos)

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { report } from '@security-reporter/metadata';

describe('NombreDelServicio', () => {
  // setup...

  it('nombre descriptivo del test', async () => {
    const t = report();

    // 1. METADATA (obligatorio en cada test)
    t.epic('Seguridad');
    t.feature('Input Validation');
    t.story('Rechazar payload con SQL injection');
    t.severity('blocker');
    t.tag('Pentest', 'OWASP A03', 'GOES Checklist R5');

    // 2. PARAMETERS (inputs visibles en el reporte)
    t.parameter('email', 'test@goes.gob.sv');
    t.parameter('payload', "' OR 1=1 --");

    // 3. STEPS (patron Preparar/Ejecutar/Verificar)
    t.step('Preparar: crear payload malicioso');
    const payload = { email: "' OR 1=1 --" };
    t.evidence('Input (payload)', payload);

    t.step('Ejecutar: enviar al servicio');
    const result = await service.validate(payload);

    t.step('Verificar: debe rechazar la inyeccion');
    expect(result.valid).toBe(false);
    t.evidence('Resultado (output)', result);

    await t.flush();
  });
});
```

#### Patron B: AllureCompat (migracion desde Allure existente)

Para migrar tests que ya usaban `allure-js-commons`, se puede usar `AllureCompat` que espeja la misma API:

```typescript
import { AllureCompat } from '@security-reporter/metadata';

it('nombre del test', async () => {
  const allure = new AllureCompat();

  allure.epic('Seguridad');
  allure.feature('Input Validation');
  allure.severity('blocker');
  allure.tag('Pentest', 'OWASP A03');
  allure.parameter('key', 'value');

  const result = allure.step('Ejecutar accion', () => {
    return someFunction();
  });

  await allure.attachment('Resultado', JSON.stringify(result), {
    contentType: 'application/json',
  });

  expect(result).toBeDefined();
  await allure.flush();
});
```

### Reglas de metadata

| Campo | Regla |
|-------|-------|
| `epic` | Area del sistema: Seguridad, Autenticacion, Dominio, Configuracion, Auditoria, Infraestructura, Archivos |
| `feature` | Funcionalidad especifica: Timing Attack Prevention, RBAC, Input Validation, etc. |
| `story` | Escenario concreto que se prueba |
| `severity` | blocker = sistema no opera / critical = funcionalidad comprometida / normal = estandar / minor = edge case |
| `tag` | SIEMPRE incluir: tag de categoria (Pentest, CRUD, Auth, Config) + tag de normativa (OWASP Axx, GOES Checklist Rxx) |
| `parameter` | Inputs clave del test: payloads, emails, tokens, configuraciones |
| `step` | Pasos descriptivos del test en formato Preparar/Ejecutar/Verificar |
| `evidence` | Objetos JSON con datos de entrada/salida. Ver "Regla critica: evidence" mas abajo. |

### Regla critica: evidence (input + output)

Cada test DEBE registrar **al menos dos** evidencias en este orden:

1. **Input** — payload, parametros, configuracion o estado previo que el test envia al sistema.
2. **Output** — respuesta, resultado, valor de retorno o estado final tras la ejecucion.

Nombres recomendados (consistencia visual en el modal):

| Tipo de test | Input label | Output label |
|--------------|-------------|--------------|
| Pentest      | `Attacker payload (input)` | `Defense response (output)` |
| CRUD / DTO   | `Request body (input)` | `Service response (output)` |
| Auth         | `Credentials (input)` | `Auth result (output)` |
| Config       | `Config snapshot (input)` | `Effective behavior (output)` |
| Headers / CORS | `Request (input)` | `Response headers (output)` |

Ejemplo minimo:

```typescript
const payload = { email: "' OR 1=1 --" };
t.evidence('Attacker payload (input)', payload);

const result = await service.validate(payload);
t.evidence('Defense response (output)', result);
```

Tests sin par input/output son **incompletos** y deben corregirse antes de
commitear. Si un test legitimamente no tiene input (ej: verificar configuracion
estatica de helmet), registrar un input descriptivo: `t.evidence('Initial state
(input)', { helmetEnabled: true, headers: ['CSP', 'HSTS', 'XCT'] });`.

### Regla para tests de PENTEST

- Prefijo "PENTEST:" en el nombre del it()
- Epic: 'Seguridad'
- Tag: 'Pentest' + referencia OWASP
- Steps con ## Vulnerabilidad que previene y ## Defensa implementada
- Evidence con payload del atacante (input) y respuesta de defensa (output)

### Regla critica: codigo comentado cuenta como AUSENTE

Cuando un test verifica la **presencia** de codigo en archivos fuente
(`main.ts`, `app.module.ts`, controllers, etc.), un regex naive falla
en el momento que un desarrollador **comenta** la linea en vez de
borrarla. `// app.use(helmet());` haria pasar el test como si helmet
estuviera activo, cuando en realidad no se esta ejecutando.

**Regla**: todo test que inspeccione el source de un archivo y haga
match por regex DEBE quitar los comentarios antes de buscar. Una linea
comentada = codigo ausente.

Helper canonico documentado en
[`_static-analysis.md`](references/test-patterns/_static-analysis.md):

```typescript
const stripComments = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

const readSrc = (relativePath: string): string =>
  stripComments(fs.readFileSync(path.resolve(__dirname, relativePath), 'utf-8'));
```

Uso obligatorio cuando:
- Verificar middleware global en `main.ts` (helmet, CORS, ValidationPipe,
  cookieParser, global guards/pipes/filters/interceptors).
- Verificar imports y registros en `*.module.ts` (`ThrottlerModule`,
  `JwtModule`, `ConfigModule`).
- Verificar **ausencia** de patrones peligrosos (`$queryRawUnsafe`,
  raw SQL, `eval(`, etc.).

Cuando se puede usar `Reflect.getMetadata(...)` directamente sobre la
clase (controllers con decoradores accesibles via import), preferir esa
via — es mas directa y typed. La inspeccion de source con `stripComments`
es para los casos donde no hay metadata expuesta en runtime (ej: el
codigo de bootstrap en `main.ts`).

### Regla critica: cobertura de 3 capas para controles de defensa

Un test que verifica **solo** la configuracion (env vars, module imports)
NO sirve como evidencia de cumplimiento de un item del checklist. Si un
desarrollador comenta el decorator `@Throttle`, `@UseGuards(RolesGuard)`,
`@UseGuards(JwtAuthGuard)`, etc., el test sigue verde y el control
queda desactivado en runtime sin que el reporte se entere.

Para los items que implementan controles de defensa (rate limiting, RBAC,
auth guards, validation pipes, helmet, CORS, throttling, brute force
protection, IDOR), el spec DEBE incluir las **3 capas**:

| Capa | Que verifica | Como |
|------|--------------|------|
| **1. Configuracion** | env vars, module imports, valores por defecto correctos | Leer `envConfig()`, `app.module.ts`, defaults |
| **2. Aplicacion** | el decorator/guard esta puesto en cada endpoint relevante | `Reflect.getMetadata(...)` sobre el metodo del controller; verificar que la lista de endpoints protegidos coincide con la esperada |
| **3. Comportamiento** | cuando se dispara, el control rechaza efectivamente | Mock del guard que devuelve `false` o `429`; o E2E con supertest enviando N+1 requests |

**Si solo cubris la capa 1, el test es invalido y el item del checklist
queda como falso positivo.** Documentar la limitacion en el evidence si
por algun motivo no podes cubrir capa 2 o 3 (ej: el proyecto no expone
el controller para Reflect, o no hay tiempo para E2E).

Items afectados por esta regla:

- R9, R24, R34 (RBAC) — verificar `@Roles` y `RolesGuard`
- R21, R33 (Forced browsing / token per request) — verificar `@UseGuards(JwtAuthGuard)`
- R27 (Brute force) — verificar contador de intentos + bloqueo
- R5, R11 (DTO validation) — verificar `ValidationPipe` global + decoradores en DTO
- R19 (JWT claims) — verificar que `JwtStrategy.validate()` chequea `signature/exp/iat/iss/aud`
- R37 (ORM) — verificar que NO hay queries raw (`grep` por `$queryRaw`, `query()`, `createQueryRunner().query()`)
- R38-R41 (CORS) — verificar `app.enableCors()` con valores correctos
- R44-R50 (Headers) — verificar `app.use(helmet(...))` Y E2E que los headers salen
- R55 (Rate limiting) — verificar config + `@Throttle` decorator + E2E 429

NUNCA poner un test de control de defensa en un spec de "config-only".
Cada test de control va en el spec del controller/service donde se aplica.

### Regla critica: notApplicable vs hallazgo (NO confundir)

`notApplicable` se reserva **exclusivamente** para items donde la
**superficie de ataque** no existe en el proyecto. Si la superficie
existe pero el control de defensa esperado **falta o esta mal
implementado**, eso es un **HALLAZGO** (test rojo), NUNCA un N/A.

**Arbol de decision** antes de escribir el test:

```
1. ¿El proyecto recibe/maneja este tipo de input o feature?
   (uploads, cookies, JWT, sesiones, MFA, SSRF egress, archivos, etc.)
   │
   ├── NO existe la superficie → t.notApplicable(motivo verificable)
   │   Ej: backend SOLO con endpoints JSON, sin multer ni
   │   FileInterceptor → R57-R60 son N/A.
   │
   └── SI existe la superficie
       │
       2. ¿El control de defensa especifico esta implementado y correcto?
       │
       ├── SI bien → test pasa (verde ✓)
       ├── SI pero mal → test FALLA (rojo ✗) — HALLAZGO
       └── NO existe → test FALLA (rojo ✗) — HALLAZGO
       │
       NUNCA marcar como N/A si la superficie existe.
```

**Ejemplos canonicos**:

| Estado del proyecto | R57 (Magic Bytes) | Justificacion |
|---|---|---|
| No usa multer, ni FileInterceptor | ⊘ N/A | Superficie ausente |
| Usa multer, valida magic bytes con `file-type` | ✓ verde | Control implementado |
| Usa multer, NO valida magic bytes | ✗ ROJO | **Hallazgo — superficie existe, defensa ausente** |
| Usa multer, valida pero solo extension (no magic) | ✗ ROJO | **Hallazgo — defensa incompleta** |

**Si Claude detecta que la superficie existe pero el control no esta**:

1. NO marcar `t.notApplicable(...)`.
2. NO escribir el test asumiendo que la defensa existe (eso es falso positivo).
3. Generar el test igual con la assertion correcta (`expect(...).toThrow()`,
   `expect(stripComments(src)).toMatch(...)`, etc.). El test falla en rojo
   porque el codigo no lo cumple — eso es **exactamente el comportamiento
   correcto**: un hallazgo de seguridad documentado en el reporte.
4. Documentar el hallazgo en `_recommendations.md` con el detalle del
   control faltante y la recomendacion concreta.

**El reporte muestra el hallazgo (rojo). El auditor lo ve. El equipo lo
arregla. El skill cumple su trabajo.** Ese es el flujo correcto.

#### Esta regla es UNIVERSAL — aplica a los 54 items del checklist

NO hay items "exentos" de esta regla. Por defecto, **ningun item del
checklist se marca como N/A**. Para marcar N/A, hay que verificar
explicitamente con `grep` que la superficie de la feature no existe
en el proyecto.

**Items que PUEDEN ser N/A** (feature-dependientes, lista cerrada):

| Item | Es N/A solo si... | Verificacion (grep en src/) |
|------|-------------------|------------------------------|
| R28 — Account Recovery | El proyecto usa auth externa (SSO/OAuth) y NO tiene flujo propio de recuperacion | `grep -r "forgot.password\|reset.password\|recovery" src/` → 0 resultados |
| R29 — Remember Me | No hay feature "recordarme" en el login | `grep -r "rememberMe\|remember.me\|persistent.login" src/` → 0 resultados |
| R32 — Token Rotation | El proyecto usa SOLO access tokens cortos, sin refresh | `grep -r "refreshToken\|refresh.token\|/refresh" src/` → 0 resultados |
| R35 — Session Inactivity | El proyecto es 100% stateless (no usa sesiones server-side) | `grep -r "express-session\|@nestjs/passport.*session\|sessionTimeout" src/` → 0 resultados |
| R57-R60 — File Upload | El proyecto NO acepta uploads de archivos | `grep -r "multer\|FileInterceptor\|UploadedFile\|multipart/form-data" src/` → 0 resultados |
| R6 — Robots/Sitemap | El backend no sirve contenido publico (solo APIs internas) | Verificar que no hay `@Public()` ni rutas servidas a no-autenticados |

**Items que NUNCA pueden ser N/A** (universales — todo backend web los tiene):

- R3, R4, R5 — Cualquier backend tiene responses e inputs.
- R8 — Cualquier API HTTP devuelve errores.
- R9, R11 — Cualquier endpoint recibe input que validar.
- R10 — Cualquier sistema produce logs.
- R13-R20 — Si hay autenticacion (la hay siempre en sistemas GOES).
- R21-R27 — Si hay endpoints privados o registro/login.
- R30, R31, R33, R34 — RBAC, password storage, validacion de token.
- R37 — Cualquier app con base de datos.
- R38-R41 — CORS aplica a toda API expuesta a un frontend.
- R42, R51 — Cookies aplica si hay sesion o JWT en cookie (lo normal).
- R43 — Debug mode aplica a toda app.
- R44-R50 — Security headers aplican a toda respuesta HTTP.
- R52-R54 — Metodos HTTP aplican a toda API.
- R55 — Rate limiting aplica a toda API publica.

**Si un item universal no esta implementado**: HALLAZGO (test rojo),
no N/A. Por ejemplo:

- Proyecto sin helmet → R44-R50 fallan en rojo (no se marcan N/A).
- Proyecto sin rate limiting global → R55 falla en rojo (no se marca N/A).
- Proyecto con queries raw concatenadas → R37 falla en rojo (no se marca N/A).

**Procedimiento obligatorio antes de marcar cualquier item como N/A**:

1. Revisar la tabla "Items que PUEDEN ser N/A" arriba. Si el item no
   esta listado → **NO ES N/A**. Generar el test igual.
2. Si el item esta listado, ejecutar el `grep` correspondiente sobre
   `src/`. Si encuentra `>0` resultados → **NO ES N/A**.
3. Solo si los pasos 1 y 2 confirman ausencia total de la superficie,
   marcar `t.notApplicable('motivo verificable + comando grep usado')`.

Ejemplo correcto de N/A:
```typescript
t.notApplicable(
  'Backend no acepta file uploads. Verificado: ' +
  'grep -r "multer|FileInterceptor|UploadedFile" src/ → 0 resultados, ' +
  'package.json no incluye multer ni @nestjs/platform-express file extras.'
);
```

Ejemplo INCORRECTO (que esta regla prohibe):
```typescript
// ❌ Marca N/A porque "el codigo no implementa magic bytes"
t.notApplicable('Project does not validate magic bytes');
// ↑ ESTO ES UN HALLAZGO, NO UN N/A. La superficie (uploads) existe.
```

### Regla critica: items NO aplicables (notApplicable)

Cuando un item del checklist GOES, OWASP o GOES no aplica al proyecto bajo
test (ej: R57-R60 sobre file upload en un backend que no acepta archivos,
MFA en un servicio sin sesiones de usuario, SSRF en una API sin egress
externo, etc.) generar igualmente el test con metadata completa, pero usar
`t.notApplicable('Razon especifica y verificable')` en vez de assertions
reales:

```typescript
it('R57-R60 — File upload rules NO aplican', async () => {
  const t = report();
  t.epic('Archivos');
  t.feature('File Upload Security');
  t.story('Backend NO maneja archivos');
  t.severity('blocker');
  t.tag('GOES Checklist R57', 'GOES Checklist R58', 'GOES Checklist R59', 'GOES Checklist R60');

  t.notApplicable('Backend no acepta uploads: no usa multer, no expone @UseInterceptors(FileInterceptor), no tiene endpoints multipart/form-data');

  await t.flush();
});
```

Reglas:
- **NO usar `it.skip(...)`** — el body no se ejecuta y se pierde toda la
  metadata (epic, feature, tags). El item queda invisible en el reporte.
- **NO omitir el test** — el checklist GOES requiere trazabilidad explicita
  de los 60 items, incluso los no aplicables.
- **La razon debe ser verificable** — referenciar lo que SE BUSCO y NO se
  encontro (paquetes no instalados, decoradores no usados, endpoints no
  expuestos), no una afirmacion vaga ("no aplica al modulo").
- En `AllureCompat`: `allure.notApplicable('reason')` funciona igual.

El reporter marca estos tests como skipped (⊘ amarillo) con badge `N/A`,
y muestra la razon en un callout dentro del modal de detalle. El stat card
"Not Applicable" aparece cuando hay 1 o mas tests asi.

### Regla critica: flush()

Cada test DEBE llamar `await t.flush()` (o `await allure.flush()`) al final. Sin flush, la metadata no se escribe y el reporte no tendra los detalles del test.

---

## CHECKLIST COMPLETO DE CIBERSEGURIDAD GOES

Este es el checklist oficial. Cada item DEBE tener al menos 1 test que lo cubra.
El tag de trazabilidad es `GOES Checklist Rxx` donde xx es el numero de fila.

### CATEGORIA 1: Contenido Web

| ID | Tarea | Epic | Feature sugerida | Severity |
|----|-------|------|------------------|----------|
| R3 | No dejar contenido sensible (llaves, IDs, info personal) en archivos del proyecto | Seguridad | Sensitive Data Exposure | critical |
| R4 | No exponer JS sensible o logica de negocio | Seguridad | Business Logic Exposure | critical |
| R5 | Sanitizar entrada de datos (probar inyeccion de scripts) | Seguridad | XSS Prevention / Input Sanitization | blocker |
| R6 | Si el sitio es publico, configurar Robot.txt y sitemap.xml | Configuracion | Public Site Config | minor |

### CATEGORIA 2: Entrada y salida de datos por el servidor

| ID | Tarea | Epic | Feature sugerida | Severity |
|----|-------|------|------------------|----------|
| R8 | Mensajes 2xx, 4xx, 5xx genericos (no exponer detalles internos) | Seguridad | Generic Error Messages | critical |
| R9 | Validacion por rol o permiso dentro del servidor | Autenticacion | RBAC Enforcement | blocker |
| R10 | Eliminar todo log visible por el usuario | Seguridad | Log Exposure Prevention | critical |
| R11 | Validacion de tipo de datos via DTO, longitud de campo, cantidad maxima de registros | Dominio | DTO Validation / Input Constraints | critical |

### CATEGORIA 3: Autenticacion, registro y acciones de usuarios

| ID | Tarea | Epic | Feature sugerida | Severity |
|----|-------|------|------------------|----------|
| R13 | Tiempo de vida bajo para access token (5 min) y refresh token | Seguridad | Token Lifetime Enforcement | critical |
| R14 | Auth failures: MFA, rate limit, session management | Seguridad | Auth Failure Handling | blocker |
| R15 | Encriptacion bcrypt, Argon2 o PBKDF2 en hashing | Seguridad | Password Hashing Strength | blocker |
| R16 | Uso de algoritmo RS256 para firma de tokens | Seguridad | JWT Signing Algorithm | blocker |
| R17 | Session ID minimo 128 bits de entropia | Seguridad | Session ID Entropy | critical |
| R18 | Session ID regenerado post-login | Seguridad | Session Fixation Prevention | critical |
| R19 | Validar signature, exp, iat, iss, aud en cada request | Seguridad | JWT Claims Validation | blocker |
| R20 | NO almacenar datos sensibles en el payload del JWT | Seguridad | JWT Payload Security | critical |
| R21 | Bloquear navegacion forzada a rutas no autorizadas | Autenticacion | Forced Browsing Prevention | critical |
| R22 | 404 para cualquier ruta que no coincida con las definidas | Configuracion | Unknown Route Handling | normal |
| R23 | Proteccion contra IDOR | Seguridad | IDOR Prevention | blocker |
| R24 | Usuarios con bajo privilegio no acceden a acciones de alto privilegio | Autenticacion | Privilege Escalation Prevention | blocker |
| R25 | Mismo usuario no puede registrarse repetidamente | Autenticacion | Duplicate Registration Prevention | critical |
| R26 | No aceptar disposable emails | Autenticacion | Disposable Email Rejection | normal |
| R27 | Bloquear cuenta tras 3-5 intentos fallidos | Seguridad | Brute Force Protection | blocker |
| R28 | Metodo de recuperacion de cuenta | Autenticacion | Account Recovery | critical |
| R29 | Si hay "recuerdame", la contrasena debe estar encriptada | Seguridad | Remember Me Security | critical |
| R30 | Almacenamiento de contrasena del lado del servidor | Seguridad | Server-side Password Storage | blocker |
| R31 | No permitir usar el username como password | Seguridad | Weak Password Prevention | critical |
| R32 | Renovar refresh token despues de cada uso (rotacion) | Seguridad | Token Rotation | blocker |
| R33 | Validar token en cada peticion privada | Autenticacion | Token Validation Per Request | blocker |
| R34 | Implementar RBAC | Autenticacion | Role-Based Access Control | blocker |
| R35 | Sistema de inactividad (timeout de sesion) | Seguridad | Session Inactivity Timeout | critical |

### CATEGORIA 4: Configuracion

| ID | Tarea | Epic | Feature sugerida | Severity |
|----|-------|------|------------------|----------|
| R37 | Implementar ORM (no queries raw) | Seguridad | ORM Usage / SQL Injection Prevention | blocker |
| R38 | CORS: Access-Control-Allow-Origin solo origenes permitidos | Configuracion | CORS Origin Restriction | critical |
| R39 | CORS: Access-Control-Allow-Methods solo metodos permitidos | Configuracion | CORS Methods Restriction | critical |
| R40 | Access-Control-Allow-Credentials: true solo si necesario | Configuracion | CORS Credentials Policy | normal |
| R41 | Access-Control-Max-Age: 3600 | Configuracion | CORS Preflight Cache | normal |
| R42 | Cookies con HttpOnly, Secure, SameSite | Seguridad | Cookie Security Flags | blocker |
| R43 | Debug mode deshabilitado | Configuracion | Debug Mode Disabled | critical |
| R44 | Content-Security-Policy configurado | Configuracion | CSP Header | critical |
| R45 | X-Content-Type-Options nosniff, X-Frame-Options DENY | Configuracion | Security Headers (XCT, XFO) | critical |
| R46 | Strict-Transport-Security (HSTS) | Configuracion | HSTS Header | critical |
| R47 | X-XSS-Protection 0 (deprecado, usar CSP) | Configuracion | XSS Protection Header | normal |
| R48 | Referrer-Policy strict-origin-when-cross-origin | Configuracion | Referrer Policy Header | normal |
| R49 | Permissions-Policy geolocation=(), camera=(), microphone=() | Configuracion | Permissions Policy Header | normal |
| R50 | Cache-Control no-store para respuestas sensibles | Configuracion | Cache Control Header | critical |
| R51 | Cookie max-age = refresh token duration | Configuracion | Cookie Lifetime Alignment | critical |
| R52 | Deshabilitar metodo PUT | Configuracion | HTTP PUT Disabled | normal |
| R53 | Deshabilitar metodo TRACE | Configuracion | HTTP TRACE Disabled | critical |
| R54 | Deshabilitar http override | Configuracion | HTTP Override Disabled | critical |
| R55 | Rate limit: 100 req/min normal, 5 req/min login | Seguridad | Rate Limiting | blocker |

### CATEGORIA 5: Manejo de archivos

| ID | Tarea | Epic | Feature sugerida | Severity |
|----|-------|------|------------------|----------|
| R57 | Validar extension de archivo y magic byte | Archivos | File Extension + Magic Byte Validation | blocker |
| R58 | Whitelist de extensiones permitidas | Archivos | File Extension Whitelist | blocker |
| R59 | Limitar tamano de archivo | Archivos | File Size Limit | critical |
| R60 | Renombrar archivos con UUID | Archivos | File UUID Rename | critical |

---

## OWASP TOP 10 — Tests requeridos

Cada item debe tener al menos 1 test con tag `OWASP Axx`.

| ID | Vulnerabilidad | Tests a generar | Tag |
|----|---------------|-----------------|-----|
| A01 | Broken Access Control | IDOR, Privilege Escalation, Forced Browsing, Missing Auth | OWASP A01 |
| A02 | Cryptographic Failures | Weak Hashing, Sensitive Data in JWT, Missing TLS | OWASP A02 |
| A03 | Injection | SQL Injection (ORM bypass), XSS, Command Injection | OWASP A03 |
| A04 | Insecure Design | Business Logic Flaws, Missing Rate Limit | OWASP A04 |
| A05 | Security Misconfiguration | Debug Mode, Default Creds, Missing Headers, CORS | OWASP A05 |
| A06 | Vulnerable Components | (SCA - fuera del scope de unit tests) | OWASP A06 |
| A07 | Auth Failures | Brute Force, Timing Attack, Weak Password, Token Replay | OWASP A07 |
| A08 | Data Integrity Failures | (CI/CD - fuera del scope de unit tests) | OWASP A08 |
| A09 | Logging Failures | Missing Audit Log, Sensitive Data in Logs | OWASP A09 |
| A10 | SSRF | URL Validation, Whitelist Enforcement | OWASP A10 |

---

## OWASP API SECURITY TOP 10 — Tests requeridos

| ID | Vulnerabilidad | Tests a generar | Tag |
|----|---------------|-----------------|-----|
| API1 | Broken Object Level Auth | Acceder a recurso de otro usuario por ID | OWASP API1 |
| API2 | Broken Authentication | Rate limit en login, MFA bypass | OWASP API2 |
| API3 | Broken Object Property Auth | No exponer propiedades sensibles, DTOs por rol | OWASP API3 |
| API4 | Unrestricted Resource Consumption | Rate limit, pagination limit, payload max | OWASP API4 |
| API5 | Broken Function Level Auth | Admin endpoint accedido por user normal | OWASP API5 |
| API8 | Security Misconfiguration | Headers, CORS, metodos HTTP | OWASP API8 |

---

## GUIA GOES — Secciones de referencia

Estas son las secciones de la Guia de Desarrollo Seguro GOES que deben mapearse a tests:

### Seccion 3: Validacion de Entrada
- Validar en el servidor (nunca confiar en el cliente)
- Whitelist sobre Blacklist
- Sanitizar y Escapar
- Validar tipo, longitud, formato y rango
- Canonicalizar antes de validar (UTF-8)

### Seccion 4: Autenticacion y Autorizacion
- 4.1 Politicas de Contrasenas: minimo 12 chars, verificar contra listas comprometidas, bcrypt/Argon2/PBKDF2
- 4.2 Gestion de Sesiones: 128 bits entropia, regenerar post-login, HttpOnly/Secure/SameSite, timeout inactividad 15-30 min
- 4.3 JWT Best Practices: RS256, validar signature/exp/iat/iss/aud, access token 15 min max, refresh en httpOnly cookie, rotacion por uso, NO datos sensibles en payload
- 4.4 Control de Acceso RBAC/ABAC: denegar por defecto, validar en CADA endpoint, no confiar en IDs de URL, least privilege, log accesos denegados

### Seccion 5: Criptografia
- Hashing passwords: Argon2id, bcrypt, PBKDF2 (NUNCA MD5, SHA1, SHA256 solo)
- TLS 1.2 minimo, ideal 1.3
- NO hardcodear secretos en codigo fuente, usar vault

### Seccion 6: Seguridad en APIs
- OWASP API Security Top 10 (ver tabla arriba)
- Rate Limiting: 5 intentos/min login, 100-1000 req/min APIs, responder 429 + Retry-After

### Seccion 7: Seguridad en Base de Datos
- SIEMPRE queries parametrizadas / ORM
- NUNCA concatenar strings en queries
- Principio de menor privilegio en BD

### Seccion 8: Headers de Seguridad HTTP
- Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'
- X-Content-Type-Options: nosniff
- X-Frame-Options: DENY (o SAMEORIGIN)
- Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
- X-XSS-Protection: 0 (deprecado, usar CSP)
- Referrer-Policy: strict-origin-when-cross-origin
- Permissions-Policy: geolocation=(), camera=(), microphone=()
- Cache-Control: no-store (para respuestas sensibles)
- CORS: origenes especificos, solo metodos necesarios, credentials solo si necesario, max-age 3600

### Seccion 9: Manejo de Errores y Logging
- 9.1 Errores Seguros: mensajes genericos al usuario, NUNCA exponer stack traces/queries/rutas/versiones
- 9.2 Que Loguear: intentos login con IP/timestamp, cambios password, acceso denegado (403), operaciones admin, errores validacion, creacion/eliminacion recursos sensibles
- 9.3 Que NO Loguear: contrasenas, tokens, API keys, tarjetas, datos personales sensibles, secretos

### Seccion 10: Upload de Archivos
- Validar extension Y magic bytes
- Whitelist de extensiones (.pdf, .jpg, .png)
- Limitar tamano maximo (ej: 10MB)
- Renombrar con UUID
- Almacenar fuera del webroot o en storage externo (S3)
- NO ejecutar archivos subidos

---

## PASO 7: Verificacion

Despues de generar todos los archivos:

1. Ejecutar `npm run test:security:html` para verificar que todos los tests pasan y el reporte se genera
2. Si hay errores de ESLint, corregirlos (especialmente require-await en archivos de test)
3. Verificar que `reports/security/security-report.html` se genero correctamente
4. Mostrar resumen: cuantos tests generados, cuantos items del checklist cubiertos, cuantos OWASP cubiertos

---

## NOTAS IMPORTANTES PARA LA IA

1. **NUNCA generar tests vacios o placeholder** — cada test debe tener assertions reales contra el codigo del proyecto.
2. **Analizar el codigo real ANTES de escribir tests** — y no solo el `.service.ts`. Leer ademas, segun aplique: el `.controller.ts` (decoradores, rutas), los DTOs (`class-validator`), los guards/pipes/interceptors/filters/middleware del recurso, los decoradores custom (`@Roles`, `@Public`, `@CurrentUser`, etc.), los helpers/utils que hagan hashing/comparacion/sanitizacion, `main.ts` (pipes globales, helmet, CORS), y la entity/schema correspondiente. Sin esto, los tests asumen comportamientos que no existen y dan falsos positivos.
3. **Si un item del checklist no aplica** al servicio/proyecto actual (ej: R57-R60 si no maneja archivos), generar el test con metadata completa y llamar `t.notApplicable('motivo verificable')` en vez de assertions. Aparece como skipped (⊘) con badge N/A. NUNCA usar `it.skip(...)` ni omitir el item — se pierde la trazabilidad GOES.
4. **Priorizar tests de seguridad** sobre tests funcionales. Cada servicio debe tener al minimo:
   - Tests funcionales (CRUD/logica) con epic 'Dominio'
   - Tests de validacion de entrada con epic 'Seguridad'
   - Tests de autorizacion si aplica con epic 'Autenticacion'
5. **Los comentarios en el codigo van SIN tildes** (ASCII puro). Los strings de metadata (descriptions, steps, stories, epic, feature, story) deben ir en **espanol** con tildes, para que el reporte HTML generado sea consistente con la interfaz del reporter (que esta toda en espanol).
6. **Respetar el tsconfig.json del proyecto.** Si `ignoreDeprecations` esta en "5.0", NO cambiarlo a "6.0".
7. **Cada test debe ser independiente** — no depender del orden de ejecucion ni de estado compartido.
8. **Usar mocks del ORM** (Prisma, TypeORM, etc.) — no conectar a BD real en unit tests.
9. **Cada test DEBE terminar con `await t.flush()`** — sin esto la metadata no llega al reporte.
10. **NO instalar Allure, allure-commandline ni Java** — este sistema usa un reporter custom puro Node.js que genera HTML directamente.
11. **El reporter html-reporter.js DEBE ser JavaScript puro** — Jest carga reporters con `require()`, no pasa por ts-jest. Si necesitas modificarlo, no lo conviertas a TypeScript.
12. **Los archivos de spec deben terminar en `.security-html.spec.ts`** — este es el patron que el jest config busca.
13. **Cada test DEBE registrar al menos un par input + output en `t.evidence(...)`** — un evidence sin contraparte es incompleto. El primero captura el estado/payload de entrada, el segundo el resultado/respuesta. Ver "Regla critica: evidence (input + output)" mas arriba para nombres recomendados por tipo de test.
14. **Modo audit-only (opt-in via prompt)** — si el usuario incluye en su mensaje una instruccion del tipo *"NO modifiques codigo fuente"*, *"solo generar tests sin arreglar src/"*, *"audit-only mode"* o equivalente, respetarla estrictamente: dejar tests rojos como hallazgos, NO tocar archivos de aplicacion (`src/`, `main.ts`, controllers, services, DTOs, guards), solo modificar `test/security/`, `package.json`, `eslint.config.mjs`, `.gitignore` y `.claude/`. Si el usuario NO lo pide explicitamente, Claude tiene el comportamiento estandar (puede sugerir y aplicar fixes si lo considera apropiado).
