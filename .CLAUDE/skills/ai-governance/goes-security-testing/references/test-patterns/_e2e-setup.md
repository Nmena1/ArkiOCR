# E2E Test Setup — For patterns that need a running app

> **Migration note (skill v1.1):** these patterns were originally written for
> `allure-js-commons`. They now run against the bundled custom HTML reporter
> via `AllureCompat`, which mirrors the same API. The `_setup.md` snippet
> shows the new top-level imports. Existing `await allure.epic(...)`,
> `await allure.step(...)` etc. work identically. Two extras:
>
> - Each `it(...)` block must end with `await allure.flush();` so the metadata
>   reaches the reporter.
> - `attach(name, data)` is now async — call it as `await attach(...)`.

Some test patterns require a running NestJS application to test HTTP-level behavior.
These patterns use `supertest` to make real HTTP requests against the app.

## Which patterns need E2E?

| Pattern | Type | Why |
|---------|------|-----|
| 03 - Error Handling (R22: 404) | E2E | Need to test actual HTTP responses for undefined routes |
| 12 - Forced Browsing (R21) | E2E | Need to test actual route protection without a token |
| 16 - Security Headers (R44-R50) | E2E | Need to inspect actual response headers |
| 17 - Debug & HTTP Methods (R43, R52-R54) | E2E | Need to test actual HTTP method handling |
| 15 - Cookie Security (R42) | E2E | Need to inspect Set-Cookie header |
| 19 - Rate Limiting (R55) | E2E | Can test via ThrottlerGuard mock OR via supertest |

All other patterns are **unit tests** that mock the ORM and test service logic directly.

## E2E test file location

E2E security tests go in the same folder but with a different name:

```
test/
  security/
    auth-service.security.spec.ts          <-- unit tests
    users-service.security.spec.ts         <-- unit tests
    app-security-headers.e2e.spec.ts       <-- e2e tests
    app-http-methods.e2e.spec.ts           <-- e2e tests
    app-routes.e2e.spec.ts                 <-- e2e tests
```

## E2E basic setup

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AllureCompat, attachFor } from '@security-reporter/metadata';
import { AppModule } from '../../src/app.module';

// E2E tests follow the same skeleton as unit tests:
//   const allure = new AllureCompat();
//   const attach = attachFor(allure);
//   ...
//   await allure.flush();
//
// Instantiate them inside each it(...) so metadata is scoped per test.

describe('App Security — E2E', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      // Override database connection to use in-memory or mock
      .overrideProvider('DATABASE_CONNECTION')
      .useValue({})
      .compile();

    app = moduleFixture.createNestApplication();

    // IMPORTANT: Apply the same middleware/pipes/guards as in main.ts
    // This is critical — without this, headers, validation pipes,
    // and guards won't be active in the test app.
    //
    // Copy the setup from main.ts:
    // app.use(helmet());
    // app.enableCors({ origin: [...], credentials: true });
    // app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    // app.useGlobalGuards(new ThrottlerGuard());
    // etc.

    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  // E2E tests go here...
});
```

## Example: Security Headers E2E test

```typescript
it('should include all required security headers in response', async () => {
  const allure = new AllureCompat();
  const attach = attachFor(allure);
  await allure.epic('Configuration');
  await allure.feature('Security Headers');
  await allure.severity('critical');
  await allure.tag('Config');
  await allure.tag('OWASP A05');
  await allure.tag('GOES Checklist R44');

  const response = await request(app.getHttpServer())
    .get('/api/health')
    .expect(200);

  await allure.step('Verify: Content-Security-Policy present', async () => {
    expect(response.headers['content-security-policy']).toBeDefined();
  });

  await allure.step('Verify: X-Content-Type-Options: nosniff', async () => {
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });

  // ... more header checks

  await attach('Response headers (output)', response.headers);
  await allure.flush();
});
```

## IMPORTANT: main.ts mirror

The most common mistake in E2E tests is forgetting to apply the same configuration
as `main.ts`. Read the project's `main.ts` (or `bootstrap()` function) and replicate:

1. **Helmet** — `app.use(helmet({ ... }))`
2. **CORS** — `app.enableCors({ ... })`
3. **Global pipes** — `app.useGlobalPipes(new ValidationPipe({ ... }))`
4. **Global guards** — `app.useGlobalGuards(...)`
5. **Global interceptors** — `app.useGlobalInterceptors(...)`
6. **Global filters** — `app.useGlobalFilters(...)`
7. **Prefix** — `app.setGlobalPrefix('api')`

Without this, the E2E tests will pass even when the real app is misconfigured.
