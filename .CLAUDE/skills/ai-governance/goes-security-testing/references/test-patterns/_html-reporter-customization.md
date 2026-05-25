# HTML Reporter Customization — Professional Setup

The bundled `SecurityHtmlReporter` (in `reporter/html-reporter.js`) is a
self-contained Jest reporter: it requires no Allure CLI, no Java, no external
service. This guide covers the customizations that turn the report into
something you can hand to an auditor.

> **Skill v1.1 note:** the reporter previously hard-coded the project name
> to `'Portafolio IT Backend'` and assumed a single tempdir on disk. Both
> issues are fixed in v1.1: the project name is parametrizable and a
> per-process subdirectory keeps parallel runs from mixing their metadata.

---

## 1. Project name and report title

The reporter reads the project name in this order of precedence:

1. `options.projectName` passed in the Jest config.
2. The `name` field of `package.json` discovered at `globalConfig.rootDir`.
3. Fallback string `Security Report`.

```typescript
// test/security/jest-security-html.config.ts
import type { Config } from 'jest';
import * as path from 'path';

const reporterPath = path.resolve(
  __dirname,
  '../../.claude/skills/goes-security-testing/reporter',
);

const config: Config = {
  // ...
  reporters: [
    'default',
    [
      path.join(reporterPath, 'html-reporter.js'),
      {
        outputPath: './reports/security/security-report.html',
        projectName: 'GOES — Sistema de Trámites',
        reportTitle: 'Reporte de Seguridad — Backend NestJS',
      },
    ],
  ],
};

export default config;
```

The browser tab title becomes `<reportTitle> — <projectName>`, and the same
two values appear in the report header.

---

## 2. Concurrency / Run ID

When Jest runs in parallel (`--maxWorkers > 1`) or two CI jobs share a runner,
each process must scope its metadata files to a unique subdirectory or the
reporter will merge unrelated runs. The shim and the reporter cooperate via
two environment variables:

| Variable | Effect |
|----------|--------|
| `SECURITY_REPORTER_TEMP_DIR` | Full override. Pointer to an absolute path. Use this in CI when you want the metadata under your job's workspace (`$GITHUB_WORKSPACE/_meta`). |
| `SECURITY_REPORTER_RUN_ID` | Subdir under `$TMPDIR/security-html-reporter/<runId>`. Cheap default for parallel local runs. |

Neither is required for typical local use — without them the reporter falls
back to `$TMPDIR/security-html-reporter` and works as before.

```bash
# Example — give every CI job its own metadata sandbox.
SECURITY_REPORTER_RUN_ID="ci-${GITHUB_RUN_ID}-${GITHUB_JOB}" \
  npm run test:security:html
```

---

## 3. OWASP and GOES tag styling

Tags whose label starts with `OWASP` or `GOES` are auto-classified into
distinct CSS badge classes (`badge-owasp`, `badge-goes`). To extend the
palette, edit the small block in `html-reporter.js` that maps the prefix
(search for `badgeClass = 'badge-owasp'`). For example, to add a green
badge for ISO references:

```js
} else if (tag.startsWith('ISO')) {
  badgeClass = 'badge-iso';
}
```

…then add the matching CSS rule in the embedded `<style>` block:

```css
.badge-iso { background: #10b981; color: #052e16; }
```

---

## 4. Adding the run metadata to the dashboard

The reporter already emits `meta.reporterVersion`, `meta.nodeVersion`,
`meta.generatedAt`, and `meta.duration`. To display them in the header,
add a small `<div class="env-grid">` below `header-title` and render the
fields from the `DATA.meta` global on the client side. A minimal patch:

```js
// Inside the embedded <script> tag, near the bottom of init():
const env = document.createElement('div');
env.style.cssText = 'font-size:11px;color:#a0a0a0;margin-top:8px;';
env.textContent =
  `Reporter ${DATA.meta.reporterVersion} · Node ${DATA.meta.nodeVersion} ` +
  `· ${new Date(DATA.meta.generatedAt).toLocaleString()}`;
document.querySelector('.header').appendChild(env);
```

---

## 5. Branding (colors, logo)

Every theme color lives in the embedded `<style>` block at the top of
`html-reporter.js`. The most useful overrides:

| CSS selector | Default | Purpose |
|--------------|---------|---------|
| `body { background }` | `#1a1a2e` | App background (dark theme base) |
| `.sidebar { background }` | `#16213e` | Sidebar background |
| `.btn-primary { background }` | `#3b82f6` | "Export PDF" button |
| `.badge-blocker / .badge-critical` | `#ef4444` | Severity badges (high) |
| `.badge-normal / .badge-medium` | `#eab308` | Severity badges (mid) |

To inject a logo, replace the `<div class="header-title">…</div>` line in
the body template with:

```html
<div class="header-title" style="display:flex;align-items:center;gap:12px;">
  <img src="data:image/png;base64,..." alt="logo" style="height:32px;" />
  <span>${escapedTitle}</span>
</div>
```

Use a base64 data URI so the report stays a single self-contained HTML
file with zero external dependencies.

---

## 6. Continuous integration snippets

### GitHub Actions

```yaml
- name: Run security tests with HTML reporter
  env:
    SECURITY_REPORTER_RUN_ID: ${{ github.run_id }}-${{ github.job }}
  run: npm run test:security:html

- name: Upload security report
  if: always()
  uses: actions/upload-artifact@v4
  with:
    name: security-report-${{ github.run_id }}
    path: reports/security/security-report.html
    retention-days: 30
```

### GitLab CI

```yaml
security_tests:
  stage: test
  variables:
    SECURITY_REPORTER_RUN_ID: "${CI_PIPELINE_ID}-${CI_JOB_ID}"
  script:
    - npm ci
    - npm run test:security:html
  artifacts:
    when: always
    paths:
      - reports/security/security-report.html
    expire_in: 30 days
```

---

## 7. Troubleshooting

| Symptom | Likely cause |
|---------|-------------|
| Report shows `0 tests` | `await allure.flush()` (or `await t.flush()`) missing in the test body. Without flush the metadata is never written. |
| Severity / OWASP charts empty | Tags missing the `OWASP Axx` or `GOES Checklist Rxx` prefix. The chart classifies by prefix, so wording matters. |
| Two parallel CI jobs see each other's tests | Set `SECURITY_REPORTER_RUN_ID` per job. |
| `NaN` paths in the SVG | Means zero tests ran. v1.1 renders an explicit "No tests" placeholder instead — upgrade the reporter file. |
| Project name shows `Security Report` instead of yours | `projectName` not passed in Jest config and `package.json` not found. Pass `projectName` explicitly. |
