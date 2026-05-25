# Pattern 19: Rate Limiting

> **Migration note (skill v1.1):** these patterns were originally written for
> `allure-js-commons`. They now run against the bundled custom HTML reporter
> via `AllureCompat`, which mirrors the same API. The `_setup.md` snippet
> shows the new top-level imports. Existing `await allure.epic(...)`,
> `await allure.step(...)` etc. work identically. Two extras:
>
> - Each `it(...)` block must end with `await allure.flush();` so the metadata
>   reaches the reporter.
> - `attach(name, data)` is now async — call it as `await attach(...)`.

**Covers:** R55 (Rate Limiting)

> **MANDATORY 3-layer coverage** (per SKILL.md "cobertura de 3 capas").
> A test for R55 that ONLY checks env vars (e.g. `cfg.rateLimit.loginMaxAttempts <= 5`) is **invalid** — if a developer comments out `@Throttle` from the controller, the env-only test stays green and the control is silently disabled in runtime.
>
> The R55 spec MUST include all three blocks below. Place this spec in the **auth controller test file** (where the `@Throttle` decorator lives), NOT in a config-only test file:
>
> 1. **Configuration** — env / module values within range
> 2. **Application** — `@Throttle` decorator present on `login`/`register` (via `Reflect.getMetadata`)
> 3. **Behavior** — request that exceeds the limit returns 429 (mock or supertest)
>
> If the project removes `@Throttle`, block #2 fails. If the env vars regress, block #1 fails. If the throttler is misconfigured, block #3 fails.

```typescript
it('PENTEST: should reject requests that exceed the rate limit', async () => {
  const allure = new AllureCompat();
  const attach = attachFor(allure);
  await allure.epic('Security');
  await allure.feature('Rate Limiting');
  await allure.story('Block excessive requests per IP');
  await allure.severity('blocker');
  await allure.tag('Pentest');
  await allure.tag('OWASP A04');
  await allure.tag('OWASP API4');
  await allure.tag('GOES Checklist R55');
  await allure.description(
    '## Vulnerability Prevented\n' +
    '**DoS / Brute Force** — An attacker sends thousands of requests\n' +
    'to overwhelm the server or try combinations by brute force.\n\n' +
    '## Defense Implemented\n' +
    'Rate limiting with ThrottlerGuard: 100 req/min for normal endpoints,\n' +
    '5 req/min for login. Responds 429 Too Many Requests\n' +
    'with Retry-After header.\n\n' +
    '## Reference\n' +
    'OWASP A04:2021 — Insecure Design\n' +
    'GOES Guide Section 6 — API Security',
  );

  await allure.parameter('normal_limit', '100 req/min');
  await allure.parameter('login_limit', '5 req/min');

  await allure.step('Prepare: simulate IP already exceeded the limit', async () => {
    // Adapt to the project's actual throttler (ThrottlerGuard, express-rate-limit, etc.)
    mockThrottler.isRateLimited.mockReturnValue(true);
  });

  await attach('Attacker state (input)', {
    ip: '192.168.1.100',
    endpoint: '/auth/login',
    requestsInLastMinute: 6,
    limit: 5,
  });

  await allure.step('Execute: request that exceeds the limit', async () => {
    await expect(
      controller.login(dto, mockRequest),
    ).rejects.toThrow('ThrottlerException');
  });

  await allure.step('Verify: 429 response with Retry-After', async () => {
    expect(mockResponse.statusCode).toBe(429);
  });

  await attach('Defense response (output)', {
    statusCode: 429,
    message: 'Too Many Requests',
    retryAfter: '60 seconds',
    note: 'IP temporarily blocked for exceeding limit',
  });
  await allure.flush();
});

// LAYER 2 (mandatory) — verify the @Throttle decorator is APPLIED to
// the actual endpoints. This is the test that catches a developer
// commenting out @Throttle.
it('R55 — @Throttle decorator is applied on login and register', async () => {
  const t = report();
  t.epic('Seguridad');
  t.feature('Rate Limiting');
  t.story('Login y register tienen @Throttle aplicado en el controller');
  t.severity('blocker');
  t.tag('Auth', 'OWASP API2', 'GOES Checklist R55');

  // Read the throttler metadata from the controller methods themselves.
  // Adapt the metadata key to your throttler library:
  //   - @nestjs/throttler v5+: 'THROTTLER:LIMIT' / 'throttler:options'
  //   - express-rate-limit: check the middleware on the route
  const loginMeta = Reflect.getMetadata('throttler:options', AuthController.prototype.login)
    || Reflect.getMetadata('THROTTLER:LIMIT', AuthController.prototype.login);
  const registerMeta = Reflect.getMetadata('throttler:options', AuthController.prototype.register)
    || Reflect.getMetadata('THROTTLER:LIMIT', AuthController.prototype.register);

  t.evidence('Decorator metadata (input)', {
    method: 'AuthController.login / register',
    metadataKey: 'throttler:options',
  });

  t.step('Verify: login has @Throttle metadata');
  expect(loginMeta).toBeDefined();

  t.step('Verify: register has @Throttle metadata');
  expect(registerMeta).toBeDefined();

  t.evidence('Resolved metadata (output)', {
    login: loginMeta,
    register: registerMeta,
  });

  await t.flush();
});

// LAYER 3 (mandatory or skip with justification) — verify behavior:
// the 6th login request within a minute returns 429.
it('R55 — Login endpoint returns 429 after 5 attempts in 60s', async () => {
  const t = report();
  t.epic('Seguridad');
  t.feature('Rate Limiting');
  t.story('Sexta request al login en menos de 60s devuelve 429');
  t.severity('blocker');
  t.tag('Pentest', 'OWASP A04', 'OWASP API4', 'GOES Checklist R55');

  t.evidence('Attack scenario (input)', {
    endpoint: '/auth/login',
    attemptsInWindow: 6,
    windowSeconds: 60,
    expectedLimit: 5,
  });

  // E2E with supertest — replicates the main.ts setup so the global
  // ThrottlerGuard is active. If the project doesn't have an E2E
  // bootstrap yet, see _e2e-setup.md.
  t.step('Execute: send 6 login requests rapidly');
  let lastStatus = 0;
  for (let i = 0; i < 6; i++) {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'test@goes.gob.sv', password: 'wrong' });
    lastStatus = res.status;
  }

  t.step('Verify: 6th request was rate limited (429)');
  expect(lastStatus).toBe(429);

  t.evidence('Defense response (output)', {
    sixthRequestStatus: lastStatus,
    expected: 429,
  });

  await t.flush();
});
```

## Anti-pattern — what NOT to do

The following test is **invalid** for R55 even if the assertions pass.
A developer can comment out `@Throttle` and this test stays green.

```typescript
// ❌ DO NOT WRITE TESTS LIKE THIS for R55
it('R55 — env config has correct rate limit values', async () => {
  expect(cfg.rateLimit.loginMaxAttempts).toBeLessThanOrEqual(5);
  expect(cfg.rateLimit.globalMaxRequests).toBeLessThanOrEqual(200);
  expect(cfg.rateLimit.loginWindowMs).toBe(60000);
  // ← only checks env vars; never verifies @Throttle is applied
  // ← never sends requests to verify 429 behavior
});
```

This kind of test is acceptable as **Layer 1 supplement** but never as the
sole R55 coverage. Always pair it with Layer 2 (decorator) and Layer 3
(behavior).
