# Pattern 17: Debug Mode & HTTP Methods

> **Migration note (skill v1.1):** these patterns were originally written for
> `allure-js-commons`. They now run against the bundled custom HTML reporter
> via `AllureCompat`, which mirrors the same API. The `_setup.md` snippet
> shows the new top-level imports. Existing `await allure.epic(...)`,
> `await allure.step(...)` etc. work identically. Two extras:
>
> - Each `it(...)` block must end with `await allure.flush();` so the metadata
>   reaches the reporter.
> - `attach(name, data)` is now async — call it as `await attach(...)`.

**Covers:** R43 (Debug Mode Disabled), R52 (HTTP PUT Disabled), R53 (HTTP TRACE Disabled), R54 (HTTP Override Disabled)

```typescript
it('should have debug mode disabled in production', async () => {
  const allure = new AllureCompat();
  const attach = attachFor(allure);
  await allure.epic('Configuration');
  await allure.feature('Debug Mode Disabled');
  await allure.story('No debug endpoints or stack traces in production');
  await allure.severity('critical');
  await allure.tag('Config');
  await allure.tag('OWASP A05');
  await allure.tag('GOES Checklist R43');
  await allure.description(
    '## Objective\n' +
    'Verify that debug mode, devtools, and verbose error output\n' +
    'are disabled in production builds.\n\n' +
    '## Reference\n' +
    'GOES Guide Section 9.1 — Secure Errors',
  );

  await allure.step('Verify: NODE_ENV is production or test (not development)', async () => {
    // In a real production check, NODE_ENV should be "production"
    expect(process.env.NODE_ENV).not.toBe('development');
  });

  await allure.step('Verify: debug endpoints are not exposed', async () => {
    const debugPaths = ['/debug', '/api/debug', '/_debug', '/graphql'];
    for (const path of debugPaths) {
      const response = await request(app.getHttpServer()).get(path);
      expect(response.status).not.toBe(200);
    }
  });

  await allure.step('Verify: error responses do not include stack traces', async () => {
    const response = await request(app.getHttpServer()).get('/api/nonexistent');
    expect(JSON.stringify(response.body)).not.toContain('at Object.');
    expect(JSON.stringify(response.body)).not.toContain('node_modules');
    expect(JSON.stringify(response.body)).not.toContain('.ts:');
  });

  await attach('Debug mode check (output)', {
    debugDisabled: true,
    noStackTraces: true,
  });
  await allure.flush();
});

it('PENTEST: should disable HTTP TRACE method', async () => {
  const allure = new AllureCompat();
  const attach = attachFor(allure);
  await allure.epic('Configuration');
  await allure.feature('HTTP TRACE Disabled');
  await allure.story('HTTP TRACE method must be disabled to prevent XST attacks');
  await allure.severity('critical');
  await allure.tag('Pentest');
  await allure.tag('OWASP A05');
  await allure.tag('GOES Checklist R53');
  await allure.description(
    '## Vulnerability Prevented\n' +
    '**Cross-Site Tracing (XST)** — The TRACE method echoes back the\n' +
    'full request including cookies and auth headers, which can be\n' +
    'exploited by attackers to steal credentials.\n\n' +
    '## Defense Implemented\n' +
    'HTTP TRACE method is disabled at the server level.',
  );

  await allure.step('Execute: send TRACE request', async () => {
    const response = await request(app.getHttpServer()).trace('/api/health');
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).not.toBe(200);
  });

  await attach('TRACE test (output)', { traceDisabled: true });
  await allure.flush();
});

it('should disable HTTP PUT method if not used', async () => {
  const allure = new AllureCompat();
  const attach = attachFor(allure);
  await allure.epic('Configuration');
  await allure.feature('HTTP PUT Disabled');
  await allure.story('Unused HTTP methods should be disabled');
  await allure.severity('normal');
  await allure.tag('Config');
  await allure.tag('GOES Checklist R52');
  await allure.description(
    '## Objective\n' +
    'Verify that HTTP PUT is disabled if the API uses PATCH for updates.\n' +
    'Reducing the attack surface by disabling unused methods.',
  );

  await allure.step('Verify: PUT returns 405 or 404 on common endpoints', async () => {
    const endpoints = ['/api/users/1', '/api/posts/1'];
    for (const endpoint of endpoints) {
      const response = await request(app.getHttpServer()).put(endpoint).send({});
      expect([404, 405]).toContain(response.status);
    }
  });

  await attach('HTTP PUT test (output)', { putDisabled: true });
  await allure.flush();
});

it('PENTEST: should disable HTTP method override', async () => {
  const allure = new AllureCompat();
  const attach = attachFor(allure);
  await allure.epic('Configuration');
  await allure.feature('HTTP Override Disabled');
  await allure.story('X-HTTP-Method-Override header must be ignored');
  await allure.severity('critical');
  await allure.tag('Pentest');
  await allure.tag('OWASP A05');
  await allure.tag('GOES Checklist R54');
  await allure.description(
    '## Vulnerability Prevented\n' +
    '**HTTP Method Override** — Attackers use X-HTTP-Method-Override header\n' +
    'to bypass method-based access controls (e.g., sending a POST with\n' +
    'X-HTTP-Method-Override: DELETE).\n\n' +
    '## Defense Implemented\n' +
    'The server ignores method override headers.',
  );

  await allure.step('Execute: POST with X-HTTP-Method-Override: DELETE', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/users/1')
      .set('X-HTTP-Method-Override', 'DELETE')
      .send({});

    // Should NOT delete the resource
    expect(response.status).not.toBe(200);
  });

  await allure.step('Verify: resource still exists', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/users/1')
      .set('Authorization', `Bearer ${validToken}`);
    expect(response.status).not.toBe(404);
  });

  await attach('Method override test (output)', { overrideDisabled: true });
  await allure.flush();
});
```
