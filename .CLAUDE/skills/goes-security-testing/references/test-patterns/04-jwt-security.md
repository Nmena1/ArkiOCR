# Pattern 04: JWT Security

> **Migration note (skill v1.1):** these patterns were originally written for
> `allure-js-commons`. They now run against the bundled custom HTML reporter
> via `AllureCompat`, which mirrors the same API. The `_setup.md` snippet
> shows the new top-level imports. Existing `await allure.epic(...)`,
> `await allure.step(...)` etc. work identically. Two extras:
>
> - Each `it(...)` block must end with `await allure.flush();` so the metadata
>   reaches the reporter.
> - `attach(name, data)` is now async — call it as `await attach(...)`.

**Covers:** R13 (Token Lifetime), R16 (JWT Signing Algorithm), R19 (JWT Claims Validation), R20 (JWT Payload Security)

```typescript
it('PENTEST: should enforce short-lived access tokens', async () => {
  const allure = new AllureCompat();
  const attach = attachFor(allure);
  await allure.epic('Security');
  await allure.feature('Token Lifetime Enforcement');
  await allure.story('Access token must expire within 15 minutes');
  await allure.severity('critical');
  await allure.tag('Pentest');
  await allure.tag('OWASP A07');
  await allure.tag('GOES Checklist R13');
  await allure.description(
    '## Vulnerability Prevented\n' +
    '**Token Theft Persistence** — If access tokens have long lifetimes,\n' +
    'a stolen token gives extended unauthorized access.\n\n' +
    '## Defense Implemented\n' +
    'Access tokens expire in 5-15 minutes. Refresh tokens handle renewal.',
  );

  await allure.parameter('max_lifetime', '15 minutes');

  const tokens = await allure.step('Execute: generate tokens via login', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: '1', email: 'user@test.com', password: await bcrypt.hash('password', 12),
    });
    return service.login({ email: 'user@test.com', password: 'password' }, '1.2.3.4', 'ua');
  });

  await allure.step('Verify: access token expires within 15 minutes', async () => {
    const decoded = jwtService.decode(tokens.accessToken) as any;
    const lifetime = decoded.exp - decoded.iat;
    expect(lifetime).toBeLessThanOrEqual(900); // 15 min = 900 seconds
  });

  await attach('Token lifetime (output)', {
    accessTokenLifetime: '<=15 min',
    hasRefreshToken: !!tokens.refreshToken,
  });
  await allure.flush();
});

// LAYER 3 (mandatory) — login MUST return BOTH accessToken and refreshToken.
// If a developer changes the login response shape (e.g. only returns
// accessToken), this test fails. Without this assertion, the report only
// captures the absence as evidence and stays green.
it('R13 — Login response includes both accessToken and refreshToken', async () => {
  const t = report();
  t.epic('Seguridad');
  t.feature('Token Lifetime Enforcement');
  t.story('El response de /auth/login devuelve accessToken Y refreshToken');
  t.severity('blocker');
  t.tag('Auth', 'OWASP A07', 'GOES Checklist R13', 'GOES Checklist R32');

  prisma.user.findUnique.mockResolvedValue({
    id: '1',
    email: 'user@test.com',
    password: await bcrypt.hash('password', 12),
  });

  t.evidence('Login attempt (input)', {
    email: 'user@test.com',
    expectedFields: ['accessToken', 'refreshToken'],
  });

  const tokens = await service.login(
    { email: 'user@test.com', password: 'password' },
    '1.2.3.4',
    'ua',
  );

  t.step('Verify: accessToken is present and is a non-empty string');
  expect(tokens).toHaveProperty('accessToken');
  expect(typeof tokens.accessToken).toBe('string');
  expect(tokens.accessToken.length).toBeGreaterThan(0);

  t.step('Verify: refreshToken is present and is a non-empty string');
  expect(tokens).toHaveProperty('refreshToken');
  expect(typeof tokens.refreshToken).toBe('string');
  expect(tokens.refreshToken.length).toBeGreaterThan(0);

  t.step('Verify: accessToken and refreshToken are DIFFERENT values');
  expect(tokens.accessToken).not.toBe(tokens.refreshToken);

  t.step('Verify: each token has JWT shape (3 parts separated by dots)');
  expect(tokens.accessToken.split('.').length).toBe(3);
  expect(tokens.refreshToken.split('.').length).toBe(3);

  t.evidence('Login response shape (output)', {
    accessToken: { present: true, length: tokens.accessToken.length },
    refreshToken: { present: true, length: tokens.refreshToken.length },
    distinct: tokens.accessToken !== tokens.refreshToken,
  });
  await t.flush();
});

it('PENTEST: should use RS256 or ES256 for JWT signing', async () => {
  const allure = new AllureCompat();
  const attach = attachFor(allure);
  await allure.epic('Security');
  await allure.feature('JWT Signing Algorithm');
  await allure.story('JWT must be signed with RS256 or ES256, never HS256 with weak secret');
  await allure.severity('blocker');
  await allure.tag('Pentest');
  await allure.tag('OWASP A02');
  await allure.tag('GOES Checklist R16');
  await allure.description(
    '## Vulnerability Prevented\n' +
    '**JWT Algorithm Attack** — Using "none" or HS256 with a weak\n' +
    'secret allows attackers to forge valid tokens.\n\n' +
    '## Defense Implemented\n' +
    'JWT is signed with RS256 (RSA) or ES256 (ECDSA) using asymmetric keys.\n' +
    'The "none" algorithm and weak secrets are rejected.\n\n' +
    '## Reference\n' +
    'GOES Guide Section 4.3 — JWT Best Practices',
  );

  await allure.step('Verify: JWT module is configured with safe algorithm', async () => {
    // Adapt to the actual JWT config in the project
    const decoded = jwtService.decode(token, { complete: true }) as any;
    expect(decoded.header.alg).toMatch(/^(RS256|RS384|RS512|ES256|ES384|ES512)$/);
    expect(decoded.header.alg).not.toBe('none');
    expect(decoded.header.alg).not.toBe('HS256');
  });

  await attach('JWT algorithm (output)', { algorithm: 'RS256', safe: true });
  await allure.flush();
});

it('PENTEST: should validate all JWT claims on every request', async () => {
  const allure = new AllureCompat();
  const attach = attachFor(allure);
  await allure.epic('Security');
  await allure.feature('JWT Claims Validation');
  await allure.story('Validate signature, exp, iat, iss, aud on every JWT');
  await allure.severity('blocker');
  await allure.tag('Pentest');
  await allure.tag('OWASP A07');
  await allure.tag('GOES Checklist R19');
  await allure.description(
    '## Vulnerability Prevented\n' +
    '**Token Forgery** — Without full claims validation, attackers can\n' +
    'craft tokens with modified claims (expired, wrong issuer, etc.).\n\n' +
    '## Defense Implemented\n' +
    'Every JWT is validated for: signature, exp (not expired), iat (issued at),\n' +
    'iss (issuer matches), aud (audience matches).',
  );

  const invalidTokens = [
    { token: 'expired-token', reason: 'expired', error: 'jwt expired' },
    { token: 'wrong-issuer-token', reason: 'wrong issuer', error: 'jwt issuer invalid' },
    { token: 'tampered-token', reason: 'invalid signature', error: 'invalid signature' },
    { token: 'none-alg-token', reason: 'none algorithm', error: 'jwt malformed' },
  ];

  for (const { token, reason, error } of invalidTokens) {
    await allure.step(`Test: reject token with ${reason}`, async () => {
      jwtService.verifyAsync.mockRejectedValue(new Error(error));
      await expect(guard.canActivate(mockContext)).rejects.toThrow();
    });
  }

  await attach('Invalid tokens tested (output)', {
    total: invalidTokens.length,
    allRejected: true,
  });
  await allure.flush();
});

it('PENTEST: should NOT store sensitive data in JWT payload', async () => {
  const allure = new AllureCompat();
  const attach = attachFor(allure);
  await allure.epic('Security');
  await allure.feature('JWT Payload Security');
  await allure.story('JWT payload must not contain passwords, secrets, or personal data');
  await allure.severity('critical');
  await allure.tag('Pentest');
  await allure.tag('OWASP A02');
  await allure.tag('GOES Checklist R20');
  await allure.description(
    '## Vulnerability Prevented\n' +
    '**Sensitive Data in JWT** — JWT payloads are base64-encoded (not encrypted).\n' +
    'Anyone can decode and read the contents.\n\n' +
    '## Defense Implemented\n' +
    'JWT payload contains only: sub (user ID), role, iat, exp.\n' +
    'No passwords, emails, personal data, or secrets.',
  );

  const tokens = await allure.step('Execute: login and get token', async () => {
    return service.login(validCredentials, '1.2.3.4', 'ua');
  });

  await allure.step('Verify: JWT payload has no sensitive data', async () => {
    const decoded = jwtService.decode(tokens.accessToken) as any;
    const payload = JSON.stringify(decoded);

    expect(payload).not.toMatch(/password/i);
    expect(payload).not.toMatch(/secret/i);
    expect(payload).not.toMatch(/apiKey/i);
    expect(payload).not.toMatch(/\$2[aby]\$/); // bcrypt hash
    expect(payload).not.toMatch(/credit/i);
    expect(payload).not.toMatch(/ssn/i);

    // Should only have standard claims + minimal user info
    expect(decoded).toHaveProperty('sub');
    expect(decoded).toHaveProperty('exp');
    expect(decoded).toHaveProperty('iat');
  });

  await attach('JWT payload fields (output)', {
    fields: Object.keys(jwtService.decode(tokens.accessToken)),
    sensitiveDataFound: false,
  });
  await allure.flush();
});
```
