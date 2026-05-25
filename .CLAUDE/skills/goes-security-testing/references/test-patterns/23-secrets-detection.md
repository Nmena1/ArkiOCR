# Pattern 23: Secrets & API Keys Detection — Static Source Scan

> **Migration note (skill v1.1):** uses the lightweight `report()` API from the
> bundled custom HTML reporter. Each `it(...)` block must end with
> `await t.flush();` so the metadata reaches the reporter.

**Covers:** R3 (No secrets in source code), OWASP A02 (Cryptographic Failures)

## What this pattern does

Recursively scans all `.ts`/`.js` files under `src/` looking for hardcoded
secrets, API keys, passwords, tokens, private keys, and connection strings
with embedded credentials. Each pattern includes "safeguards" — if the line
also references `process.env` or `configService`, it is considered safe
(the value comes from the environment, not hardcoded).

### Detected patterns

| # | Label | Regex trigger | Example match |
|---|-------|---------------|---------------|
| 1 | API Key assignment | `api_key = "ABC..."` | `const api_key = "sk_live_abc123"` |
| 2 | Secret/Token assignment | `secret = "..."`, `auth_token = "..."` | `const jwt_secret = "myS3cret!"` |
| 3 | Password hardcoded | `password = "..."` | `const dbPass = "admin123"` |
| 4 | AWS Access Key | `AKIA` + 16 alphanumeric | `AKIAIOSFODNN7EXAMPLE` |
| 5 | Google API Key | `AIza` + 35 chars | `AIzaSyC9n2s8Xo7l3m1v5q6r8s9t0u1w2x3y4z5` |
| 6 | Bearer token | `"Bearer eyJhbG..."` | Inline auth headers |
| 7 | Private key (PEM) | `-----BEGIN PRIVATE KEY-----` | Embedded RSA/EC keys |
| 8 | Connection string | `://user:pass@host` | `postgres://admin:secret@db:5432` |
| 9 | JWT secret | `jwt_secret = "..."` | Hardcoded signing key |
| 10 | DB password | `db_password = "..."` | Hardcoded database credential |

### Safeguards (ignored as safe)

Lines matching any of these are NOT flagged:
- `process.env` — value comes from environment variable
- `configService` / `Config(` — value comes from NestJS config
- `.env` — reference to env file (not a hardcoded value)
- `localhost` / `127.0.0.1` — local development defaults (for connection strings)

## Spec template

