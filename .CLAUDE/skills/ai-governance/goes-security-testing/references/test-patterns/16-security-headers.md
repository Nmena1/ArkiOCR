# Pattern 16: HTTP Security Headers

> **Migration note (skill v1.1):** these patterns were originally written for
> `allure-js-commons`. They now run against the bundled custom HTML reporter
> via `AllureCompat`, which mirrors the same API. The `_setup.md` snippet
> shows the new top-level imports. Existing `await allure.epic(...)`,
> `await allure.step(...)` etc. work identically. Two extras:
>
> - Each `it(...)` block must end with `await allure.flush();` so the metadata
>   reaches the reporter.
> - `attach(name, data)` is now async — call it as `await attach(...)`.

**Covers:** R44 (CSP), R45 (X-Content-Type-Options, X-Frame-Options), R46 (HSTS), R47 (X-XSS-Protection), R48 (Referrer-Policy), R49 (Permissions-Policy), R50 (Cache-Control)

```typescript
it('should configure all required HTTP security headers', async () => {
  const allure = new AllureCompat();
  const attach = attachFor(allure);
  await allure.epic('Configuration');
  await allure.feature('Security Headers');
  await allure.story('All HTTP security headers configured per GOES Guide Section 8');
  await allure.severity('critical');
  await allure.tag('Config');
  await allure.tag('OWASP A05');
  await allure.tag('GOES Checklist R44');
  await allure.tag('GOES Checklist R45');
  await allure.tag('GOES Checklist R46');
  await allure.tag('GOES Checklist R47');
  await allure.tag('GOES Checklist R48');
  await allure.tag('GOES Checklist R49');
  await allure.description(
    '## Objective\n' +
    'Verify that all HTTP security headers are correctly configured\n' +
    'according to GOES Guide Section 8.\n\n' +
    '## Required Headers\n' +
    '- Content-Security-Policy: default-src \'self\'\n' +
    '- X-Content-Type-Options: nosniff\n' +
    '- X-Frame-Options: DENY\n' +
    '- Strict-Transport-Security: max-age=31536000\n' +
    '- X-XSS-Protection: 0 (deprecated, rely on CSP)\n' +
    '- Referrer-Policy: strict-origin-when-cross-origin\n' +
    '- Permissions-Policy: geolocation=(), camera=(), microphone=()',
  );

  // Adapt to use supertest or check helmet config directly
  const response = await request(app.getHttpServer()).get('/api/health');

  await allure.step('Verify: Content-Security-Policy', async () => {
    const csp = response.headers['content-security-policy'];
    expect(csp).toBeDefined();
    expect(csp).toContain("default-src 'self'");
  });

  await allure.step('Verify: X-Content-Type-Options: nosniff', async () => {
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });

  await allure.step('Verify: X-Frame-Options: DENY or SAMEORIGIN', async () => {
    const xfo = response.headers['x-frame-options'];
    expect(xfo).toMatch(/^(DENY|SAMEORIGIN)$/i);
  });

  await allure.step('Verify: Strict-Transport-Security (HSTS)', async () => {
    const hsts = response.headers['strict-transport-security'];
    expect(hsts).toBeDefined();
    expect(hsts).toContain('max-age=');
    // min 1 year = 31536000
    const maxAge = parseInt(hsts.match(/max-age=(\d+)/)?.[1] || '0');
    expect(maxAge).toBeGreaterThanOrEqual(31536000);
  });

  await allure.step('Verify: X-XSS-Protection: 0 (deprecated)', async () => {
    const xxss = response.headers['x-xss-protection'];
    if (xxss) {
      expect(xxss).toBe('0');
    }
  });

  await allure.step('Verify: Referrer-Policy', async () => {
    const rp = response.headers['referrer-policy'];
    expect(rp).toBeDefined();
    expect(rp).toMatch(/strict-origin|no-referrer/);
  });

  await allure.step('Verify: Permissions-Policy', async () => {
    const pp = response.headers['permissions-policy'];
    expect(pp).toBeDefined();
    expect(pp).toContain('geolocation=()');
    expect(pp).toContain('camera=()');
  });

  await attach('Security headers (output)', {
    csp: !!response.headers['content-security-policy'],
    xContentType: response.headers['x-content-type-options'],
    xFrameOptions: response.headers['x-frame-options'],
    hsts: !!response.headers['strict-transport-security'],
    referrerPolicy: response.headers['referrer-policy'],
    permissionsPolicy: !!response.headers['permissions-policy'],
  });
  await allure.flush();
});

it('should set Cache-Control: no-store for sensitive responses', async () => {
  const allure = new AllureCompat();
  const attach = attachFor(allure);
  await allure.epic('Configuration');
  await allure.feature('Cache Control Header');
  await allure.story('Sensitive API responses must not be cached');
  await allure.severity('critical');
  await allure.tag('Config');
  await allure.tag('GOES Checklist R50');
  await allure.description(
    '## Objective\n' +
    'Verify that sensitive endpoints (user profile, auth, admin)\n' +
    'include Cache-Control: no-store to prevent caching of sensitive data.',
  );

  const sensitiveEndpoints = [
    '/api/auth/profile',
    '/api/users/me',
    '/api/admin/users',
  ];

  for (const endpoint of sensitiveEndpoints) {
    await allure.step(`Verify: ${endpoint} has no-store`, async () => {
      const response = await request(app.getHttpServer())
        .get(endpoint)
        .set('Authorization', `Bearer ${validToken}`);

      const cacheControl = response.headers['cache-control'];
      expect(cacheControl).toContain('no-store');
    });
  }

  await attach('Cache-Control results (output)', {
    endpoints: sensitiveEndpoints,
    allNoStore: true,
  });
  await allure.flush();
});
```
