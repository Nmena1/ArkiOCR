# Pattern 09: RBAC / Privilege Escalation Prevention

> **Migration note (skill v1.1):** these patterns were originally written for
> `allure-js-commons`. They now run against the bundled custom HTML reporter
> via `AllureCompat`, which mirrors the same API. The `_setup.md` snippet
> shows the new top-level imports. Existing `await allure.epic(...)`,
> `await allure.step(...)` etc. work identically. Two extras:
>
> - Each `it(...)` block must end with `await allure.flush();` so the metadata
>   reaches the reporter.
> - `attach(name, data)` is now async — call it as `await attach(...)`.

**Covers:** R9 (RBAC Enforcement), R24 (Privilege Escalation Prevention), R34 (Role-Based Access Control)

> **MANDATORY 3-layer coverage** (per SKILL.md "cobertura de 3 capas").
> Testing `guard.canActivate()` directly (Layer 3) is necessary but not sufficient. If a developer removes `@UseGuards(RolesGuard)` or `@Roles('admin')` from a controller method, the guard simply never runs — and the Layer 3 test stays green because it invokes the guard manually.
>
> Add the Layer 2 test below: it inspects each protected controller method via `Reflect.getMetadata` and fails if `@UseGuards` or `@Roles` is missing.

```typescript
it('PENTEST: should enforce role-based access on every endpoint', async () => {
  const allure = new AllureCompat();
  const attach = attachFor(allure);
  await allure.epic('Authentication');
  await allure.feature('RBAC Enforcement');
  await allure.story('Server validates role/permission on every request');
  await allure.severity('blocker');
  await allure.tag('Pentest');
  await allure.tag('OWASP A01');
  await allure.tag('OWASP API5');
  await allure.tag('GOES Checklist R9');
  await allure.tag('GOES Checklist R34');
  await allure.description(
    '## Vulnerability Prevented\n' +
    '**Missing RBAC** — Endpoints that do not check the user\'s role\n' +
    'allow any authenticated user to perform any action.\n\n' +
    '## Defense Implemented\n' +
    'Every endpoint is protected by a RolesGuard that checks the user\'s\n' +
    'role against the required role defined in route metadata.',
  );

  const testCases = [
    { role: 'USER', endpoint: 'admin/users', action: 'listAllUsers', shouldAllow: false },
    { role: 'USER', endpoint: 'admin/roles', action: 'manageRoles', shouldAllow: false },
    { role: 'ADMIN', endpoint: 'admin/users', action: 'listAllUsers', shouldAllow: true },
    { role: 'MODERATOR', endpoint: 'admin/settings', action: 'changeSettings', shouldAllow: false },
  ];

  for (const { role, endpoint, action, shouldAllow } of testCases) {
    await allure.step(`Test: ${role} accessing ${endpoint}`, async () => {
      const mockUser = { id: '1', role };

      if (shouldAllow) {
        await expect(guard.canActivate(createMockContext(mockUser, endpoint))).resolves.toBe(true);
      } else {
        await expect(guard.canActivate(createMockContext(mockUser, endpoint))).rejects.toThrow();
      }
    });
  }

  await attach('RBAC test results (output)', {
    scenarios: testCases.length,
    allCorrect: true,
  });
  await allure.flush();
});

it('PENTEST: should prevent privilege escalation via role manipulation', async () => {
  const allure = new AllureCompat();
  const attach = attachFor(allure);
  await allure.epic('Authentication');
  await allure.feature('Privilege Escalation Prevention');
  await allure.story('Low-privilege user cannot elevate their own role');
  await allure.severity('blocker');
  await allure.tag('Pentest');
  await allure.tag('OWASP A01');
  await allure.tag('GOES Checklist R24');
  await allure.description(
    '## Vulnerability Prevented\n' +
    '**Privilege Escalation** — A regular user sends a request to\n' +
    'change their own role to ADMIN, or accesses admin-only actions.\n\n' +
    '## Defense Implemented\n' +
    'Role changes are restricted to ADMIN users only.\n' +
    'The role field is ignored in self-update requests.',
  );

  await allure.parameter('attacker_role', 'USER');
  await allure.parameter('attempted_role', 'ADMIN');

  await allure.step('Prepare: regular user tries to update their own role', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: '1', role: 'USER' });
  });

  await allure.step('Execute: user sends update with role=ADMIN', async () => {
    await expect(
      service.update('1', { role: 'ADMIN' }, { userId: '1', role: 'USER' }),
    ).rejects.toThrow();
  });

  await allure.step('Verify: role was NOT changed', async () => {
    // If the service allows partial updates, verify role field was stripped
    if (prisma.user.update.mock.calls.length > 0) {
      const updateData = prisma.user.update.mock.calls[0][0].data;
      expect(updateData).not.toHaveProperty('role');
    }
  });

  await attach('Privilege escalation attempt (output)', {
    escalationBlocked: true,
    reason: 'Only ADMIN can change roles',
  });
  await allure.flush();
});

// LAYER 2 (mandatory) — @UseGuards(RolesGuard) and @Roles(...) are
// applied to every admin/protected method. If a developer removes
// @Roles from changeRole, this test fails immediately.
it('R9/R34 — @UseGuards + @Roles are applied on every admin endpoint', async () => {
  const t = report();
  t.epic('Autenticacion');
  t.feature('RBAC Enforcement');
  t.story('Cada endpoint administrativo tiene @UseGuards(RolesGuard) y @Roles');
  t.severity('blocker');
  t.tag('Auth', 'OWASP A01', 'OWASP API5', 'GOES Checklist R9', 'GOES Checklist R34');

  // Adapt to your project: import controller(s) and list their protected methods.
  // import { AdminController } from '../../src/admin/admin.controller';
  // import { UsersController } from '../../src/users/users.controller';

  const protectedMethods = [
    { ctrl: AdminController, method: 'listAllUsers', requiredRoles: ['ADMIN'] },
    { ctrl: AdminController, method: 'deleteUser', requiredRoles: ['ADMIN'] },
    { ctrl: AdminController, method: 'changeRole', requiredRoles: ['ADMIN'] },
    { ctrl: UsersController, method: 'updateRole', requiredRoles: ['ADMIN'] },
    // add every method that should be RBAC-protected
  ];

  t.evidence('Endpoints inspected (input)', protectedMethods.map((p) => ({
    controller: p.ctrl.name,
    method: p.method,
    requiredRoles: p.requiredRoles,
  })));

  for (const { ctrl, method, requiredRoles } of protectedMethods) {
    const target = ctrl.prototype[method];

    // @Roles decorator metadata key (NestJS): 'roles'
    const rolesMeta = Reflect.getMetadata('roles', target);

    // @UseGuards metadata key: '__guards__' (method-level) or class-level
    const guardsMeta =
      Reflect.getMetadata('__guards__', target) ||
      Reflect.getMetadata('__guards__', ctrl);

    t.step(\`Verify: \${ctrl.name}.\${method} has @Roles\`);
    expect(rolesMeta).toBeDefined();
    expect(rolesMeta).toEqual(expect.arrayContaining(requiredRoles));

    t.step(\`Verify: \${ctrl.name}.\${method} has @UseGuards (RolesGuard or JwtAuthGuard chain)\`);
    expect(guardsMeta).toBeDefined();
    expect(Array.isArray(guardsMeta)).toBe(true);
    expect(guardsMeta.length).toBeGreaterThan(0);
  }

  t.evidence('All protected endpoints verified (output)', {
    methodsChecked: protectedMethods.length,
    allGuarded: true,
  });

  await t.flush();
});
```
