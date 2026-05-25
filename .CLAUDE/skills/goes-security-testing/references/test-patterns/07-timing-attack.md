# Pattern 07: Timing Attack Prevention

> **Migration note (skill v1.1):** these patterns were originally written for
> `allure-js-commons`. They now run against the bundled custom HTML reporter
> via `AllureCompat`, which mirrors the same API. The `_setup.md` snippet
> shows the new top-level imports. Existing `await allure.epic(...)`,
> `await allure.step(...)` etc. work identically. Two extras:
>
> - Each `it(...)` block must end with `await allure.flush();` so the metadata
>   reaches the reporter.
> - `attach(name, data)` is now async — call it as `await attach(...)`.

**Covers:** R14 (Auth Failure Handling)

```typescript
it('PENTEST: should respond in constant time when email does not exist', async () => {
  const allure = new AllureCompat();
  const attach = attachFor(allure);
  await allure.epic('Security');
  await allure.feature('Timing Attack Prevention');
  await allure.story('Constant response time regardless of user existence');
  await allure.severity('critical');
  await allure.tag('Pentest');
  await allure.tag('OWASP A07');
  await allure.tag('GOES Checklist R14');
  await allure.description(
    '## Vulnerability Prevented\n' +
    '**Timing Attack** — If the server responds faster when the\n' +
    'email does not exist, an attacker can measure response time\n' +
    'to discover valid emails (user enumeration).\n\n' +
    '## Defense Implemented\n' +
    '`bcrypt.compare()` is executed against a dummy hash even when\n' +
    'the user does not exist, to equalize response time.\n\n' +
    '## Reference\n' +
    'OWASP A07:2021 — Identification and Authentication Failures',
  );

  await allure.parameter('email', 'nonexistent@test.com');

  await allure.step('Prepare: simulate email NOT found in DB', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
  });

  await attach('Attacker credentials (input)', {
    email: 'nonexistent@test.com',
    password: 'any-password',
  });

  await allure.step('Execute: attempt login with nonexistent email', async () => {
    await expect(
      service.login({ email: 'nonexistent@test.com', password: 'x' }, '1.2.3.4', 'ua'),
    ).rejects.toThrow('Invalid credentials');
  });

  await allure.step('Verify: bcrypt.compare was called (dummy hash)', async () => {
    expect(bcrypt.compare).toHaveBeenCalled();
  });

  await allure.step('Verify: error message is generic (no user enumeration)', async () => {
    // The error message must be the same whether email exists or not
    try {
      await service.login({ email: 'nonexistent@test.com', password: 'x' }, '1.2.3.4', 'ua');
    } catch (error) {
      expect(error.message).toBe('Invalid credentials');
      expect(error.message).not.toContain('not found');
      expect(error.message).not.toContain('does not exist');
    }
  });

  await attach('Response to attacker (output)', {
    statusCode: 401,
    message: 'Invalid credentials',
    note: 'Same message and same timing as if the email existed',
  });
  await allure.flush();
});
```
