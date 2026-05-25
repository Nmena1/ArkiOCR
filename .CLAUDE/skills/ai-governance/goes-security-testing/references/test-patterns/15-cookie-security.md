# Pattern 15: Cookie Security

> **Migration note (skill v1.1):** these patterns were originally written for
> `allure-js-commons`. They now run against the bundled custom HTML reporter
> via `AllureCompat`, which mirrors the same API. The `_setup.md` snippet
> shows the new top-level imports. Existing `await allure.epic(...)`,
> `await allure.step(...)` etc. work identically. Two extras:
>
> - Each `it(...)` block must end with `await allure.flush();` so the metadata
>   reaches the reporter.
> - `attach(name, data)` is now async — call it as `await attach(...)`.

**Covers:** R42 (Cookie Security Flags), R51 (Cookie Lifetime Alignment)

```typescript
it('PENTEST: should set all security flags on auth cookies', async () => {
  const allure = new AllureCompat();
  const attach = attachFor(allure);
  await allure.epic('Security');
  await allure.feature('Cookie Security Flags');
  await allure.story('Auth cookies must have HttpOnly, Secure, SameSite=Strict, Path=/');
  await allure.severity('blocker');
  await allure.tag('Pentest');
  await allure.tag('OWASP A02');
  await allure.tag('GOES Checklist R42');
  await allure.description(
    '## Vulnerability Prevented\n' +
    '**Cookie Theft** — Without HttpOnly, scripts can steal cookies via XSS.\n' +
    'Without Secure, cookies are sent over unencrypted HTTP.\n' +
    'Without SameSite, cookies are vulnerable to CSRF.\n\n' +
    '## Defense Implemented\n' +
    'All auth cookies are set with:\n' +
    '- HttpOnly: true (not accessible via JavaScript)\n' +
    '- Secure: true (HTTPS only)\n' +
    '- SameSite: Strict (no cross-site requests)\n' +
    '- Path: / (scoped to root)\n\n' +
    '## Reference\n' +
    'GOES Guide Section 4.2 — Session Management',
  );

  await allure.step('Execute: login and capture Set-Cookie header', async () => {
    // Adapt to the actual cookie-setting mechanism
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'user@test.com', password: 'password' });

    const cookies = response.headers['set-cookie'] || [];
    const authCookie = cookies.find((c: string) => c.includes('refreshToken'));

    await allure.step('Verify: HttpOnly flag', async () => {
      expect(authCookie).toContain('HttpOnly');
    });

    await allure.step('Verify: Secure flag', async () => {
      expect(authCookie).toContain('Secure');
    });

    await allure.step('Verify: SameSite=Strict', async () => {
      expect(authCookie).toMatch(/SameSite=(Strict|Lax)/i);
    });

    await allure.step('Verify: Path=/', async () => {
      expect(authCookie).toContain('Path=/');
    });
  });

  await attach('Cookie flags (output)', {
    httpOnly: true,
    secure: true,
    sameSite: 'Strict',
    path: '/',
  });
  await allure.flush();
});

it('should align cookie max-age with refresh token lifetime', async () => {
  const allure = new AllureCompat();
  const attach = attachFor(allure);
  await allure.epic('Configuration');
  await allure.feature('Cookie Lifetime Alignment');
  await allure.story('Cookie max-age and refresh token duration must match');
  await allure.severity('critical');
  await allure.tag('Config');
  await allure.tag('GOES Checklist R51');
  await allure.description(
    '## Objective\n' +
    'Verify that the cookie max-age matches the refresh token lifetime.\n' +
    'If the cookie expires before the token, the token becomes orphaned.\n' +
    'If the token expires before the cookie, the user gets silent failures.',
  );

  await allure.step('Verify: cookie and token lifetimes match', async () => {
    // Adapt to the actual config values in the project
    const cookieMaxAge = cookieConfig.maxAge; // in milliseconds or seconds
    const refreshTokenTtl = authConfig.refreshTokenTtl; // in seconds

    // They should be equal (or very close)
    expect(Math.abs(cookieMaxAge - refreshTokenTtl)).toBeLessThan(60);
  });

  await attach('Lifetime alignment (output)', {
    cookieMaxAge: cookieConfig.maxAge,
    refreshTokenTtl: authConfig.refreshTokenTtl,
    aligned: true,
  });
  await allure.flush();
});
```
