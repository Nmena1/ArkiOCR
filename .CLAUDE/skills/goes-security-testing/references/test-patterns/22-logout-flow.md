# Pattern 22: Logout / Session Termination

**Covers:** R32 (Token Rotation — implicit), R35 (Session Termination — implicit), best practice for any auth-protected backend.

> The GOES Checklist does not list "logout" as an explicit item, but a system that issues refresh tokens MUST provide a way to invalidate them. Without an explicit logout endpoint, a stolen refresh token remains valid until natural expiry (often days). This pattern enforces:
>
> - **Layer 2 (mandatory)** — `AuthController.logout` exists, is `@Post('logout')`, is `@UseGuards(JwtAuthGuard)`-protected.
> - **Layer 3 (mandatory)** — calling `service.logout(refreshToken)` revokes the token in the database; subsequent refresh attempts with the same token throw.

```typescript
import { AuthController } from '../../src/modules/auth/auth.controller';
import { report } from '@security-reporter/metadata';

// LAYER 2 — Logout endpoint exists, is protected, uses POST.
it('LOGOUT — AuthController.logout is defined, POST, and JWT-guarded', async () => {
  const t = report();
  t.epic('Autenticacion');
  t.feature('Session Termination');
  t.story('Endpoint POST /auth/logout esta declarado, requiere JWT, y revoca el refresh token');
  t.severity('blocker');
  t.tag('Auth', 'OWASP A07', 'GOES Checklist R32');

  // Verify the method exists on the controller.
  t.step('Verify: AuthController.logout method is defined');
  expect(typeof AuthController.prototype.logout).toBe('function');

  // Verify HTTP method via @Post metadata. NestJS stores it as 'method' (number)
  // and 'path' on the route handler.
  const methodMeta = Reflect.getMetadata('method', AuthController.prototype.logout);
  const pathMeta = Reflect.getMetadata('path', AuthController.prototype.logout);

  t.step('Verify: logout uses HTTP POST (RequestMethod.POST = 1)');
  expect(methodMeta).toBe(1); // RequestMethod.POST in NestJS

  t.step('Verify: logout is mounted on a logout-shaped path');
  expect(typeof pathMeta).toBe('string');
  expect(pathMeta).toMatch(/logout/i);

  // Verify @UseGuards is applied — logout MUST require authentication,
  // otherwise an attacker could revoke arbitrary refresh tokens.
  const guardsMeta =
    Reflect.getMetadata('__guards__', AuthController.prototype.logout) ||
    Reflect.getMetadata('__guards__', AuthController);

  t.step('Verify: logout is protected by an auth guard');
  expect(guardsMeta).toBeDefined();
  expect(Array.isArray(guardsMeta)).toBe(true);
  expect(guardsMeta.length).toBeGreaterThan(0);

  t.evidence('Logout endpoint metadata (output)', {
    method: 'POST',
    path: pathMeta,
    guards: guardsMeta?.map((g: any) => g?.name || String(g)),
  });
  await t.flush();
});

// LAYER 3 — Calling logout actually revokes the refresh token in DB.
it('LOGOUT — service.logout revokes the refresh token in the database', async () => {
  const t = report();
  t.epic('Autenticacion');
  t.feature('Session Termination');
  t.story('AuthService.logout marca el refresh token como revocado y persiste el cambio');
  t.severity('blocker');
  t.tag('Pentest', 'Auth', 'OWASP A07', 'GOES Checklist R32');

  const refreshToken = 'rt-abc-123';

  prisma.refreshToken.findUnique.mockResolvedValue({
    id: 'token-1',
    token: refreshToken,
    userId: 'user-1',
    isRevoked: false,
    familyId: 'family-1',
  });
  prisma.refreshToken.update.mockResolvedValue({
    id: 'token-1',
    isRevoked: true,
  });

  t.evidence('Logout request (input)', {
    refreshToken,
    expectedDbCall: { isRevoked: true },
  });

  t.step('Execute: user calls service.logout with their refresh token');
  await service.logout(refreshToken);

  t.step('Verify: prisma.refreshToken.update was called with isRevoked: true');
  expect(prisma.refreshToken.update).toHaveBeenCalled();
  const updateCall = prisma.refreshToken.update.mock.calls[0][0];
  expect(updateCall.data).toMatchObject({ isRevoked: true });

  t.evidence('Database mutation (output)', {
    methodCalled: 'prisma.refreshToken.update',
    args: updateCall,
  });
  await t.flush();
});

// LAYER 3 (defense-in-depth) — after logout, the same refresh token cannot
// be used to obtain a new access token. Pen-test simulation.
it('LOGOUT — refresh token is unusable after logout', async () => {
  const t = report();
  t.epic('Seguridad');
  t.feature('Session Termination');
  t.story('Despues de logout, intentar usar el mismo refresh token devuelve error');
  t.severity('blocker');
  t.tag('Pentest', 'OWASP A07', 'GOES Checklist R32');

  const refreshToken = 'rt-abc-123';

  // Simulate the DB state AFTER logout: token is marked revoked.
  prisma.refreshToken.findUnique.mockResolvedValue({
    id: 'token-1',
    token: refreshToken,
    userId: 'user-1',
    isRevoked: true,
    familyId: 'family-1',
  });

  t.evidence('Attacker scenario (input)', {
    refreshToken,
    state: 'previously logged out',
    attempt: 'service.refreshTokens(refreshToken)',
  });

  t.step('Execute: attacker tries to refresh with revoked token');
  await expect(
    service.refreshTokens(refreshToken, '1.2.3.4', 'ua'),
  ).rejects.toThrow();

  t.evidence('Defense response (output)', {
    rejected: true,
    reason: 'Refresh token is revoked',
  });
  await t.flush();
});
```

## Adapt to your project

- **Different controller name** — replace `AuthController` with `SessionController`, `IdentityController`, or whatever your project uses.
- **Different DB column** — if your schema uses `revokedAt: DateTime` instead of `isRevoked: boolean`, update the assertion: `expect(updateCall.data.revokedAt).toBeInstanceOf(Date)`.
- **Different ORM** — for TypeORM, replace `prisma.refreshToken.update` with `(refreshTokenRepository.update as jest.Mock)`.
- **Refresh token in cookie, not body** — if the project reads the refresh token from an `httpOnly` cookie, the test must set up the cookie via `request(app).post('/auth/logout').set('Cookie', ...)` for the E2E version.
- **No refresh token at all** — if the project uses only short-lived access tokens (no refresh), this whole pattern is **not applicable**. Mark with `t.notApplicable('Project does not issue refresh tokens; access-only tokens with 5-min lifetime')`.

## Anti-pattern — what NOT to do

```typescript
// ❌ DO NOT — only verifies the endpoint returns 200
it('logout returns success', async () => {
  const result = await service.logout('any-token');
  expect(result).toBeDefined();
  // ← never checks the DB was actually updated
  // ← a developer could implement service.logout() as `return { ok: true }`
  //   without revoking anything, and this test passes
});
```

The Layer 3 test above (`LOGOUT — service.logout revokes the refresh token in the database`) catches that case because it asserts `prisma.refreshToken.update` was called with `isRevoked: true`.
