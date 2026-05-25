# Pattern 05: Password Security

> **Migration note (skill v1.1):** these patterns were originally written for
> `allure-js-commons`. They now run against the bundled custom HTML reporter
> via `AllureCompat`, which mirrors the same API. The `_setup.md` snippet
> shows the new top-level imports. Existing `await allure.epic(...)`,
> `await allure.step(...)` etc. work identically. Two extras:
>
> - Each `it(...)` block must end with `await allure.flush();` so the metadata
>   reaches the reporter.
> - `attach(name, data)` is now async — call it as `await attach(...)`.

**Covers:** R15 (Password Hashing), R29 (Remember Me Security), R30 (Server-side Password Storage), R31 (Weak Password Prevention)

```typescript
it('PENTEST: should hash passwords with bcrypt, Argon2, or PBKDF2', async () => {
  const allure = new AllureCompat();
  const attach = attachFor(allure);
  await allure.epic('Security');
  await allure.feature('Password Hashing Strength');
  await allure.story('Passwords must be hashed with a secure algorithm before storage');
  await allure.severity('blocker');
  await allure.tag('Pentest');
  await allure.tag('OWASP A02');
  await allure.tag('GOES Checklist R15');
  await allure.description(
    '## Vulnerability Prevented\n' +
    '**Weak Hashing** — Using MD5, SHA1, or SHA256 alone allows attackers\n' +
    'to crack passwords with rainbow tables or brute force.\n\n' +
    '## Defense Implemented\n' +
    'Passwords are hashed with bcrypt (cost 12+), Argon2id, or PBKDF2.\n' +
    'Never stored in plain text.\n\n' +
    '## Reference\n' +
    'GOES Guide Section 5 — Cryptography',
  );

  await allure.step('Execute: register a new user', async () => {
    prisma.user.create.mockImplementation(({ data }) => {
      // Capture the password that would be stored
      storedPassword = data.password;
      return Promise.resolve({ id: '1', ...data });
    });

    await service.register({ email: 'new@test.com', password: 'SecureP@ss123!' });
  });

  await allure.step('Verify: password is hashed, not plain text', async () => {
    expect(storedPassword).not.toBe('SecureP@ss123!');
    // bcrypt hashes start with $2b$ or $2a$
    expect(storedPassword).toMatch(/^\$2[aby]\$\d{2}\$/);
  });

  await allure.step('Verify: hash cost factor is adequate (>= 10)', async () => {
    const costFactor = parseInt(storedPassword.split('$')[3], 10);
    expect(costFactor).toBeGreaterThanOrEqual(10);
  });

  await attach('Password storage (output)', {
    plainText: false,
    algorithm: 'bcrypt',
    costFactor: '>=10',
  });
  await allure.flush();
});

it('PENTEST: should reject weak passwords', async () => {
  const allure = new AllureCompat();
  const attach = attachFor(allure);
  await allure.epic('Security');
  await allure.feature('Weak Password Prevention');
  await allure.story('Reject passwords that are too short, common, or match the username');
  await allure.severity('critical');
  await allure.tag('Pentest');
  await allure.tag('OWASP A07');
  await allure.tag('GOES Checklist R31');
  await allure.description(
    '## Vulnerability Prevented\n' +
    '**Weak Passwords** — Users choose easily guessable passwords\n' +
    'like "123456", their username, or common dictionary words.\n\n' +
    '## Defense Implemented\n' +
    'Password policy: minimum 12 characters, must not match username,\n' +
    'reject common passwords.\n\n' +
    '## Reference\n' +
    'GOES Guide Section 4.1 — Password Policies',
  );

  const weakPasswords = [
    { password: '123', reason: 'too short' },
    { password: '12345678', reason: 'below minimum length' },
    { password: 'password', reason: 'common password' },
    { password: 'user@test.com', reason: 'same as username/email' },
    { password: 'qwerty123456', reason: 'keyboard pattern' },
  ];

  for (const { password, reason } of weakPasswords) {
    await allure.step(`Test: reject "${reason}" password`, async () => {
      await expect(
        service.register({ email: 'user@test.com', password }),
      ).rejects.toThrow();
    });
  }

  await attach('Weak passwords tested (output)', {
    total: weakPasswords.length,
    allRejected: true,
  });
  await allure.flush();
});

it('should store passwords only on the server side', async () => {
  const allure = new AllureCompat();
  const attach = attachFor(allure);
  await allure.epic('Security');
  await allure.feature('Server-side Password Storage');
  await allure.story('Passwords are never returned in API responses');
  await allure.severity('blocker');
  await allure.tag('Auth');
  await allure.tag('OWASP A02');
  await allure.tag('GOES Checklist R30');
  await allure.description(
    '## Objective\n' +
    'Verify that password hashes are never included in any API response,\n' +
    'user profile, or list endpoint.',
  );

  await allure.step('Execute: fetch user profile', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: '1', email: 'user@test.com', password: '$2b$12$hash', role: 'USER',
    });
    const result = await service.findOne('1');
    expect(result).not.toHaveProperty('password');
  });

  await allure.step('Execute: fetch user list', async () => {
    prisma.user.findMany.mockResolvedValue([
      { id: '1', email: 'a@test.com', password: '$2b$12$hash1' },
      { id: '2', email: 'b@test.com', password: '$2b$12$hash2' },
    ]);
    const result = await service.findAll({ page: 1, limit: 10 });
    for (const user of result.data) {
      expect(user).not.toHaveProperty('password');
    }
  });

  await attach('Result (output)', { passwordExposedInProfile: false, passwordExposedInList: false });
  await allure.flush();
});
```
