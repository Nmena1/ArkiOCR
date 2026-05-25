# Pattern 24: Public Files Exposure — robots.txt, Sensitive Files, Source Maps

> **Migration note (skill v1.1):** uses the lightweight `report()` API from the
> bundled custom HTML reporter. Each `it(...)` block must end with
> `await t.flush();` so the metadata reaches the reporter.

**Covers:** R3 (No exposed secrets), R6 (Secure deployment), OWASP A01 (Broken Access Control), A05 (Security Misconfiguration)

## What this pattern does

Verifies that public-facing artifacts do not leak internal structure, source code, or sensitive files:

1. **robots.txt scanning** — If present, ensures it does NOT list internal paths
   (admin panels, API endpoints, staging URLs, debug endpoints, database directories)
   that could serve as a reconnaissance map for attackers.

2. **Sensitive files in public directories** — Scans `public/`, `static/`, `assets/`, `dist/public/`
   etc. for files with dangerous extensions (`.env`, `.sql`, `.pem`, `.key`, `.log`, `.bak`)
   that should NEVER be served statically.

3. **Source maps in production** — Checks `dist/` for `.js.map` and `.css.map` files
   and verifies `tsconfig.build.json` has `sourceMap: false`.

4. **.gitignore coverage** — Confirms that sensitive patterns (`.env`, keys, build output)
   are protected from accidental commits.

5. **Debug artifacts** — Ensures `debug.log`, `dump.sql`, `credentials.json`,
   `.DS_Store`, and other temporary/backup files are not in the project root.

### robots.txt dangerous patterns (22 Disallow keywords)

When `robots.txt` exists, the scanner detects 22 dangerous internal path disclosures:

| # | Pattern | Description |
|----|---------|-------------|
| 1 | `/admin` | Admin panel (common target) |
| 2 | `/api` | API endpoints |
| 3 | `/staging` | Staging environment |
| 4 | `/internal` | Internal routes |
| 5 | `/debug` | Debug endpoint |
| 6 | `/backup` | Backup directory |
| 7 | `/.env` | Environment file reference |
| 8 | `/config` | System configuration |
| 9 | `/private` | Private directory |
| 10 | `/test` | Test directory |
| 11 | `/tmp` | Temporary files |
| 12 | `/log(s)` | Log files |
| 13 | `/database` | Database directory |
| 14 | `/cgi-bin` | CGI scripts |
| 15 | `/wp-admin` | WordPress admin |
| 16 | `/phpmyadmin` | Database admin panel |
| 17 | `/server-status` | Server status page |
| 18 | `/.git` | Exposed git repository |
| 19 | `/swagger` | API documentation |
| 20 | `/graphql` | GraphQL endpoint |
| 21 | `/health` | Health check endpoint |
| 22 | `/metrics` | System metrics |

### Sensitive file detection

Files checked in public directories:

- **Environment & Config:** `.env`, `.env.local`, `.env.production`, `.env.staging`
- **Cryptographic keys:** `.pem`, `.key`, `.p12`, `.pfx`, `.jks`
- **Database:** `.sql`, `.dump`, `.sqlite`, `.db`
- **Logs & Backups:** `.log`, `.bak`, `.old`, `.orig`, `.swp`, `.gz`, `.tar`, `.zip`

### Output formatting with formatFindings()

The helper `formatFindings(findings, category)` produces human-readable error messages
with categorized recommendations from the `RECOMMENDATIONS` map:

```
Se encontraron N hallazgo(s) de tipo: [category]
════════════════════════════════════════════════════════
  #1  ROBOTS SENSITIVE KEYWORD
  Archivo:  robots.txt:45
  Contenido: Disallow: /admin — revela: /admin — panel de administracion
  Fix:      Elimine las rutas internas del robots.txt...

  ──────────────────────────────────────────────────────
  #2  SOURCE MAP IN DIST
  Archivo:  dist/main.js.map
  Contenido: Source map expone codigo fuente: main.js.map
  Fix:      Deshabilite source maps en produccion...
════════════════════════════════════════════════════════
Total: 2 — Los archivos publicos no deben revelar estructura interna.
```

## Spec template

