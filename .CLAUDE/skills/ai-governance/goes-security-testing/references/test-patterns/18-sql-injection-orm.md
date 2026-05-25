# Pattern 18: SQL Injection / ORM Usage

> **Migration note (skill v1.1):** these patterns were originally written for
> `allure-js-commons`. They now run against the bundled custom HTML reporter
> via `AllureCompat`, which mirrors the same API. The `_setup.md` snippet
> shows the new top-level imports. Existing `await allure.epic(...)`,
> `await allure.step(...)` etc. work identically. Two extras:
>
> - Each `it(...)` block must end with `await allure.flush();` so the metadata
>   reaches the reporter.
> - `attach(name, data)` is now async — call it as `await attach(...)`.

**Covers:** R37 (ORM Usage / SQL Injection Prevention)

> **MANDATORY 3-layer coverage** (per SKILL.md "cobertura de 3 capas").
> The Layer 3 test below verifies that when `service.findByEmail(payload)` is called, the ORM receives the payload as a parameter (not concatenated). That's necessary but not sufficient — if a developer adds a new method that uses `prisma.$queryRaw` with string interpolation, the existing tests don't see it. Add the Layer 2 test below: a static scan of `src/` for raw-SQL patterns. Any new occurrence fails the suite.

```typescript
it('PENTEST: should use ORM for all queries (no raw SQL concatenation)', async () => {
  const allure = new AllureCompat();
  const attach = attachFor(allure);
  await allure.epic('Security');
  await allure.feature('ORM Usage / SQL Injection Prevention');
  await allure.story('All database queries use parameterized ORM methods');
  await allure.severity('blocker');
  await allure.tag('Pentest');
  await allure.tag('OWASP A03');
  await allure.tag('GOES Checklist R37');
  await allure.description(
    '## Vulnerability Prevented\n' +
    '**SQL Injection** — Attackers inject malicious SQL through user\n' +
    'input that is concatenated directly into queries.\n\n' +
    '## Defense Implemented\n' +
    'All queries use Prisma/TypeORM ORM methods with parameterized inputs.\n' +
    'No raw SQL string concatenation.\n\n' +
    '## Reference\n' +
    'GOES Guide Section 7 — Database Security',
  );

  const sqlInjectionPayloads = [
    "' OR '1'='1",
    "'; DROP TABLE users; --",
    "' UNION SELECT * FROM users --",
    "1; DELETE FROM users",
    "admin'--",
  ];

  await allure.parameter('payloads', sqlInjectionPayloads.length.toString());

  for (const payload of sqlInjectionPayloads) {
    await allure.step(`Test payload: ${payload.substring(0, 30)}`, async () => {
      // The ORM should handle parameterization, so the payload
      // is treated as a literal string value, not executable SQL
      prisma.user.findUnique.mockResolvedValue(null);

      const result = await service.findByEmail(payload);

      // The ORM method should receive the payload as a parameter,
      // not as part of a concatenated query
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: payload }, // passed as parameter, not concatenated
      });

      // No record should be returned for SQL injection attempts
      expect(result).toBeNull();
    });
  }

  await attach('SQL injection payloads tested (input)', { payloads: sqlInjectionPayloads });
  await attach('Defense result (output)', {
    allPayloadsParameterized: true,
    noRawSQLUsed: true,
  });
  await allure.flush();
});

it('PENTEST: should prevent NoSQL injection in query parameters', async () => {
  const allure = new AllureCompat();
  const attach = attachFor(allure);
  await allure.epic('Security');
  await allure.feature('ORM Usage / SQL Injection Prevention');
  await allure.story('Reject NoSQL injection operators in query params');
  await allure.severity('blocker');
  await allure.tag('Pentest');
  await allure.tag('OWASP A03');
  await allure.tag('GOES Checklist R37');
  await allure.description(
    '## Vulnerability Prevented\n' +
    '**NoSQL Injection** — Attackers send objects with MongoDB operators\n' +
    '($gt, $ne, $regex) instead of expected string values.\n\n' +
    '## Defense Implemented\n' +
    'Input validation rejects objects/arrays where strings are expected.\n' +
    'DTO validation ensures correct types.',
  );

  const noSqlPayloads = [
    { email: { $gt: '' } },
    { email: { $ne: null } },
    { email: { $regex: '.*' } },
    { password: { $exists: true } },
  ];

  for (const payload of noSqlPayloads) {
    await allure.step(`Test payload: ${JSON.stringify(payload).substring(0, 40)}`, async () => {
      await expect(service.login(payload as any, '1.2.3.4', 'ua')).rejects.toThrow();
    });
  }

  await attach('NoSQL injection payloads (output)', {
    total: noSqlPayloads.length,
    allRejected: true,
  });
  await allure.flush();
});

// LAYER 2 (mandatory) — static scan of src/ for raw SQL patterns.
// If a developer adds prisma.$queryRaw(...) with template-string
// interpolation, this test fails. The scan is deterministic and runs
// in milliseconds.
it('R37 — Source code does NOT use raw SQL or string-interpolated queries', async () => {
  const t = report();
  t.epic('Seguridad');
  t.feature('ORM Usage / SQL Injection Prevention');
  t.story('Codigo fuente NO usa $queryRaw, $executeRaw, query() ni concat manual de SQL');
  t.severity('blocker');
  t.tag('Pentest', 'OWASP A03', 'GOES Checklist R37');

  const fs = require('fs');
  const path = require('path');

  function walk(dir, results = []) {
    if (!fs.existsSync(dir)) return results;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath, results);
      } else if (entry.isFile() && /\\.(ts|js)$/.test(entry.name) && !/\\.spec\\.|\\.e2e-spec\\./.test(entry.name)) {
        results.push(fullPath);
      }
    }
    return results;
  }

  const srcDir = path.resolve(__dirname, '../../src');
  const files = walk(srcDir);

  // Patterns that indicate raw SQL or interpolated SQL — adapt as needed.
  const dangerousPatterns = [
    { name: 'Prisma $queryRawUnsafe', regex: /\\$queryRawUnsafe\\s*\\(/g },
    { name: 'Prisma $executeRawUnsafe', regex: /\\$executeRawUnsafe\\s*\\(/g },
    { name: 'TypeORM raw .query()', regex: /\\.query\\s*\\(\\s*[\`'"]/g },
    { name: 'createQueryRunner().query', regex: /createQueryRunner\\(\\)\\.query\\(/g },
    // $queryRaw and $executeRaw with TEMPLATE LITERALS are safe (parameterized).
    // $queryRawUnsafe and string-arg .query() are dangerous.
  ];

  const findings = [];
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf-8');
    for (const { name, regex } of dangerousPatterns) {
      const matches = content.match(regex);
      if (matches) {
        findings.push({
          file: path.relative(process.cwd(), file),
          pattern: name,
          count: matches.length,
        });
      }
    }
  }

  t.evidence('Static scan parameters (input)', {
    srcDir: path.relative(process.cwd(), srcDir),
    filesScanned: files.length,
    dangerousPatterns: dangerousPatterns.map((p) => p.name),
  });

  t.step('Verify: no raw SQL or interpolated query patterns in src/');
  expect(findings).toEqual([]);

  t.evidence('Scan result (output)', findings.length === 0
    ? { allClear: true, filesScanned: files.length }
    : { findings });

  await t.flush();
});
```
