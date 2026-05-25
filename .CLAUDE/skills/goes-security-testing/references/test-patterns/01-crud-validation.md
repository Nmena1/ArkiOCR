# Pattern 01: CRUD + DTO Validation

> **Migration note (skill v1.1):** these patterns were originally written for
> `allure-js-commons`. They now run against the bundled custom HTML reporter
> via `AllureCompat`, which mirrors the same API. The `_setup.md` snippet
> shows the new top-level imports. Existing `await allure.epic(...)`,
> `await allure.step(...)` etc. work identically. Two extras:
>
> - Each `it(...)` block must end with `await allure.flush();` so the metadata
>   reaches the reporter.
> - `attach(name, data)` is now async — call it as `await attach(...)`.

**Covers:** R11 (DTO Validation / Input Constraints)

```typescript
it('should create a record successfully with valid data', async () => {
  const allure = new AllureCompat();
  const attach = attachFor(allure);
  await allure.epic('Domain');
  await allure.feature('Record Management');
  await allure.story('Create new record with valid DTO');
  await allure.severity('blocker');
  await allure.tag('CRUD');
  await allure.tag('Happy Path');
  await allure.tag('GOES Checklist R11');
  await allure.description(
    '## Objective\n' +
    'Verify that the service creates a record correctly when receiving valid data.\n\n' +
    '## Expected behavior\n' +
    '- Returns the created object with a generated ID\n' +
    '- Fields match the submitted DTO',
  );

  const dto = { name: 'Example', description: 'Test' };
  await allure.parameter('name', dto.name);

  await allure.step('Prepare: configure DB mock for insert', async () => {
    prisma.record.create.mockResolvedValue({ id: 1, ...dto });
  });

  await attach('DTO sent (input)', dto);

  const result = await allure.step('Execute: service.create(dto)', async () => {
    return service.create(dto);
  });

  await allure.step('Verify: returns object with ID', async () => {
    expect(result).toHaveProperty('id');
    expect(result.name).toBe(dto.name);
  });

  await attach('Created record (output)', result);
  await allure.flush();
});

it('should reject invalid DTO with missing required fields', async () => {
  const allure = new AllureCompat();
  const attach = attachFor(allure);
  await allure.epic('Domain');
  await allure.feature('Input Validation');
  await allure.story('Reject DTO missing required fields');
  await allure.severity('critical');
  await allure.tag('Validation');
  await allure.tag('GOES Checklist R11');
  await allure.description(
    '## Objective\n' +
    'Verify that the service rejects DTOs that are missing required fields,\n' +
    'have wrong data types, or exceed field length limits.\n\n' +
    '## Reference\n' +
    'GOES Guide Section 3 — Input Validation',
  );

  const invalidDtos = [
    { dto: {}, reason: 'empty object' },
    { dto: { name: '' }, reason: 'empty name' },
    { dto: { name: 'a'.repeat(256) }, reason: 'name exceeds max length' },
    { dto: { name: 123 }, reason: 'wrong data type' },
  ];

  for (const { dto, reason } of invalidDtos) {
    await allure.step(`Execute: attempt create with ${reason}`, async () => {
      await expect(service.create(dto as any)).rejects.toThrow();
    });
  }

  await attach('Invalid DTOs tested (output)', { total: invalidDtos.length, allRejected: true });
  await allure.flush();
});
```
