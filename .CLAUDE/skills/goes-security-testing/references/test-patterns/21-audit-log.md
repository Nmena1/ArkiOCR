# Pattern 21: Audit Log

> **Migration note (skill v1.1):** these patterns were originally written for
> `allure-js-commons`. They now run against the bundled custom HTML reporter
> via `AllureCompat`, which mirrors the same API. The `_setup.md` snippet
> shows the new top-level imports. Existing `await allure.epic(...)`,
> `await allure.step(...)` etc. work identically. Two extras:
>
> - Each `it(...)` block must end with `await allure.flush();` so the metadata
>   reaches the reporter.
> - `attach(name, data)` is now async — call it as `await attach(...)`.

**Covers:** R10 (Log Exposure Prevention — audit logging side)

```typescript
it('should create an audit log entry when creating a resource', async () => {
  const allure = new AllureCompat();
  const attach = attachFor(allure);
  await allure.epic('Audit');
  await allure.feature('Audit Log');
  await allure.story('Log CREATE event in audit log');
  await allure.severity('normal');
  await allure.tag('Audit');
  await allure.tag('OWASP A09');
  await allure.tag('GOES Checklist R10');
  await allure.description(
    '## Objective\n' +
    'Verify that every write operation generates an audit log\n' +
    'entry with user, action, resource, and timestamp.\n\n' +
    '## Reference\n' +
    'GOES Guide Section 9.2 — What to Log',
  );

  await allure.parameter('action', 'CREATE');
  await allure.parameter('resource', 'System');

  await allure.step('Execute: service.create(dto)', async () => {
    await service.create(dto);
  });

  await allure.step('Verify: audit log was created', async () => {
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'CREATE',
        resource: 'System',
        userId: expect.any(String),
      }),
    });
  });

  await attach('Audit event (output)', {
    action: 'CREATE', resource: 'System', userId: 'user-123',
  });
  await allure.flush();
});

it('should log failed login attempts with IP and timestamp', async () => {
  const allure = new AllureCompat();
  const attach = attachFor(allure);
  await allure.epic('Audit');
  await allure.feature('Audit Log');
  await allure.story('Log failed login attempts for security monitoring');
  await allure.severity('critical');
  await allure.tag('Audit');
  await allure.tag('OWASP A09');
  await allure.tag('GOES Checklist R10');
  await allure.description(
    '## Objective\n' +
    'Verify that failed login attempts are logged with:\n' +
    '- Email attempted\n' +
    '- IP address\n' +
    '- Timestamp\n' +
    '- Failure reason\n\n' +
    '## Reference\n' +
    'GOES Guide Section 9.2 — What to Log',
  );

  await allure.step('Execute: failed login attempt', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    try {
      await service.login({ email: 'attacker@test.com', password: 'wrong' }, '192.168.1.100', 'ua');
    } catch {}
  });

  await allure.step('Verify: failed attempt was logged', async () => {
    expect(prisma.loginAttempt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        email: 'attacker@test.com',
        ip: '192.168.1.100',
        success: false,
      }),
    });
  });

  await attach('Audit log entry (output)', {
    email: 'attacker@test.com',
    ip: '192.168.1.100',
    success: false,
    logged: true,
  });
  await allure.flush();
});

it('should NOT log sensitive data (passwords, tokens, secrets)', async () => {
  const allure = new AllureCompat();
  const attach = attachFor(allure);
  await allure.epic('Audit');
  await allure.feature('Audit Log');
  await allure.story('Audit logs must never contain passwords, tokens, or secrets');
  await allure.severity('critical');
  await allure.tag('Audit');
  await allure.tag('OWASP A09');
  await allure.tag('GOES Checklist R10');
  await allure.description(
    '## Objective\n' +
    'Verify that audit logs never contain:\n' +
    '- Passwords (plain text or hashed)\n' +
    '- Session tokens or JWTs\n' +
    '- API keys or secrets\n' +
    '- Full credit card numbers\n\n' +
    '## Reference\n' +
    'GOES Guide Section 9.3 — What NOT to Log',
  );

  await allure.step('Execute: trigger login and capture audit log data', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: '1', email: 'user@test.com', password: '$2b$12$hash',
    });

    await service.login({ email: 'user@test.com', password: 'MySecret123!' }, '1.2.3.4', 'ua');
  });

  await allure.step('Verify: no sensitive data in log entries', async () => {
    const allCalls = [
      ...prisma.auditLog.create.mock.calls,
      ...prisma.loginAttempt.create.mock.calls,
    ];

    for (const call of allCalls) {
      const logData = JSON.stringify(call);
      expect(logData).not.toContain('MySecret123!');
      expect(logData).not.toContain('$2b$12$');
      expect(logData).not.toMatch(/Bearer\s+ey/);
      expect(logData).not.toMatch(/sk-[a-zA-Z0-9]/);
    }
  });

  await attach('Sensitive data check (output)', {
    passwordLogged: false,
    tokenLogged: false,
    secretLogged: false,
  });
  await allure.flush();
});
```
