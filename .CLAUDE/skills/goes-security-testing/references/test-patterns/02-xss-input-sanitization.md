# Pattern 02: XSS / Input Sanitization / Sensitive Data Exposure

> **Migration note (skill v1.1):** these patterns were originally written for
> `allure-js-commons`. They now run against the bundled custom HTML reporter
> via `AllureCompat`, which mirrors the same API. The `_setup.md` snippet
> shows the new top-level imports. Existing `await allure.epic(...)`,
> `await allure.step(...)` etc. work identically. Two extras:
>
> - Each `it(...)` block must end with `await allure.flush();` so the metadata
>   reaches the reporter.
> - `attach(name, data)` is now async — call it as `await attach(...)`.

**Covers:** R3 (Sensitive Data Exposure), R4 (Business Logic Exposure), R5 (XSS Prevention)

> **MANDATORY 3-layer coverage** (per SKILL.md "cobertura de 3 capas").
> Sending payloads to a service method (Layer 3) is not enough. If a developer removes `@IsString`, `@MaxLength`, `@Transform`, or weakens the global `ValidationPipe`, the Layer 3 test may still pass because the mocked service accepts whatever is given. Add the Layer 2 test below to verify DTO constraints exist.

```typescript
it('PENTEST: should sanitize user input to prevent XSS injection', async () => {
  const allure = new AllureCompat();
  const attach = attachFor(allure);
  await allure.epic('Security');
  await allure.feature('XSS Prevention / Input Sanitization');
  await allure.story('Sanitize all user input before processing or storing');
  await allure.severity('blocker');
  await allure.tag('Pentest');
  await allure.tag('OWASP A03');
  await allure.tag('GOES Checklist R5');
  await allure.description(
    '## Vulnerability Prevented\n' +
    '**Cross-Site Scripting (XSS)** — An attacker injects malicious scripts\n' +
    'through user input fields that get stored or reflected.\n\n' +
    '## Defense Implemented\n' +
    'All user input is sanitized/escaped before storage. HTML tags and\n' +
    'script injections are stripped or encoded.',
  );

  const xssPayloads = [
    '<script>alert("xss")</script>',
    '<img src=x onerror=alert("xss")>',
    '<svg onload=alert("xss")>',
    'javascript:alert("xss")',
    '<iframe src="javascript:alert(1)">',
    '"><script>document.cookie</script>',
  ];

  await allure.parameter('payloads', xssPayloads.length.toString());

  for (const payload of xssPayloads) {
    await allure.step(`Test payload: ${payload.substring(0, 30)}...`, async () => {
      const dto = { name: payload, description: payload };

      // Adapt to the actual service method
      prisma.record.create.mockResolvedValue({ id: 1, ...dto });
      const result = await service.create(dto);

      // The stored value should NOT contain raw script tags
      expect(result.name).not.toContain('<script>');
      expect(result.name).not.toContain('onerror');
      expect(result.name).not.toContain('onload');
    });
  }

  await attach('XSS payloads tested (input)', { payloads: xssPayloads });
  await attach('Defense result (output)', { allPayloadsBlocked: true });
  await allure.flush();
});

it('PENTEST: should not expose sensitive data in source files or responses', async () => {
  const allure = new AllureCompat();
  const attach = attachFor(allure);
  await allure.epic('Security');
  await allure.feature('Sensitive Data Exposure');
  await allure.story('No API keys, secrets, or personal data leaked in responses');
  await allure.severity('critical');
  await allure.tag('Pentest');
  await allure.tag('OWASP A02');
  await allure.tag('GOES Checklist R3');
  await allure.tag('GOES Checklist R4');
  await allure.description(
    '## Vulnerability Prevented\n' +
    '**Sensitive Data Exposure** — API responses or source files contain\n' +
    'secrets, API keys, personal IDs, or internal business logic.\n\n' +
    '## Defense Implemented\n' +
    'Responses are filtered through DTOs. Internal fields (password hash,\n' +
    'internal IDs, tokens) are never returned to the client.',
  );

  await allure.step('Prepare: mock a user record with sensitive fields', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: '1',
      email: 'user@test.com',
      password: '$2b$12$hashedpassword',
      role: 'USER',
      internalNotes: 'VIP customer',
      apiKey: 'sk-secret-key-123',
    });
  });

  const result = await allure.step('Execute: fetch user profile', async () => {
    return service.findOne('1');
  });

  await allure.step('Verify: sensitive fields are NOT in response', async () => {
    expect(result).not.toHaveProperty('password');
    expect(result).not.toHaveProperty('apiKey');
    expect(result).not.toHaveProperty('internalNotes');
    expect(JSON.stringify(result)).not.toMatch(/\$2b\$/); // no bcrypt hash
  });

  await attach('Response fields (output)', { fields: Object.keys(result) });
  await allure.flush();
});

// LAYER 2 (mandatory) — DTOs declare class-validator constraints. If a
// developer comments out @IsString / @MaxLength / @Matches, this test
// fails because validateSync returns 0 errors on an empty DTO.
it('R5/R11 — DTOs declare class-validator constraints on user-input fields', async () => {
  const t = report();
  t.epic('Seguridad');
  t.feature('XSS Prevention / Input Sanitization');
  t.story('Los DTOs de entrada de usuario tienen decoradores @IsString, @MaxLength, etc.');
  t.severity('blocker');
  t.tag('Config', 'OWASP A03', 'GOES Checklist R5', 'GOES Checklist R11');

  // Adapt to your project: import each user-input DTO that wraps a request body.
  // import { CreateUserDto } from '../../src/users/dto/create-user.dto';
  // import { LoginDto } from '../../src/auth/dto/login.dto';
  const { validateSync } = require('class-validator');

  const dtos = [
    { name: 'CreateUserDto', cls: CreateUserDto },
    { name: 'LoginDto', cls: LoginDto },
    // add every DTO that arrives via @Body() in a controller
  ];

  t.evidence('DTOs inspected (input)', { dtos: dtos.map((d) => d.name) });

  for (const { name, cls } of dtos) {
    const errors = validateSync(new cls());
    t.step(\`Verify: \${name} has at least one validation constraint\`);
    expect(errors.length).toBeGreaterThan(0);
  }

  t.evidence('Validation summary (output)', dtos.map(({ name, cls }) => ({
    dto: name,
    constrainedFields: validateSync(new cls()).map((e) => e.property),
  })));

  await t.flush();
});
```
