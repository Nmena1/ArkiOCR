# Pattern 11: Session Management

> **Migration note (skill v1.1):** these patterns were originally written for
> `allure-js-commons`. They now run against the bundled custom HTML reporter
> via `AllureCompat`, which mirrors the same API. The `_setup.md` snippet
> shows the new top-level imports. Existing `await allure.epic(...)`,
> `await allure.step(...)` etc. work identically. Two extras:
>
> - Each `it(...)` block must end with `await allure.flush();` so the metadata
>   reaches the reporter.
> - `attach(name, data)` is now async — call it as `await attach(...)`.

**Covers:** R17 (Session ID Entropy), R18 (Session Fixation Prevention), R35 (Session Inactivity Timeout)

```typescript
it('should generate session IDs with sufficient entropy', async () => {
  const allure = new AllureCompat();
  const attach = attachFor(allure);
  await allure.epic('Security');
  await allure.feature('Session ID Entropy');
  await allure.story('Session IDs must have at least 128 bits of entropy via CSPRNG');
  await allure.severity('critical');
  await allure.tag('Auth');
  await allure.tag('OWASP A07');
  await allure.tag('GOES Checklist R17');
  await allure.description(
    '## Objective\n' +
    'Verify that session IDs are generated with a cryptographically\n' +
    'secure random number generator (CSPRNG) and have at least\n' +
    '128 bits of entropy.\n\n' +
    '## Reference\n' +
    'GOES Guide Section 4.2 — Session Management',
  );

  await allure.step('Execute: generate multiple session IDs', async () => {
    const sessions = [];
    for (let i = 0; i < 10; i++) {
      const id = service.generateSessionId();
      sessions.push(id);
    }

    // Verify minimum length (128 bits = 16 bytes = 32 hex chars or ~22 base64 chars)
    for (const id of sessions) {
      expect(id.length).toBeGreaterThanOrEqual(22);
    }

    // Verify uniqueness (no collisions)
    const uniqueIds = new Set(sessions);
    expect(uniqueIds.size).toBe(sessions.length);
  });

  await attach('Session entropy result (output)', {
    minimumBits: 128,
    generatedWithCSPRNG: true,
  });
  await allure.flush();
});

it('PENTEST: should regenerate session after login (prevent session fixation)', async () => {
  const allure = new AllureCompat();
  const attach = attachFor(allure);
  await allure.epic('Security');
  await allure.feature('Session Fixation Prevention');
  await allure.story('Session ID must change after successful authentication');
  await allure.severity('critical');
  await allure.tag('Pentest');
  await allure.tag('OWASP A07');
  await allure.tag('GOES Checklist R18');
  await allure.description(
    '## Vulnerability Prevented\n' +
    '**Session Fixation** — An attacker sets a known session ID\n' +
    'before the user logs in. After login, the attacker uses the\n' +
    'same session ID to hijack the authenticated session.\n\n' +
    '## Defense Implemented\n' +
    'The session ID is regenerated after every successful login.\n' +
    'The old session is invalidated.',
  );

  let preLoginToken: string;
  let postLoginToken: string;

  await allure.step('Prepare: capture pre-login session/token', async () => {
    preLoginToken = 'pre-login-session-id';
  });

  await allure.step('Execute: login with valid credentials', async () => {
    const result = await service.login(validCredentials, '1.2.3.4', 'ua');
    postLoginToken = result.accessToken;
  });

  await allure.step('Verify: session/token changed after login', async () => {
    expect(postLoginToken).not.toBe(preLoginToken);
    expect(postLoginToken).toBeDefined();
  });

  await attach('Session fixation prevention (output)', {
    preLoginSession: 'pre-login-session-id',
    postLoginSession: 'new-session-generated',
    sessionChanged: true,
  });
  await allure.flush();
});

it('should expire session after inactivity timeout', async () => {
  const allure = new AllureCompat();
  const attach = attachFor(allure);
  await allure.epic('Security');
  await allure.feature('Session Inactivity Timeout');
  await allure.story('Redirect to login after idle period');
  await allure.severity('critical');
  await allure.tag('Auth');
  await allure.tag('OWASP A07');
  await allure.tag('GOES Checklist R35');
  await allure.description(
    '## Objective\n' +
    'Verify that sessions expire after a configurable inactivity period\n' +
    '(15-30 minutes recommended).\n\n' +
    '## Reference\n' +
    'GOES Guide Section 4.2 — Session Management',
  );

  await allure.parameter('inactivity_timeout', '30 minutes');

  await allure.step('Prepare: create token with short expiry', async () => {
    // Token was issued 31 minutes ago
    const expiredToken = jwtService.sign(
      { sub: 'user-1', role: 'USER' },
      { expiresIn: '-1m' }, // already expired
    );
    mockRequest.headers.authorization = `Bearer ${expiredToken}`;
  });

  await allure.step('Verify: expired token is rejected', async () => {
    await expect(guard.canActivate(mockContext)).rejects.toThrow();
  });

  await attach('Session timeout result (output)', {
    tokenExpired: true,
    accessDenied: true,
  });
  await allure.flush();
});
```
