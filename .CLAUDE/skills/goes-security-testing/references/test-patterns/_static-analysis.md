# Static Analysis Helper — `stripComments`

When verifying the **presence of code** in source files (`main.ts`, `app.module.ts`, controllers, etc.), a naive regex match fails the moment a developer **comments out** the code instead of deleting it. A line like `// app.use(helmet());` would still match `/helmet\(\)/` and the test would falsely report the middleware as active.

This file documents the **canonical helper** the skill uses for static analysis. Every test that inspects source files for the presence of imports, middleware, decorators, module registrations, etc. **MUST** strip comments first.

## When to use static analysis vs `Reflect.getMetadata`

| Situation | Use |
|---|---|
| You can import the class with decorators (controllers, services, DTOs) | `Reflect.getMetadata(...)` — direct, type-safe |
| `main.ts` setup (`app.use(helmet())`, `app.useGlobalPipes(...)`) | Static analysis with `stripComments` |
| Module imports in `@Module({ imports: [...] })` | Static analysis with `stripComments` |
| Verifying **absence** of dangerous patterns (`$queryRawUnsafe`, raw SQL) | Static analysis with `stripComments` |
| Anything where the code is not exposed via runtime metadata | Static analysis with `stripComments` |

## Canonical helper

Drop this at the top of any spec that inspects source files:

```typescript
import * as fs from 'fs';
import * as path from 'path';

/**
 * Strip block (\/* *\/) and line (\/\/) comments from a source file.
 * Required before regex-matching for the presence of code: a developer
 * who comments out a line (instead of deleting it) must register as
 * having REMOVED the code, not as having it active.
 *
 * The line-comment regex preserves the URL form `http://` by requiring
 * the '/' be either at line start or preceded by a non-':' character.
 */
const stripComments = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

/** Read a project source file relative to the spec file's location. */
const readSrc = (relativePath: string): string =>
  stripComments(
    fs.readFileSync(path.resolve(__dirname, relativePath), 'utf-8'),
  );
```

## Usage examples

### Verify `main.ts` applies helmet, CORS, ValidationPipe, cookieParser

```typescript
it('R44-R50 — main.ts wires global security middleware', async () => {
  const t = report();
  t.epic('Configuracion');
  t.feature('Bootstrap Security Setup');
  t.story('main.ts aplica helmet, CORS, ValidationPipe global y cookieParser');
  t.severity('blocker');
  t.tag('Config', 'OWASP A05', 'GOES Checklist R44', 'GOES Checklist R45',
        'GOES Checklist R46', 'GOES Checklist R5');

  const main = readSrc('../../src/main.ts');

  t.evidence('Source inspected (input)', { file: 'src/main.ts', commentsStripped: true });

  t.step('Verify: helmet is applied');
  expect(main).toMatch(/app\.use\(\s*helmet\(/);

  t.step('Verify: CORS is enabled with explicit origin allowlist');
  expect(main).toMatch(/app\.enableCors\(/);
  expect(main).not.toMatch(/origin\s*:\s*['"]?\*['"]?/);  // never wildcard

  t.step('Verify: ValidationPipe is registered globally');
  expect(main).toMatch(/app\.useGlobalPipes\([^)]*ValidationPipe/);

  t.step('Verify: cookie-parser is wired');
  expect(main).toMatch(/app\.use\(\s*cookieParser/);

  t.evidence('Bootstrap checks (output)', {
    helmet: true, cors: true, validationPipe: true, cookieParser: true,
  });
  await t.flush();
});
```

### Verify `auth.module.ts` registers `ThrottlerModule`

```typescript
it('R55 — AuthModule imports ThrottlerModule', async () => {
  const t = report();
  t.epic('Seguridad');
  t.feature('Rate Limiting');
  t.story('AuthModule registra ThrottlerModule en sus imports');
  t.severity('blocker');
  t.tag('Config', 'OWASP API2', 'GOES Checklist R55');

  const authModule = readSrc('../../src/modules/auth/auth.module.ts');

  t.evidence('Module file (input)', { file: 'src/modules/auth/auth.module.ts' });

  t.step('Verify: ThrottlerModule is imported');
  expect(authModule).toMatch(/import\s+\{[^}]*ThrottlerModule[^}]*\}\s+from\s+['"]@nestjs\/throttler/);

  t.step('Verify: ThrottlerModule is added to imports array');
  expect(authModule).toMatch(/imports\s*:\s*\[[\s\S]*ThrottlerModule[\s\S]*\]/);

  t.evidence('Module check (output)', { throttlerImported: true, throttlerRegistered: true });
  await t.flush();
});
```

### Verify the absence of dangerous patterns

(See [pattern 18](18-sql-injection-orm.md) Layer 2 test — same approach with `stripComments` applied per-file before scanning.)

## Anti-pattern — what NOT to do

```typescript
// ❌ DO NOT — naive regex without stripComments
const main = fs.readFileSync('src/main.ts', 'utf-8');
expect(main).toMatch(/app\.use\(helmet/);  // matches a commented-out line!
```

A developer commits this:

```typescript
// app.use(helmet()); // TODO: re-enable after debug session
```

The naive test stays green. helmet is **not** active in production. Audit fails silently.

Always use `stripComments(...)` before regex-matching presence-of-code.

## Why not parse the AST?

We could use TypeScript's compiler API or babel parser instead of regex on stripped source. We don't because:

1. **Simplicity** — `stripComments` is 2 lines; AST setup is 50+ and adds dependencies.
2. **Reporter is JS-only** — keeping helpers in plain Node JS (no `ts-morph`, no `@typescript-eslint/parser`) preserves the skill's zero-dependency promise.
3. **Regex is sufficient for presence checks** — we are not refactoring code; we just verify a string is there.

If a spec needs richer analysis (e.g. detecting a specific call argument shape), upgrade that single test to use the TS Compiler API. But for the 95% case of "is X imported / called / decorated", stripped-source regex is enough.