```typescript
/**
 * Public Files Exposure — robots.txt, sitemap.xml, sensitive files
 *
 * Verifies that:
 * 1. If robots.txt exists, it does NOT reveal internal paths (admin panels,
 *    API endpoints, staging URLs, internal directories).
 * 2. No sensitive files (.env, .sql, .pem, .key, .log, backups) are in
 *    directories that could be served publicly (public/, static/, assets/).
 * 3. Source maps (.map) are not present in build output.
 * 4. Debug/config artifacts are not accidentally committed.
 *
 * Checklist: GOES R3, R6, OWASP A01, A05
 */
import { report } from '@security-reporter/metadata';
import * as fs from 'fs';
import * as path from 'path';

// ─── Helpers ────────────────────────────────────────────────────────

interface Finding {
  file: string;
  line?: number;
  issue: string;
  snippet?: string;
}

const RECOMMENDATIONS: Record<string, string> = {
  'robots_internal_path':
    'Elimine las rutas internas del robots.txt. Un atacante usa Disallow para descubrir endpoints ocultos. Use solo rutas publicas.',
  'robots_sensitive_keyword':
    'No mencione rutas con "admin", "api", "staging", "internal", "debug", "backup" en robots.txt — esto le da un mapa al atacante.',
  'sensitive_file_public':
    'Mueva este archivo fuera de carpetas publicas. Los archivos .env, .sql, .pem, .key, .log nunca deben ser servidos estaticamente.',
  'source_map_in_dist':
    'Deshabilite source maps en produccion (sourceMap: false en tsconfig.build.json). Exponen el codigo fuente original.',
  'env_file_exposed':
    'Verifique que .env esta en .gitignore y que no existe en dist/ ni public/. Contiene secrets del sistema.',
  'backup_file':
    'Elimine archivos de backup (.bak, .old, .dump, .sql.gz) del repositorio. Pueden contener data sensible.',
  'debug_artifact':
    'Elimine archivos de debug del proyecto (debug.log, npm-debug.log, .DS_Store). Agreguelos a .gitignore.',
};

function formatFindings(findings: Finding[], category: string): string {
  if (findings.length === 0) return '';

  const lines: string[] = [
    '',
    `Se encontraron ${findings.length} hallazgo(s) de tipo: ${category}`,
    '═'.repeat(70),
  ];

  for (let i = 0; i < findings.length; i++) {
    const f = findings[i];
    const rec = RECOMMENDATIONS[f.issue] || 'Revise este archivo y elimine o mueva la informacion sensible.';

    lines.push('');
    lines.push(`  #${i + 1}  ${f.issue.replace(/_/g, ' ').toUpperCase()}`);
    lines.push(`  Archivo:  ${f.file}${f.line ? ':' + f.line : ''}`);
    if (f.snippet) lines.push(`  Contenido: ${f.snippet}`);
    lines.push(`  Fix:      ${rec}`);

    if (i < findings.length - 1) lines.push('  ' + '─'.repeat(66));
  }

  lines.push('');
  lines.push('═'.repeat(70));
  lines.push(`Total: ${findings.length} — Los archivos publicos no deben revelar estructura interna.`);
  lines.push('');

  return lines.join('\n');
}

// ─── Root dir ───────────────────────────────────────────────────────
const ROOT = path.resolve(__dirname, '../..');

// ─── Sensitive path patterns in robots.txt ──────────────────────────
const ROBOTS_DANGEROUS_PATTERNS = [
  { regex: /Disallow:\s*\/admin/i, label: '/admin — panel de administracion' },
  { regex: /Disallow:\s*\/api\b/i, label: '/api — endpoints de la API' },
  { regex: /Disallow:\s*\/staging/i, label: '/staging — ambiente de staging' },
  { regex: /Disallow:\s*\/internal/i, label: '/internal — rutas internas' },
  { regex: /Disallow:\s*\/debug/i, label: '/debug — endpoint de debug' },
  { regex: /Disallow:\s*\/backup/i, label: '/backup — directorio de backups' },
  { regex: /Disallow:\s*\/\.env/i, label: '/.env — archivo de variables de entorno' },
  { regex: /Disallow:\s*\/config/i, label: '/config — configuracion del sistema' },
  { regex: /Disallow:\s*\/private/i, label: '/private — directorio privado' },
  { regex: /Disallow:\s*\/test/i, label: '/test — directorio de tests' },
  { regex: /Disallow:\s*\/tmp/i, label: '/tmp — archivos temporales' },
  { regex: /Disallow:\s*\/logs?/i, label: '/log(s) — logs del sistema' },
  { regex: /Disallow:\s*\/database/i, label: '/database — directorio de base de datos' },
  { regex: /Disallow:\s*\/cgi-bin/i, label: '/cgi-bin — scripts del servidor' },
  { regex: /Disallow:\s*\/wp-admin/i, label: '/wp-admin — admin de WordPress' },
  { regex: /Disallow:\s*\/phpmyadmin/i, label: '/phpmyadmin — admin de base de datos' },
  { regex: /Disallow:\s*\/server-status/i, label: '/server-status — status del servidor' },
  { regex: /Disallow:\s*\/\.git/i, label: '/.git — repositorio git expuesto' },
  { regex: /Disallow:\s*\/swagger/i, label: '/swagger — documentacion de API' },
  { regex: /Disallow:\s*\/graphql/i, label: '/graphql — endpoint GraphQL' },
  { regex: /Disallow:\s*\/health/i, label: '/health — health check endpoint' },
  { regex: /Disallow:\s*\/metrics/i, label: '/metrics — metricas del sistema' },
];