```typescript
/**
 * Secrets & API Keys Detection — Static Source Code Scan
 *
 * Scans all TypeScript/JavaScript source files for hardcoded secrets,
 * API keys, passwords, tokens, and other sensitive values that should
 * live in environment variables or a vault — never in code.
 *
 * Checklist: GOES R3, OWASP A02 (Cryptographic Failures)
 */
import { report } from '@security-reporter/metadata';
import * as fs from 'fs';
import * as path from 'path';

// ─── Helpers ────────────────────────────────────────────────────────

/** Recursively collect all .ts/.js files under a directory, skipping node_modules/dist/test */
function walkSourceFiles(dir: string, files: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', 'dist', 'test', 'tests', '.git', 'coverage', 'reports'].includes(entry.name)) continue;
      walkSourceFiles(fullPath, files);
    } else if (/\.(ts|js)$/.test(entry.name) && !entry.name.endsWith('.spec.ts') && !entry.name.endsWith('.d.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

// ─── Secret patterns ────────────────────────────────────────────────

interface SecretPattern {
  label: string;
  regex: RegExp;
  /** If the matched line also matches any of these, it's considered safe */
  safeguards?: RegExp[];
}

const SECRET_PATTERNS: SecretPattern[] = [
  {
    label: 'API Key assignment',
    regex: /(?:api[_-]?key|apikey)\s*[:=]\s*['"`][A-Za-z0-9_\-]{10,}/i,
    safeguards: [/process\.env/, /configService/, /Config\(/, /\.env/],
  },
  {
    label: 'Secret/Token assignment',
    regex: /(?:secret|token|auth[_-]?token|access[_-]?token|private[_-]?key)\s*[:=]\s*['"`][A-Za-z0-9_\-/+]{10,}/i,
    safeguards: [/process\.env/, /configService/, /Config\(/, /\.env/, /expiresIn/, /algorithm/],
  },
  {
    label: 'Password hardcoded',
    regex: /(?:password|passwd|pwd)\s*[:=]\s*['"`][^'"`]{6,}/i,
    safeguards: [/process\.env/, /configService/, /\.env/, /dto\./i, /hash/i, /bcrypt/i, /compare/i, /validator/i],
  },
  {
    label: 'AWS Access Key',
    regex: /AKIA[0-9A-Z]{16}/,
  },
  {
    label: 'Google API Key',
    regex: /AIza[0-9A-Za-z_-]{35}/,
  },
  {
    label: 'Generic Bearer token',
    regex: /['"`]Bearer\s+[A-Za-z0-9_\-.]{20,}['"`]/,
    safeguards: [/test|spec|mock|fake/i],
  },
  {
    label: 'Private key inline (PEM)',
    regex: /-----BEGIN\s+(RSA\s+)?PRIVATE KEY-----/,
  },
  {
    label: 'Connection string with credentials',
    regex: /:\/\/[^/\s]+:[^@/\s]+@[^/\s]+/,
    safeguards: [/process\.env/, /configService/, /Config\(/, /\.env/, /localhost/],
  },
  {
    label: 'JWT secret hardcoded',
    regex: /jwt[_-]?secret\s*[:=]\s*['"`][^'"`]{8,}/i,
    safeguards: [/process\.env/, /configService/, /Config\(/],
  },
  {
    label: 'Database password hardcoded',
    regex: /(?:db[_-]?pass|database[_-]?password|DB_PASSWORD)\s*[:=]\s*['"`][^'"`]{4,}/i,
    safeguards: [/process\.env/, /configService/, /Config\(/],
  },
];

// ─── Root dir ───────────────────────────────────────────────────────
const ROOT = path.resolve(__dirname, '../..');
const SRC_DIR = path.join(ROOT, 'src');

// ─── Tests ──────────────────────────────────────────────────────────
describe('Secrets & API Keys Detection — Static Source Scan', () => {
  let sourceFiles: string[];

  beforeAll(() => {
    sourceFiles = walkSourceFiles(SRC_DIR);
  });

  it('R3 — No hardcoded API keys in source files', async () => {
    const t = report();
    t.epic('Seguridad');
    t.feature('Secrets Detection');
    t.story('Ningun archivo fuente contiene API keys hardcodeadas');
    t.severity('critical');
    t.tag('Pentest', 'OWASP A02', 'GOES Checklist R3');

    t.step('Scan all .ts/.js files under src/');

    const findings: Array<{ file: string; line: number; pattern: string; snippet: string }> = [];

    for (const filePath of sourceFiles) {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      const relPath = path.relative(ROOT, filePath);

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim().startsWith('//') || line.trim().startsWith('*')) continue;

        for (const pattern of SECRET_PATTERNS) {
          if (pattern.regex.test(line)) {
            const isSafe = pattern.safeguards?.some(sg => sg.test(line)) ?? false;
            if (!isSafe) {
              findings.push({
                file: relPath,
                line: i + 1,
                pattern: pattern.label,
                snippet: line.trim().substring(0, 100),
              });
            }
          }
        }
      }
    }

    t.parameter('files_scanned', sourceFiles.length);
    t.parameter('patterns_checked', SECRET_PATTERNS.length);
    t.evidence('Scan configuration', {
      scanDir: 'src/',
      fileCount: sourceFiles.length,
      patternsChecked: SECRET_PATTERNS.map(p => p.label),
    });

    t.step(`Evaluate findings: ${findings.length} potential secrets found`);
    t.evidence('Scan results', {
      totalFindings: findings.length,
      findings: findings.length > 0 ? findings : 'CLEAN — no hardcoded secrets detected',
    });

    expect(findings).toEqual([]);
    await t.flush();
  });

  it('R3 — No Google API keys in source (AIza pattern)', async () => {
    const t = report();
    t.epic('Seguridad');
    t.feature('Secrets Detection');
    t.story('Ningun archivo fuente contiene Google API keys');
    t.severity('critical');
    t.tag('Pentest', 'OWASP A02', 'GOES Checklist R3');

    t.step('Scan for AIza prefix (Google API Key)');

    const findings: Array<{ file: string; line: number; snippet: string }> = [];

    for (const filePath of sourceFiles) {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      const relPath = path.relative(ROOT, filePath);

      for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim().startsWith('//') || lines[i].trim().startsWith('*')) continue;
        if (/AIza[0-9A-Za-z_-]{35}/.test(lines[i])) {
          findings.push({ file: relPath, line: i + 1, snippet: lines[i].trim().substring(0, 80) });
        }
      }
    }

    t.evidence('Google API key scan results', {
      totalFindings: findings.length,
      findings: findings.length > 0 ? findings : 'CLEAN',
    });

    expect(findings).toEqual([]);
    await t.flush();
  });

  it('R3 — No AWS access keys in source (AKIA pattern)', async () => {
    const t = report();
    t.epic('Seguridad');
    t.feature('Secrets Detection');
    t.story('Ningun archivo fuente contiene AWS Access Keys');
    t.severity('blocker');
    t.tag('Pentest', 'OWASP A02', 'GOES Checklist R3');

    t.step('Scan for AKIA pattern (AWS Access Key ID)');

    const findings: Array<{ file: string; line: number; snippet: string }> = [];

    for (const filePath of sourceFiles) {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      const relPath = path.relative(ROOT, filePath);

      for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim().startsWith('//') || lines[i].trim().startsWith('*')) continue;
        if (/AKIA[0-9A-Z]{16}/.test(lines[i])) {
          findings.push({ file: relPath, line: i + 1, snippet: lines[i].trim().substring(0, 80) });
        }
      }
    }

    t.evidence('AWS key scan results', {
      totalFindings: findings.length,
      findings: findings.length > 0 ? findings : 'CLEAN',
    });

    expect(findings).toEqual([]);
    await t.flush();
  });

  it('R3 — No private keys (PEM) embedded in source', async () => {
    const t = report();
    t.epic('Seguridad');
    t.feature('Secrets Detection');
    t.story('Ningun archivo fuente embebe private keys PEM');
    t.severity('blocker');
    t.tag('Pentest', 'OWASP A02', 'GOES Checklist R3');

    t.step('Scan for BEGIN PRIVATE KEY patterns');

    const findings: Array<{ file: string; line: number }> = [];

    for (const filePath of sourceFiles) {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      const relPath = path.relative(ROOT, filePath);

      for (let i = 0; i < lines.length; i++) {
        if (/-----BEGIN\s+(RSA\s+)?PRIVATE KEY-----/.test(lines[i])) {
          if (!lines[i].trim().startsWith('//') && !lines[i].trim().startsWith('*')) {
            findings.push({ file: relPath, line: i + 1 });
          }
        }
      }
    }

    t.evidence('PEM scan results', {
      totalFindings: findings.length,
      findings: findings.length > 0 ? findings : 'CLEAN — no embedded private keys',
    });

    expect(findings).toEqual([]);
    await t.flush();
  });

  it('R3 — Connection strings do not embed credentials', async () => {
    const t = report();
    t.epic('Seguridad');
    t.feature('Secrets Detection');
    t.story('Connection strings usan env vars, no credenciales inline');
    t.severity('critical');
    t.tag('Pentest', 'OWASP A02', 'GOES Checklist R3');

    t.step('Scan for protocol://user:pass@host patterns');

    const connStringPattern = /:\/\/[^/\s]+:[^@/\s]+@[^/\s]+/;
    const safeguards = [/process\.env/, /configService/, /Config\(/, /localhost/, /127\.0\.0\.1/, /example\.com/];

    const findings: Array<{ file: string; line: number; snippet: string }> = [];

    for (const filePath of sourceFiles) {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      const relPath = path.relative(ROOT, filePath);

      for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim().startsWith('//') || lines[i].trim().startsWith('*')) continue;
        if (connStringPattern.test(lines[i])) {
          const isSafe = safeguards.some(sg => sg.test(lines[i]));
          if (!isSafe) {
            findings.push({
              file: relPath,
              line: i + 1,
              snippet: lines[i].trim().substring(0, 80).replace(/:[^@/]+@/, ':****@'),
            });
          }
        }
      }
    }

    t.evidence('Connection string scan results', {
      totalFindings: findings.length,
      findings: findings.length > 0 ? findings : 'CLEAN',
    });

    expect(findings).toEqual([]);
    await t.flush();
  });

  it('R3 — Environment variables used for all sensitive config', async () => {
    const t = report();
    t.epic('Seguridad');
    t.feature('Secrets Detection');
    t.story('Configuracion sensible viene de process.env, no hardcodeada');
    t.severity('normal');
    t.tag('OWASP A02', 'GOES Checklist R3');

    t.step('Verify config files read from process.env');

    const configFiles = sourceFiles.filter(f =>
      f.includes('config') || f.includes('environment') || f.includes('.env'),
    );

    const envUsage: Array<{ file: string; envReferences: number }> = [];

    for (const filePath of configFiles) {
      const content = fs.readFileSync(filePath, 'utf-8');
      const relPath = path.relative(ROOT, filePath);
      const matches = content.match(/process\.env\./g);
      envUsage.push({ file: relPath, envReferences: matches?.length || 0 });
    }

    t.evidence('Config files using process.env', { configFiles: envUsage });

    const totalEnvRefs = envUsage.reduce((sum, f) => sum + f.envReferences, 0);
    t.step(`Found ${totalEnvRefs} process.env references across ${configFiles.length} config files`);

    expect(totalEnvRefs).toBeGreaterThan(0);
    await t.flush();
  });
});
```

## Adapting for Vue / frontend projects

For Vue projects, adjust:
- `SRC_DIR` → point to your `src/` (same path convention)
- Add additional patterns for frontend-specific leaks:
  - `VITE_` prefixed secrets that shouldn't be in source
  - Firebase config objects with `apiKey`
  - Hardcoded `Authorization` headers in API clients
- The `walkSourceFiles` helper already skips `node_modules`, `dist`, `test`

## Why separate tests per pattern type

Each secret type gets its own `it()` block so the report shows exactly
**which category** failed (Google key vs AWS key vs PEM vs password).
The generic "No hardcoded API keys" test catches everything, but the
specific tests give better diagnostic context in the modal.
