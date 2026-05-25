# Pattern 06: Brute Force Protection

> **Migration note (skill v1.1):** these patterns were originally written for
> `allure-js-commons`. They now run against the bundled custom HTML reporter
> via `AllureCompat`, which mirrors the same API. The `_setup.md` snippet
> shows the new top-level imports. Existing `await allure.epic(...)`,
> `await allure.step(...)` etc. work identically. Two extras:
>
> - Each `it(...)` block must end with `await allure.flush();` so the metadata
>   reaches the reporter.
> - `attach(name, data)` is now async — call it as `await attach(...)`.

**Covers:** R27 (Brute Force Protection)

```typescript
it('PENTEST: should lock account after 5 failed login attempts', async () => {
  const allure = new AllureCompat();
  const attach = attachFor(allure);
  await allure.epic('Security');
  await allure.feature('Brute Force Protection');
  await allure.story('Temporary lockout after consecutive failed attempts');
  await allure.severity('blocker');
  await allure.tag('Pentest');
  await allure.tag('OWASP A07');
  await allure.tag('GOES Checklist R27');
  await allure.description(
    '## Vulnerability Prevented\n' +
    '**Brute Force** — An attacker tries thousands of passwords\n' +
    'until finding the correct one.\n\n' +
    '## Defense Implemented\n' +
    'After 5 consecutive failed attempts from the same IP,\n' +
    'the account is temporarily locked (15 minutes).',
  );

  await allure.parameter('max_attempts', '5');
  await allure.parameter('lockout_minutes', '15');

  await allure.step('Prepare: simulate 5 previous failed attempts', async () => {
    prisma.loginAttempt.count.mockResolvedValue(5);
  });

  await attach('Attacker state (input)', {
    email: 'victim@test.com', failedAttempts: 5, ip: '192.168.1.100',
  });

  await allure.step('Execute: attempt #6 login', async () => {
    await expect(
      service.login(dto, '192.168.1.100', 'ua'),
    ).rejects.toThrow('Account temporarily locked');
  });

  await allure.step('Verify: lockout was recorded', async () => {
    expect(prisma.accountLock.create).toHaveBeenCalled();
  });

  await attach('Defense response (output)', {
    locked: true, reason: 'Too many failed attempts', unlockIn: '15 minutes',
  });
  await allure.flush();
});

it('should reset failed attempt counter after successful login', async () => {
  const allure = new AllureCompat();
  const attach = attachFor(allure);
  await allure.epic('Security');
  await allure.feature('Brute Force Protection');
  await allure.story('Reset attempt counter on successful login');
  await allure.severity('normal');
  await allure.tag('Auth');
  await allure.tag('GOES Checklist R27');
  await allure.description(
    '## Objective\n' +
    'After a successful login, the failed attempt counter should reset\n' +
    'so the user is not locked out on future attempts.',
  );

  await allure.step('Prepare: user has 3 failed attempts', async () => {
    prisma.loginAttempt.count.mockResolvedValue(3);
    prisma.user.findUnique.mockResolvedValue({
      id: '1', email: 'user@test.com', password: await bcrypt.hash('correct', 12),
    });
  });

  await allure.step('Execute: successful login', async () => {
    await service.login({ email: 'user@test.com', password: 'correct' }, '1.2.3.4', 'ua');
  });

  await allure.step('Verify: failed attempts cleared', async () => {
    expect(prisma.loginAttempt.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: 'user@test.com' } }),
    );
  });

  await attach('Result (output)', { attemptsReset: true });
  await allure.flush();
});
```
