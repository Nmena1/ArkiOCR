# Pattern 03: Error Handling

> **Migration note (skill v1.1):** these patterns were originally written for
> `allure-js-commons`. They now run against the bundled custom HTML reporter
> via `AllureCompat`, which mirrors the same API. The `_setup.md` snippet
> shows the new top-level imports. Existing `await allure.epic(...)`,
> `await allure.step(...)` etc. work identically. Two extras:
>
> - Each `it(...)` block must end with `await allure.flush();` so the metadata
>   reaches the reporter.
> - `attach(name, data)` is now async — call it as `await attach(...)`.

**Covers:** R6 (Public Site Config), R8 (Generic Error Messages), R22 (Unknown Route Handling)

```typescript
it('should return generic error messages without exposing internals', async () => {
  const allure = new AllureCompat();
  const attach = attachFor(allure);
  await allure.epic('Security');
  await allure.feature('Generic Error Messages');
  await allure.story('Error responses must not expose stack traces, queries, or paths');
  await allure.severity('critical');
  await allure.tag('Config');
  await allure.tag('OWASP A05');
  await allure.tag('GOES Checklist R8');
  await allure.description(
    '## Objective\n' +
    'Verify that all error responses return generic messages.\n' +
    'Stack traces, SQL queries, file paths, and software versions\n' +
    'must never be exposed to the client.\n\n' +
    '## Reference\n' +
    'GOES Guide Section 9.1 — Secure Errors',
  );

  const errorScenarios = [
    { setup: () => prisma.user.findUnique.mockRejectedValue(new Error('ECONNREFUSED')), label: 'DB connection error' },
    { setup: () => prisma.user.findUnique.mockRejectedValue(new Error('relation "users" does not exist')), label: 'SQL error' },
    { setup: () => prisma.user.create.mockRejectedValue(new Error('Unique constraint failed')), label: 'Constraint error' },
  ];

  for (const scenario of errorScenarios) {
    await allure.step(`Test: ${scenario.label}`, async () => {
      scenario.setup();

      try {
        await service.findOne('1');
      } catch (error) {
        const message = error.message || error.response?.message;
        expect(message).not.toContain('ECONNREFUSED');
        expect(message).not.toContain('relation');
        expect(message).not.toContain('constraint');
        expect(message).not.toContain('/src/');
        expect(message).not.toContain('node_modules');
      }
    });
  }

  await attach('Error handling result (output)', {
    scenariosTested: errorScenarios.length,
    allGeneric: true,
  });
  await allure.flush();
});

it('should return 404 for undefined routes', async () => {
  const allure = new AllureCompat();
  const attach = attachFor(allure);
  await allure.epic('Configuration');
  await allure.feature('Unknown Route Handling');
  await allure.story('Return 404 for any route not defined in the application');
  await allure.severity('normal');
  await allure.tag('Config');
  await allure.tag('GOES Checklist R22');
  await allure.description(
    '## Objective\n' +
    'Verify that the application returns 404 for any undefined route,\n' +
    'not a default framework page or debug information.',
  );

  const undefinedRoutes = [
    '/api/nonexistent',
    '/admin/secret',
    '/.env',
    '/wp-admin',
    '/phpinfo.php',
  ];

  await allure.parameter('routes_tested', undefinedRoutes.length.toString());

  for (const route of undefinedRoutes) {
    await allure.step(`Test route: ${route}`, async () => {
      // Adapt to use supertest with the actual NestJS app
      const response = await request(app.getHttpServer()).get(route);
      expect(response.status).toBe(404);
      expect(response.body).not.toHaveProperty('stack');
    });
  }

  await attach('Routes tested (output)', { routes: undefinedRoutes, all404: true });
  await allure.flush();
});
```
