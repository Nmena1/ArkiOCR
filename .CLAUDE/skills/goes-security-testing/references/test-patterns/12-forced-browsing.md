# Pattern 12: Forced Browsing / Token Per Request

> **Migration note (skill v1.1):** these patterns were originally written for
> `allure-js-commons`. They now run against the bundled custom HTML reporter
> via `AllureCompat`, which mirrors the same API. The `_setup.md` snippet
> shows the new top-level imports. Existing `await allure.epic(...)`,
> `await allure.step(...)` etc. work identically. Two extras:
>
> - Each `it(...)` block must end with `await allure.flush();` so the metadata
>   reaches the reporter.
> - `attach(name, data)` is now async — call it as `await attach(...)`.

**Covers:** R21 (Forced Browsing Prevention), R33 (Token Validation Per Request)

```typescript
it('PENTEST: should block forced navigation to protected routes', async () => {
  const allure = new AllureCompat();
  const attach = attachFor(allure);
  await allure.epic('Authentication');
  await allure.feature('Forced Browsing Prevention');
  await allure.story('Unauthenticated users cannot access private endpoints');
  await allure.severity('critical');
  await allure.tag('Pentest');
  await allure.tag('OWASP A01');
  await allure.tag('GOES Checklist R21');
  await allure.description(
    '## Vulnerability Prevented\n' +
    '**Forced Browsing** — An attacker directly types URLs to access\n' +
    'protected resources without authentication.\n\n' +
    '## Defense Implemented\n' +
    'All private endpoints are protected by JwtAuthGuard.\n' +
    'Requests without a valid token receive 401 Unauthorized.',
  );

  const protectedEndpoints = [
    '/api/users/profile',
    '/api/users',
    '/api/admin/dashboard',
    '/api/settings',
  ];

  for (const endpoint of protectedEndpoints) {
    await allure.step(`Test: access ${endpoint} without token`, async () => {
      // Simulate request without Authorization header
      const mockContext = createMockContext(null, endpoint);
      await expect(guard.canActivate(mockContext)).rejects.toThrow('Unauthorized');
    });
  }

  await attach('Forced browsing test (output)', {
    endpoints: protectedEndpoints,
    allBlocked: true,
  });
  await allure.flush();
});

it('should validate token on every private request', async () => {
  const allure = new AllureCompat();
  const attach = attachFor(allure);
  await allure.epic('Authentication');
  await allure.feature('Token Validation Per Request');
  await allure.story('Every private endpoint validates the JWT on each request');
  await allure.severity('blocker');
  await allure.tag('Auth');
  await allure.tag('OWASP A07');
  await allure.tag('GOES Checklist R33');
  await allure.description(
    '## Objective\n' +
    'Verify that the auth guard validates the JWT signature, expiration,\n' +
    'and claims on every single request — not just on login.',
  );

  await allure.step('Test: valid token is accepted', async () => {
    const validToken = jwtService.sign({ sub: 'user-1', role: 'USER' });
    const mockContext = createMockContext({ token: validToken });
    await expect(guard.canActivate(mockContext)).resolves.toBe(true);
  });

  await allure.step('Test: expired token is rejected', async () => {
    jwtService.verifyAsync.mockRejectedValue(new Error('jwt expired'));
    await expect(guard.canActivate(mockContext)).rejects.toThrow();
  });

  await allure.step('Test: tampered token is rejected', async () => {
    jwtService.verifyAsync.mockRejectedValue(new Error('invalid signature'));
    await expect(guard.canActivate(mockContext)).rejects.toThrow();
  });

  await allure.step('Test: missing token is rejected', async () => {
    const noTokenContext = createMockContext(null);
    await expect(guard.canActivate(noTokenContext)).rejects.toThrow();
  });

  await attach('Token validation results (output)', {
    validAccepted: true,
    expiredRejected: true,
    tamperedRejected: true,
    missingRejected: true,
  });
  await allure.flush();
});
```