// ─── Sensitive file extensions ──────────────────────────────────────
const SENSITIVE_EXTENSIONS = [
  '.env', '.pem', '.key', '.p12', '.pfx', '.jks',
  '.sql', '.dump', '.sqlite', '.db',
  '.log', '.bak', '.old', '.orig', '.swp',
  '.gz', '.tar', '.zip',
];

// ─── Tests ──────────────────────────────────────────────────────────
describe('Public Files Exposure — robots.txt, sensitive files, source maps', () => {

  it('R6 — robots.txt no revela rutas internas ni estructura del sistema', async () => {
    const t = report();
    t.epic('Seguridad');
    t.feature('Information Disclosure');
    t.story('robots.txt no expone rutas internas al atacante');
    t.severity('critical');
    t.tag('Pentest', 'OWASP A01', 'GOES Checklist R6');

    const robotsPath = path.join(ROOT, 'robots.txt');
    const publicRobots = path.join(ROOT, 'public', 'robots.txt');
    const staticRobots = path.join(ROOT, 'static', 'robots.txt');

    // Check all possible locations
    const robotsFiles = [robotsPath, publicRobots, staticRobots].filter(f => fs.existsSync(f));

    if (robotsFiles.length === 0) {
      t.step('No robots.txt found — OK, no information leak');
      t.evidence('Scan results', { robotsFound: false, status: 'SAFE — no robots.txt present' });
      await t.flush();
      return;
    }

    t.step(`Found ${robotsFiles.length} robots.txt file(s)`);

    const findings: Finding[] = [];

    for (const robotsFile of robotsFiles) {
      const content = fs.readFileSync(robotsFile, 'utf-8');
      const relPath = path.relative(ROOT, robotsFile);
      const lines = content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        for (const pattern of ROBOTS_DANGEROUS_PATTERNS) {
          if (pattern.regex.test(line)) {
            findings.push({
              file: relPath,
              line: i + 1,
              issue: 'robots_sensitive_keyword',
              snippet: `${line.trim()} — revela: ${pattern.label}`,
            });
          }
        }

        // Also flag any Disallow with paths that look internal
        if (/Disallow:\s*\/[a-z].*\//i.test(line) && !/^\s*#/.test(line)) {
          const pathMatch = line.match(/Disallow:\s*(\/[^\s]+)/i);
          if (pathMatch) {
            const disallowedPath = pathMatch[1];
            // Check for deep paths that reveal structure
            if ((disallowedPath.match(/\//g) || []).length >= 3) {
              findings.push({
                file: relPath,
                line: i + 1,
                issue: 'robots_internal_path',
                snippet: `${line.trim()} — ruta profunda revela estructura interna`,
              });
            }
          }
        }
      }
    }

    t.evidence('robots.txt scan', {
      filesScanned: robotsFiles.map(f => path.relative(ROOT, f)),
      totalFindings: findings.length,
      findings: findings.length > 0 ? findings : 'CLEAN — robots.txt no revela rutas internas',
    });

    if (findings.length > 0) {
      await t.flush();
      throw new Error(formatFindings(findings, 'robots.txt — Information Disclosure'));
    }
    await t.flush();
  });

  it('R3 — No sensitive files in public/static directories', async () => {
    const t = report();
    t.epic('Seguridad');
    t.feature('Information Disclosure');
    t.story('Archivos sensibles no estan en carpetas publicas');
    t.severity('blocker');
    t.tag('Pentest', 'OWASP A05', 'GOES Checklist R3');

    const publicDirs = ['public', 'static', 'assets', 'www', 'dist/public', 'dist/static'];
    const findings: Finding[] = [];

    t.step('Scan public directories for sensitive files');

    for (const dir of publicDirs) {
      const fullDir = path.join(ROOT, dir);
      if (!fs.existsSync(fullDir)) continue;

      const walkDir = (d: string) => {
        for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
          const fullPath = path.join(d, entry.name);
          if (entry.isDirectory()) {
            if (entry.name !== 'node_modules') walkDir(fullPath);
          } else {
            const ext = path.extname(entry.name).toLowerCase();
            const name = entry.name.toLowerCase();

            // Check sensitive extensions
            if (SENSITIVE_EXTENSIONS.some(e => name.endsWith(e))) {
              findings.push({
                file: path.relative(ROOT, fullPath),
                issue: 'sensitive_file_public',
                snippet: `Archivo ${ext} en directorio publico: ${dir}/`,
              });
            }

            // Check .env files specifically
            if (name.startsWith('.env')) {
              findings.push({
                file: path.relative(ROOT, fullPath),
                issue: 'env_file_exposed',
                snippet: 'Archivo .env accesible publicamente',
              });
            }
          }
        }
      };

      walkDir(fullDir);
    }

    t.parameter('directories_scanned', publicDirs.length);
    t.evidence('Public directory scan', {
      dirsChecked: publicDirs,
      totalFindings: findings.length,
      findings: findings.length > 0 ? findings : 'CLEAN — no sensitive files in public dirs',
    });

    if (findings.length > 0) {
      await t.flush();
      throw new Error(formatFindings(findings, 'Archivos sensibles en carpetas publicas'));
    }
    await t.flush();
  });

  it('R3 — No source maps (.map) in production build', async () => {
    const t = report();
    t.epic('Seguridad');
    t.feature('Information Disclosure');
    t.story('Source maps no se incluyen en el build de produccion');
    t.severity('critical');
    t.tag('Pentest', 'OWASP A05', 'GOES Checklist R3');

    const distDir = path.join(ROOT, 'dist');
    const findings: Finding[] = [];

    t.step('Scan dist/ for .js.map and .css.map files');

    if (!fs.existsSync(distDir)) {
      t.step('No dist/ directory — skipping (build not present)');
      t.evidence('Scan results', { distExists: false, status: 'SKIPPED — no build output' });
      await t.flush();
      return;
    }

    const walkDir = (d: string) => {
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        const fullPath = path.join(d, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== 'node_modules') walkDir(fullPath);
        } else if (entry.name.endsWith('.map')) {
          findings.push({
            file: path.relative(ROOT, fullPath),
            issue: 'source_map_in_dist',
            snippet: `Source map expone codigo fuente: ${entry.name}`,
          });
        }
      }
    };

    walkDir(distDir);

    // Also check tsconfig.build.json for sourceMap setting
    let sourceMapEnabled = false;
    const tsconfigBuild = path.join(ROOT, 'tsconfig.build.json');
    if (fs.existsSync(tsconfigBuild)) {
      const content = fs.readFileSync(tsconfigBuild, 'utf-8');
      if (/"sourceMap"\s*:\s*true/i.test(content)) {
        sourceMapEnabled = true;
        findings.push({
          file: 'tsconfig.build.json',
          issue: 'source_map_in_dist',
          snippet: 'sourceMap: true — el build genera .map files que exponen codigo fuente',
        });
      }
    }

    t.evidence('Source map scan', {
      mapFilesFound: findings.filter(f => f.file.endsWith('.map')).length,
      sourceMapInConfig: sourceMapEnabled,
      totalFindings: findings.length,
      findings: findings.length > 0 ? findings : 'CLEAN — no source maps in dist/',
    });

    if (findings.length > 0) {
      await t.flush();
      throw new Error(formatFindings(findings, 'Source maps en produccion'));
    }
    await t.flush();
  });

  it('R3 — No debug/config artifacts committed', async () => {
    const t = report();
    t.epic('Seguridad');
    t.feature('Information Disclosure');
    t.story('Archivos de debug y backup no estan en el repositorio');
    t.severity('normal');
    t.tag('OWASP A05', 'GOES Checklist R3');

    t.step('Scan project root for debug and backup artifacts');

    const dangerousFiles = [
      'debug.log', 'npm-debug.log', 'yarn-error.log',
      '.DS_Store', 'Thumbs.db',
      'dump.sql', 'backup.sql', 'db.sqlite',
      '.htpasswd', '.htaccess',
      'docker-compose.override.yml',
      'credentials.json', 'serviceAccount.json',
      'firebase-adminsdk.json',
    ];

    const findings: Finding[] = [];

    for (const fileName of dangerousFiles) {
      const filePath = path.join(ROOT, fileName);
      if (fs.existsSync(filePath)) {
        findings.push({
          file: fileName,
          issue: 'debug_artifact',
          snippet: `Archivo peligroso encontrado en raiz del proyecto`,
        });
      }
    }

    // Also check for .env copies that shouldn't exist
    const envVariants = ['.env.production', '.env.staging', '.env.local'];
    for (const envFile of envVariants) {
      const filePath = path.join(ROOT, envFile);
      if (fs.existsSync(filePath)) {
        // It's OK if it's in .gitignore
        const gitignorePath = path.join(ROOT, '.gitignore');
        if (fs.existsSync(gitignorePath)) {
          const gitignore = fs.readFileSync(gitignorePath, 'utf-8');
          if (!gitignore.includes(envFile) && !gitignore.includes('.env*') && !gitignore.includes('.env.')) {
            findings.push({
              file: envFile,
              issue: 'env_file_exposed',
              snippet: `${envFile} existe pero NO esta en .gitignore`,
            });
          }
        }
      }
    }

    t.evidence('Debug artifact scan', {
      filesChecked: dangerousFiles.length + envVariants.length,
      totalFindings: findings.length,
      findings: findings.length > 0 ? findings : 'CLEAN — no debug artifacts found',
    });

    if (findings.length > 0) {
      await t.flush();
      throw new Error(formatFindings(findings, 'Archivos de debug/backup en el proyecto'));
    }
    await t.flush();
  });

  it('R6 — .gitignore protege archivos sensibles', async () => {
    const t = report();
    t.epic('Seguridad');
    t.feature('Information Disclosure');
    t.story('.gitignore incluye patrones para archivos sensibles');
    t.severity('critical');
    t.tag('OWASP A05', 'GOES Checklist R3', 'GOES Checklist R6');

    const gitignorePath = path.join(ROOT, '.gitignore');

    t.step('Verify .gitignore exists and covers sensitive patterns');

    if (!fs.existsSync(gitignorePath)) {
      await t.flush();
      throw new Error(
        '\nNo se encontro .gitignore en la raiz del proyecto.\n' +
        '═'.repeat(70) + '\n' +
        '  Fix: Cree un .gitignore que incluya al menos:\n' +
        '       .env, .env.*, /keys/, *.pem, *.key, *.log, *.sql, dist/\n' +
        '═'.repeat(70) + '\n',
      );
    }

    const gitignore = fs.readFileSync(gitignorePath, 'utf-8');
    const requiredPatterns = [
      { pattern: /\.env/, label: '.env — variables de entorno con secrets' },
      { pattern: /keys|\.pem|\.key/, label: 'keys/PEM — llaves criptograficas' },
      { pattern: /dist|build/, label: 'dist/build — output de compilacion' },
      { pattern: /node_modules/, label: 'node_modules — dependencias' },
    ];

    const missing: string[] = [];
    for (const req of requiredPatterns) {
      if (!req.pattern.test(gitignore)) {
        missing.push(req.label);
      }
    }

    t.evidence('.gitignore coverage', {
      patterns: requiredPatterns.map(p => ({
        label: p.label,
        covered: p.pattern.test(gitignore),
      })),
      missingCount: missing.length,
    });

    if (missing.length > 0) {
      await t.flush();
      throw new Error(
        `\n.gitignore no cubre ${missing.length} patron(es) sensible(s):\n` +
        '═'.repeat(70) + '\n' +
        missing.map((m, i) => `  #${i + 1}  ${m}`).join('\n') + '\n\n' +
        '  Fix: Agregue estos patrones a .gitignore para proteger archivos sensibles.\n' +
        '═'.repeat(70) + '\n',
      );
    }
    await t.flush();
  });
});
```

## Adapting for Vue / frontend projects

For Vue projects, adjust:
- `ROOT` → verify it points to your project root
- Add additional patterns for frontend-specific leaks:
  - API keys exposed in `.vue` components or `main.ts`
  - Firebase config objects with `apiKey`
  - Hardcoded `Authorization` headers in API clients
  - `.env.local` with unmasked secrets
- The `walkDir` helper already checks all nested public directories
- Consider also checking `vite.config.ts` or `webpack.config.js` for `sourceMap` settings

## Why separate tests per pattern type

Each test covers a specific attack vector, so the report shows exactly
**what kind** of information disclosure happened:
- robots.txt leaks ↔ reconnaissance
- public sensitive files ↔ direct access to secrets
- source maps ↔ reverse engineering
- debug artifacts ↔ local development leaking to repo

This separation makes it easier to prioritize fixes and communicate risk to the team.
