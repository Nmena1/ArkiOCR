# Pattern 10: IDOR Prevention

> **Migration note (skill v1.1):** these patterns were originally written for
> `allure-js-commons`. They now run against the bundled custom HTML reporter
> via `AllureCompat`, which mirrors the same API. The `_setup.md` snippet
> shows the new top-level imports. Existing `await allure.epic(...)`,
> `await allure.step(...)` etc. work identically. Two extras:
>
> - Each `it(...)` block must end with `await allure.flush();` so the metadata
>   reaches the reporter.
> - `attach(name, data)` is now async — call it as `await attach(...)`.

**Covers:** R23 (IDOR Prevention)

> **MANDATORY 3-layer coverage** (per SKILL.md "cobertura de 3 capas").
> The Layer 3 test below sends `service.findOne(otherUserId, attackerId)` and expects rejection. That covers the runtime case. But it relies on the service method actually accepting a user-context argument. If a developer adds a new method like `findById(id)` without the user context, IDOR returns silently. Add the Layer 2 test to enforce that resource-access methods always receive a caller identity.

```typescript
it('PENTEST: should prevent access to another user resource (IDOR)', async () => {
  const allure = new AllureCompat();
  const attach = attachFor(allure);
  await allure.epic('Security');
  await allure.feature('IDOR Prevention');
  await allure.story('User cannot access resources belonging to another user by ID');
  await allure.severity('blocker');
  await allure.tag('Pentest');
  await allure.tag('OWASP A01');
  await allure.tag('OWASP API1');
  await allure.tag('GOES Checklist R23');
  await allure.description(
    '## Vulnerability Prevented\n' +
    '**IDOR (Insecure Direct Object Reference)** — An attacker modifies\n' +
    'the ID in the URL to access another user\'s resources.\n\n' +
    '## Defense Implemented\n' +
    'Verify that the requested resource belongs to the authenticated user\n' +
    'before returning it. Never trust URL IDs.',
  );

  await allure.parameter('resourceId', 'other-users-resource');
  await allure.parameter('attacker_userId', 'user-1');
  await allure.parameter('victim_userId', 'user-2');

  await allure.step('Prepare: resource belongs to user-2, attacker is user-1', async () => {
    prisma.resource.findUnique.mockResolvedValue({
      id: 'resource-1', userId: 'user-2',
    });
  });

  await attach('Attacker attempt (input)', {
    resourceId: 'resource-1', attackerUserId: 'user-1', ownerUserId: 'user-2',
  });

  await allure.step('Execute: attacker requests another user\'s resource', async () => {
    await expect(
      service.findOne('resource-1', 'user-1'),
    ).rejects.toThrow('Unauthorized');
  });

  await allure.step('Execute: attacker tries to update another user\'s resource', async () => {
    await expect(
      service.update('resource-1', { name: 'hacked' }, 'user-1'),
    ).rejects.toThrow('Unauthorized');
  });

  await allure.step('Execute: attacker tries to delete another user\'s resource', async () => {
    await expect(
      service.remove('resource-1', 'user-1'),
    ).rejects.toThrow('Unauthorized');
  });

  await attach('Defense executed (output)', {
    readBlocked: true,
    updateBlocked: true,
    deleteBlocked: true,
    reason: 'Resource does not belong to the authenticated user',
  });
  await allure.flush();
});

// LAYER 2 (mandatory) — resource-access service methods accept a caller
// identity argument. If a developer adds findById(id) without the
// userId/userContext, this test fails. The signature is the contract that
// makes IDOR enforcement possible.
it('R23 — Resource service methods require a caller identity argument', async () => {
  const t = report();
  t.epic('Seguridad');
  t.feature('IDOR Prevention');
  t.story('Los metodos del service que acceden a recursos por ID requieren userId del solicitante');
  t.severity('blocker');
  t.tag('Auth', 'OWASP A01', 'OWASP API1', 'GOES Checklist R23');

  // Adapt: list every method that accepts a resource ID (id param) and
  // therefore MUST also accept a caller identity to enforce ownership.
  const resourceMethods = [
    { name: 'findOne', minArity: 2 },   // (id, userId)
    { name: 'update',  minArity: 3 },   // (id, dto, userId)
    { name: 'remove',  minArity: 2 },   // (id, userId)
    // add every method that takes an ID from URL/params
  ];

  t.evidence('Service methods inspected (input)', resourceMethods.map((m) => ({
    method: m.name,
    declaredArity: service[m.name]?.length,
    minArity: m.minArity,
  })));

  for (const { name, minArity } of resourceMethods) {
    t.step(\`Verify: \${name} accepts at least \${minArity} arguments (id + caller identity)\`);
    expect(typeof service[name]).toBe('function');
    expect(service[name].length).toBeGreaterThanOrEqual(minArity);
  }

  t.evidence('Arity contract upheld (output)', {
    methodsChecked: resourceMethods.length,
    allHaveCallerArg: true,
  });

  await t.flush();
});
```
