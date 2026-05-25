# Pattern 14: CORS Configuration

> **Migration note (skill v1.1):** these patterns were originally written for
> `allure-js-commons`. They now run against the bundled custom HTML reporter
> via `AllureCompat`, which mirrors the same API. The `_setup.md` snippet
> shows the new top-level imports. Existing `await allure.epic(...)`,
> `await allure.step(...)` etc. work identically. Two extras:
>
> - Each `it(...)` block must end with `await allure.flush();` so the metadata
>   reaches the reporter.
> - `attach(name, data)` is now async — call it as `await attach(...)`.

**Covers:** R38 (CORS Origin Restriction), R39 (CORS Methods Restriction), R40 (CORS Credentials Policy), R41 (CORS Preflight Cache)

```typescript
it('PENTEST: should restrict CORS to allowed origins only (no wildcard)', async () => {
  const allure = new AllureCompat();
  const attach = attachFor(allure);
  await allure.epic('Configuration');
  await allure.feature('CORS Origin Restriction');
  await allure.story('Access-Control-Allow-Origin must not be wildcard *');
  await allure.severity('critical');
  await allure.tag('Pentest');
  await allure.tag('OWASP A05');
  await allure.tag('OWASP API8');
  await allure.tag('GOES Checklist R38');
  await allure.description(
    '## Vulnerability Prevented\n' +
    '**CORS Misconfiguration** — Using wildcard (*) allows any website\n' +
    'to make authenticated requests to your API.\n\n' +
    '## Defense Implemented\n' +
    'CORS is configured with a whitelist of specific allowed origins.\n' +
    'Requests from unknown origins are rejected.\n\n' +
    '## Reference\n' +
    'GOES Guide Section 8 — CORS',
  );

  await allure.step('Verify: CORS origin is not wildcard', async () => {
    // Adapt to the actual CORS config (main.ts, cors middleware, etc.)
    expect(corsConfig.origin).not.toBe('*');
    expect(corsConfig.origin).not.toContain('*');
  });

  await allure.step('Verify: only specific origins are allowed', async () => {
    const allowedOrigins = Array.isArray(corsConfig.origin)
      ? corsConfig.origin
      : [corsConfig.origin];

    for (const origin of allowedOrigins) {
      expect(origin).toMatch(/^https?:\/\//); // must be a real URL
    }
  });

  await attach('CORS origin config (output)', {
    wildcard: false,
    origins: corsConfig.origin,
  });
  await allure.flush();
});

it('should restrict CORS methods to only those needed', async () => {
  const allure = new AllureCompat();
  const attach = attachFor(allure);
  await allure.epic('Configuration');
  await allure.feature('CORS Methods Restriction');
  await allure.story('Only necessary HTTP methods allowed in CORS');
  await allure.severity('critical');
  await allure.tag('Config');
  await allure.tag('GOES Checklist R39');
  await allure.description(
    '## Objective\n' +
    'Verify that CORS only allows the HTTP methods that are actually\n' +
    'used by the application (GET, POST, PATCH, DELETE).\n' +
    'Unused methods like PUT, TRACE, OPTIONS should not be listed.',
  );

  await allure.step('Verify: only necessary methods are allowed', async () => {
    const allowedMethods = corsConfig.methods || [];
    // TRACE should never be allowed
    expect(allowedMethods).not.toContain('TRACE');
    // Verify no wildcard
    expect(allowedMethods).not.toContain('*');
  });

  await attach('CORS methods (output)', { methods: corsConfig.methods });
  await allure.flush();
});

it('should configure CORS credentials correctly', async () => {
  const allure = new AllureCompat();
  const attach = attachFor(allure);
  await allure.epic('Configuration');
  await allure.feature('CORS Credentials Policy');
  await allure.story('credentials: true only if cookies are needed');
  await allure.severity('normal');
  await allure.tag('Config');
  await allure.tag('GOES Checklist R40');
  await allure.tag('GOES Checklist R41');
  await allure.description(
    '## Objective\n' +
    'Verify that Access-Control-Allow-Credentials is only true if\n' +
    'the app uses cookies for auth. Preflight should be cached.\n\n' +
    '## Reference\n' +
    'GOES Guide Section 8 — CORS',
  );

  await allure.step('Verify: credentials policy is intentional', async () => {
    if (corsConfig.credentials === true) {
      // If credentials are enabled, origin MUST NOT be wildcard
      expect(corsConfig.origin).not.toBe('*');
    }
  });

  await allure.step('Verify: preflight cache is set', async () => {
    // maxAge should be set (recommended: 3600 = 1 hour)
    expect(corsConfig.maxAge).toBeDefined();
    expect(corsConfig.maxAge).toBeGreaterThanOrEqual(600);
  });

  await attach('CORS credentials config (output)', {
    credentials: corsConfig.credentials,
    maxAge: corsConfig.maxAge,
    originNotWildcard: corsConfig.origin !== '*',
  });
  await allure.flush();
});
```
