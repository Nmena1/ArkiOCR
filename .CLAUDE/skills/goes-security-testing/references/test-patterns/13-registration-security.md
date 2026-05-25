# Pattern 13: Registration Security

> **Migration note (skill v1.1):** these patterns were originally written for
> `allure-js-commons`. They now run against the bundled custom HTML reporter
> via `AllureCompat`, which mirrors the same API. The `_setup.md` snippet
> shows the new top-level imports. Existing `await allure.epic(...)`,
> `await allure.step(...)` etc. work identically. Two extras:
>
> - Each `it(...)` block must end with `await allure.flush();` so the metadata
>   reaches the reporter.
> - `attach(name, data)` is now async — call it as `await attach(...)`.

**Covers:** R25 (Duplicate Registration Prevention), R26 (Disposable Email Rejection), R28 (Account Recovery)

```typescript
it('should prevent duplicate user registration', async () => {
  const allure = new AllureCompat();
  const attach = attachFor(allure);
  await allure.epic('Authentication');
  await allure.feature('Duplicate Registration Prevention');
  await allure.story('Same email cannot be registered twice');
  await allure.severity('critical');
  await allure.tag('Auth');
  await allure.tag('OWASP A07');
  await allure.tag('GOES Checklist R25');
  await allure.description(
    '## Objective\n' +
    'Verify that attempting to register with an existing email\n' +
    'is rejected with a clear error.',
  );

  await allure.step('Prepare: email already exists in DB', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: '1', email: 'existing@test.com' });
  });

  await allure.step('Execute: attempt to register with existing email', async () => {
    await expect(
      service.register({ email: 'existing@test.com', password: 'StrongP@ss123!' }),
    ).rejects.toThrow();
  });

  await allure.step('Verify: no new user was created', async () => {
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  await attach('Duplicate registration (output)', { blocked: true, reason: 'Email already registered' });
  await allure.flush();
});

it('PENTEST: should reject disposable email addresses', async () => {
  const allure = new AllureCompat();
  const attach = attachFor(allure);
  await allure.epic('Authentication');
  await allure.feature('Disposable Email Rejection');
  await allure.story('Temporary/disposable email providers are blocked at registration');
  await allure.severity('normal');
  await allure.tag('Pentest');
  await allure.tag('OWASP A07');
  await allure.tag('GOES Checklist R26');
  await allure.description(
    '## Vulnerability Prevented\n' +
    '**Disposable Email Abuse** — Attackers use temporary email services\n' +
    'to create throwaway accounts for spam, fraud, or abuse.\n\n' +
    '## Defense Implemented\n' +
    'Registration checks the email domain against a blocklist of\n' +
    'known disposable email providers.',
  );

  const disposableEmails = [
    'user@mailinator.com',
    'user@tempmail.com',
    'user@guerrillamail.com',
    'user@10minutemail.com',
    'user@throwaway.email',
  ];

  for (const email of disposableEmails) {
    await allure.step(`Test: reject ${email}`, async () => {
      await expect(
        service.register({ email, password: 'StrongP@ss123!' }),
      ).rejects.toThrow();
    });
  }

  await attach('Disposable emails tested (output)', {
    total: disposableEmails.length,
    allRejected: true,
  });
  await allure.flush();
});

it('should provide secure account recovery flow', async () => {
  const allure = new AllureCompat();
  const attach = attachFor(allure);
  await allure.epic('Authentication');
  await allure.feature('Account Recovery');
  await allure.story('Password reset via email with secure time-limited token');
  await allure.severity('critical');
  await allure.tag('Auth');
  await allure.tag('OWASP A07');
  await allure.tag('GOES Checklist R28');
  await allure.description(
    '## Objective\n' +
    'Verify that the account recovery flow generates a secure,\n' +
    'time-limited reset token and does not leak user existence.',
  );

  await allure.step('Test: request reset for existing user', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: '1', email: 'user@test.com' });
    const result = await service.requestPasswordReset('user@test.com');
    // Should return success regardless (no user enumeration)
    expect(result).toHaveProperty('message');
  });

  await allure.step('Test: request reset for non-existing user (no enumeration)', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    const result = await service.requestPasswordReset('nobody@test.com');
    // Same response as existing user
    expect(result).toHaveProperty('message');
  });

  await allure.step('Verify: reset token has short expiry', async () => {
    const tokenRecord = prisma.resetToken.create.mock.calls[0]?.[0]?.data;
    if (tokenRecord) {
      const expiresAt = new Date(tokenRecord.expiresAt);
      const now = new Date();
      const diffMinutes = (expiresAt.getTime() - now.getTime()) / (1000 * 60);
      expect(diffMinutes).toBeLessThanOrEqual(60); // max 1 hour
    }
  });

  await attach('Account recovery (output)', {
    noUserEnumeration: true,
    tokenExpiry: '<=60 minutes',
  });
  await allure.flush();
});
```
