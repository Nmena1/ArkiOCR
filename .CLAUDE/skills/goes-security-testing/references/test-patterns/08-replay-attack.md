# Pattern 08: Replay Attack Detection

> **Migration note (skill v1.1):** these patterns were originally written for
> `allure-js-commons`. They now run against the bundled custom HTML reporter
> via `AllureCompat`, which mirrors the same API. The `_setup.md` snippet
> shows the new top-level imports. Existing `await allure.epic(...)`,
> `await allure.step(...)` etc. work identically. Two extras:
>
> - Each `it(...)` block must end with `await allure.flush();` so the metadata
>   reaches the reporter.
> - `attach(name, data)` is now async — call it as `await attach(...)`.

**Covers:** R32 (Token Rotation)

```typescript
it('PENTEST: should detect REPLAY ATTACK and revoke entire token family', async () => {
  const allure = new AllureCompat();
  const attach = attachFor(allure);
  await allure.epic('Security');
  await allure.feature('Replay Attack Detection');
  await allure.story('Detect token reuse and revoke entire family');
  await allure.severity('blocker');
  await allure.tag('Pentest');
  await allure.tag('OWASP A07');
  await allure.tag('GOES Checklist R32');
  await allure.description(
    '## Vulnerability Prevented\n' +
    '**Replay Attack** — An attacker intercepts a refresh token and\n' +
    'reuses it after the legitimate user already consumed it.\n\n' +
    '## Defense Implemented\n' +
    'If a revoked token is presented again:\n' +
    '1. It is detected as a REPLAY ATTACK\n' +
    '2. ALL tokens in that family are revoked\n' +
    '3. An audit event is logged',
  );

  await allure.parameter('reused_token', 'reused-token');
  await allure.parameter('familyId', 'family-1');

  await allure.step('Prepare: token already revoked in DB', async () => {
    prisma.refreshToken.findUnique.mockResolvedValue({
      id: 'token-1', token: 'reused-token', isRevoked: true, familyId: 'family-1',
    });
    prisma.refreshToken.updateMany.mockResolvedValue({ count: 3 });
  });

  await attach('Reused token by attacker (input)', {
    token: 'reused-token', isRevoked: true, familyId: 'family-1',
  });

  await allure.step('Execute: attacker reuses revoked token', async () => {
    await expect(
      service.refreshTokens('reused-token', '1.2.3.4', 'ua'),
    ).rejects.toThrow('Session expired');
  });

  await allure.step('Verify: entire family revoked', async () => {
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { familyId: 'family-1' },
      data: { isRevoked: true },
    });
  });

  await attach('Defense actions executed (output)', {
    replayDetected: true, familyRevoked: 'family-1', tokensAffected: 3,
  });
  await allure.flush();
});

it('should rotate refresh token after every use', async () => {
  const allure = new AllureCompat();
  const attach = attachFor(allure);
  await allure.epic('Security');
  await allure.feature('Token Rotation');
  await allure.story('Issue new refresh token and revoke old one on each refresh');
  await allure.severity('blocker');
  await allure.tag('Auth');
  await allure.tag('OWASP A07');
  await allure.tag('GOES Checklist R32');
  await allure.description(
    '## Objective\n' +
    'Verify that each time a refresh token is used, a new one is issued\n' +
    'and the old one is immediately revoked.',
  );

  await allure.step('Prepare: valid refresh token in DB', async () => {
    prisma.refreshToken.findUnique.mockResolvedValue({
      id: 'token-1', token: 'current-token', isRevoked: false, familyId: 'family-1',
    });
  });

  const result = await allure.step('Execute: refresh tokens', async () => {
    return service.refreshTokens('current-token', '1.2.3.4', 'ua');
  });

  await allure.step('Verify: old token was revoked', async () => {
    expect(prisma.refreshToken.update).toHaveBeenCalledWith({
      where: { id: 'token-1' },
      data: { isRevoked: true },
    });
  });

  await allure.step('Verify: new tokens were issued', async () => {
    expect(result).toHaveProperty('accessToken');
    expect(result).toHaveProperty('refreshToken');
    expect(result.refreshToken).not.toBe('current-token');
  });

  await attach('Token rotation result (output)', {
    oldTokenRevoked: true,
    newTokenIssued: true,
  });
  await allure.flush();
});
```
