

const fs = require('fs');
const path = require('path');
const os = require('os');

// ─── Reporter version (bump on breaking metadata format changes) ────────────
const REPORTER_VERSION = '1.1.0';

// ─── Per-process run id ─────────────────────────────────────────────────────
// metadata.ts and html-reporter.js share this convention so multiple Jest
// workers (or simultaneous CI jobs) never mix metadata files.
function resolveTempDir() {
  if (process.env.SECURITY_REPORTER_TEMP_DIR) {
    return process.env.SECURITY_REPORTER_TEMP_DIR;
  }
  const runId = process.env.SECURITY_REPORTER_RUN_ID;
  if (runId) {
    return path.join(os.tmpdir(), 'security-html-reporter', runId);
  }
  return path.join(os.tmpdir(), 'security-html-reporter');
}

function tryReadProjectName(rootDir) {
  try {
    const pkgPath = path.resolve(rootDir || process.cwd(), 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      if (pkg && typeof pkg.name === 'string' && pkg.name.trim()) {
        return pkg.name;
      }
    }
  } catch (_) {
    // ignore — fall back to default
  }
  return null;
}

class SecurityHtmlReporter {

  constructor(globalConfig, options) {
    this.globalConfig = globalConfig;
    this.options = {
      outputPath: options?.outputPath || './reports/security/security-report.html',
      projectName: options?.projectName,
      reportTitle: options?.reportTitle || 'Reporte de Tests de Seguridad',
    };
  }

  async onRunComplete(
    testContexts,
    results,
  ) {
    const tempDir = resolveTempDir();

    // Read metadata files
    const metadataMap = new Map();
    if (fs.existsSync(tempDir)) {
      const files = fs.readdirSync(tempDir);
      for (const file of files) {
        if (file.startsWith('meta-') && file.endsWith('.json')) {
          try {
            const content = fs.readFileSync(path.join(tempDir, file), 'utf-8');
            const metadata = JSON.parse(content);
            const key = `${metadata.testPath}::${metadata.testName}`;
            metadataMap.set(key, metadata);
          } catch (e) {
            // Skip invalid metadata files
          }
        }
      }
    }

    // Merge test results with metadata
    const mergedRootDir = this.globalConfig?.rootDir || process.cwd();
    const mergedTests = [];
    for (const testResult of results.testResults) {
      for (const assertion of testResult.testResults) {
        const key = `${testResult.testFilePath}::${assertion.fullName}`;
        const metadata = metadataMap.get(key);

        // Not Applicable override: tests that call t.notApplicable(reason)
        // are reported as "skipped" regardless of whether their assertions
        // passed, so they show up distinct from real passes/fails.
        const naReason = metadata?.naReason;
        const effectiveStatus = naReason ? 'skipped' : assertion.status;

        // Relative path for the Reproducibility block (avoids leaking $HOME).
        const relativePath = testResult.testFilePath
          ? path.relative(mergedRootDir, testResult.testFilePath)
          : '';

        const merged = {
          id: this.generateId(),
          name: assertion.title,
          fullName: assertion.fullName,
          status: effectiveStatus,
          duration: assertion.duration || 0,
          relativePath: relativePath,
          errors: assertion.failureMessages || [],
          epic: metadata?.epic,
          feature: metadata?.feature,
          story: metadata?.story,
          severity: metadata?.severity,
          owner: metadata?.owner,
          tags: metadata?.tags || [],
          labels: metadata?.labels || {},
          links: metadata?.links || [],
          description: metadata?.description,
          parameters: metadata?.parameters || [],
          steps: metadata?.steps || [],
          evidences: metadata?.evidences || [],
          naReason: naReason,
        };

        mergedTests.push(merged);
      }
    }

    // Build summary — recount from merged tests so naReason overrides are
    // reflected (a test marked Not Applicable shifts from passed to skipped).
    let passedCount = 0;
    let failedCount = 0;
    let skippedCount = 0;
    let naCount = 0;
    for (const t of mergedTests) {
      if (t.status === 'passed') passedCount++;
      else if (t.status === 'failed') failedCount++;
      else if (t.status === 'skipped') skippedCount++;
      if (t.naReason) naCount++;
    }
    const summary = {
      total: mergedTests.length,
      passed: passedCount,
      failed: failedCount,
      skipped: skippedCount,
      notApplicable: naCount,
      suites: results.testResults.length,
    };

    const rootDir = this.globalConfig?.rootDir || process.cwd();
    const projectName =
      this.options.projectName ||
      tryReadProjectName(rootDir) ||
      'Security Report';

    const reportData = {
      meta: {
        generatedAt: new Date().toISOString(),
        duration: results.testResults.reduce((acc, r) => acc + (r.perfStats?.end - r.perfStats?.start || 0), 0),
        project: projectName,
        title: this.options.reportTitle,
        reporterVersion: REPORTER_VERSION,
        nodeVersion: process.version,
      },
      summary,
      tests: mergedTests,
    };

    // Generate HTML
    const html = this.generateHtml(reportData);

    // Write file
    const outputDir = path.dirname(this.options.outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    fs.writeFileSync(this.options.outputPath, html, 'utf-8');

    // Log success
    const absPath = path.resolve(this.options.outputPath);
    console.log(
      `\n📊 Security Report generated: ${absPath}`,
    );
    console.log(
      `   ${summary.total} tests | ${summary.passed} aprobados | ${summary.failed} fallidos | ${reportData.meta.duration}ms`,
    );

    if (summary.failed > 0) {
      console.log(`\n   Tests fallidos:`);
      for (const t of mergedTests) {
        if (t.status === 'failed') {
          const loc = t.relativePath ? ` (${t.relativePath})` : '';
          const firstLine = (t.errors[0] || '')
            .replace(/\x1b\[[0-9;]*m/g, '').replace(/\[[0-9;]*m/g, '')
            .split('\n')[0].trim();
          console.log(`   - ${t.fullName}${loc}`);
          if (firstLine) console.log(`     ${firstLine}`);
        }
      }
    }

    // Cleanup temp files
    if (fs.existsSync(tempDir)) {
      try {
        const files = fs.readdirSync(tempDir);
        for (const file of files) {
          if (file.startsWith('meta-') && file.endsWith('.json')) {
            fs.unlinkSync(path.join(tempDir, file));
          }
        }
      } catch (e) {
        // Cleanup errors are non-critical
      }
    }
  }

  generateId() {
    return Math.random().toString(36).substring(2, 11);
  }

  generateHtml(reportData) {
    const dataJson = JSON.stringify(reportData).replace(/</g, '\\x3c').replace(/>/g, '\\x3e');
    const escapedTitle = String(reportData.meta.title || 'Security Test Report')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    const escapedProject = String(reportData.meta.project || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    let generatedAtStr = '';
    try {
      generatedAtStr = new Date(reportData.meta.generatedAt).toLocaleString('es-SV', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    } catch (_) {
      generatedAtStr = String(reportData.meta.generatedAt || '');
    }
    const escapedGeneratedAt = generatedAtStr
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    const escapedReporterVersion = String(reportData.meta.reporterVersion || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapedTitle} — ${escapedProject}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen',
        'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue',
        sans-serif;
      background: #1a1a2e;
      color: #e8e8e8;
    }

    .container {
      display: flex;
      min-height: 100vh;
      align-items: stretch;
    }

    .sidebar {
      width: 280px;
      background: #16213e;
      border-right: 1px solid #2a3a4a;
      display: flex;
      flex-direction: column;
      position: sticky;
      top: 0;
      align-self: flex-start;
      height: 100vh;
      flex-shrink: 0;
    }

    .sidebar-header {
      padding: 16px;
      border-bottom: 1px solid #2a3a4a;
    }

    .search-box {
      width: 100%;
      padding: 8px 12px;
      background: #1a1a2e;
      border: 1px solid #2a3a4a;
      border-radius: 4px;
      color: #e8e8e8;
      font-size: 14px;
      transition: border-color 0.2s;
    }

    .search-box:focus {
      outline: none;
      border-color: #3b82f6;
    }

    .sidebar-content {
      flex: 1;
      overflow-y: auto;
      padding: 12px;
    }

    .sidebar-item {
      padding: 8px 12px;
      cursor: pointer;
      border-radius: 4px;
      margin-bottom: 4px;
      font-size: 13px;
      transition: background-color 0.2s;
      user-select: none;
    }

    .sidebar-item:hover {
      background: #1e2a3a;
    }

    .sidebar-item.active {
      background: #0f3460;
      color: #3b82f6;
    }

    .sidebar-item-header {
      display: flex;
      align-items: center;
      gap: 6px;
      font-weight: 500;
    }

    .sidebar-toggle {
      cursor: pointer;
      user-select: none;
      width: 16px;
      text-align: center;
    }

    .sidebar-item-children {
      margin-left: 12px;
      margin-top: 4px;
    }

    .sidebar-item-children.hidden {
      display: none;
    }

    .sidebar-count {
      font-size: 11px;
      color: #a0a0a0;
      margin-left: auto;
      padding-left: 8px;
    }

    .sidebar-indicator {
      display: none;
    }

    .indicator-pass {
      background: #22c55e;
    }

    .indicator-fail {
      background: #ef4444;
    }

    .indicator-mixed {
      background: #eab308;
    }

    .main {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-width: 0;
    }

    .header {
      padding: 24px;
      border-bottom: 1px solid #2a3a4a;
      background: #1a1a2e;
    }

    .header-title {
      font-size: 28px;
      font-weight: 600;
      margin-bottom: 8px;
    }

    .header-project {
      font-size: 13px;
      color: #a0a0a0;
      margin-bottom: 4px;
    }

    .header-meta {
      font-size: 12px;
      color: #7a8595;
      margin-bottom: 16px;
      font-variant-numeric: tabular-nums;
    }

    .header-actions {
      display: flex;
      gap: 12px;
    }

    .btn {
      padding: 8px 16px;
      border: none;
      border-radius: 4px;
      font-size: 13px;
      cursor: pointer;
      transition: background-color 0.2s;
      font-weight: 500;
    }

    .btn-primary {
      background: #3b82f6;
      color: #fff;
    }

    .btn-primary:hover {
      background: #2563eb;
    }

    .charts-row {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 24px;
      padding: 24px;
      border-bottom: 1px solid #2a3a4a;
      background: #1a1a2e;
    }

    .chart-card {
      background: #1e2a3a;
      border: 1px solid #2a3a4a;
      border-radius: 6px;
      padding: 24px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: flex-start;
      min-height: 380px;
    }

    .chart-title {
      font-size: 13px;
      font-weight: 600;
      color: #a0a0a0;
      margin-bottom: 20px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .chart-svg {
      width: 100%;
      height: auto;
      max-height: 320px;
    }

    .chart-svg .chart-segment {
      cursor: pointer;
      transition: opacity 0.2s ease, transform 0.2s ease;
      transform-origin: center;
    }

    .chart-svg .chart-segment:hover {
      opacity: 0.82;
    }

    .chart-svg .chart-segment.chart-segment-active {
      opacity: 1;
      filter: drop-shadow(0 0 6px rgba(59, 130, 246, 0.6));
    }

    .chart-svg .chart-segment.chart-segment-dim {
      opacity: 0.35;
    }

    .chart-legend-item {
      cursor: pointer;
      transition: opacity 0.2s ease;
    }

    .chart-legend-item:hover {
      opacity: 0.75;
    }

    .filter-pill {
      display: none;
      align-items: center;
      gap: 8px;
      padding: 6px 12px;
      background: #0f3460;
      border: 1px solid #3b82f6;
      border-radius: 999px;
      font-size: 12px;
      color: #cbd5f5;
      margin-left: 12px;
    }

    .filter-pill.visible {
      display: inline-flex;
    }

    .filter-pill-clear {
      background: none;
      border: none;
      color: #cbd5f5;
      cursor: pointer;
      padding: 0;
      font-size: 14px;
      line-height: 1;
    }

    .filter-pill-clear:hover {
      color: #fff;
    }

    @keyframes fadeInUp {
      from { opacity: 0; transform: translateY(4px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .test-row {
      animation: fadeInUp 0.18s ease-out both;
    }

    .stats-row {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: 12px;
      padding: 0 24px 24px 24px;
    }

    .stat-card {
      background: #1e2a3a;
      border: 1px solid #2a3a4a;
      border-radius: 6px;
      padding: 12px;
      text-align: center;
    }

    .stat-label {
      font-size: 11px;
      color: #a0a0a0;
      text-transform: uppercase;
      margin-bottom: 6px;
    }

    .stat-value {
      font-size: 20px;
      font-weight: 600;
      color: #e8e8e8;
    }

    .tests-section {
      display: flex;
      flex-direction: column;
      padding: 24px;
    }

    .tests-section-header {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 12px;
      flex-wrap: wrap;
    }

    .tests-header {
      font-size: 14px;
      font-weight: 600;
      color: #a0a0a0;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin: 0;
    }

    .tests-search {
      flex: 1;
      min-width: 200px;
      max-width: 360px;
      padding: 6px 12px 6px 30px;
      background: #1a1a2e;
      border: 1px solid #2a3a4a;
      border-radius: 4px;
      color: #e8e8e8;
      font-size: 13px;
      transition: border-color 0.2s;
      background-image: url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%237a8595' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3ccircle cx='11' cy='11' r='8'/%3e%3cline x1='21' y1='21' x2='16.65' y2='16.65'/%3e%3c/svg%3e");
      background-repeat: no-repeat;
      background-position: 9px center;
    }

    .tests-search:focus {
      outline: none;
      border-color: #3b82f6;
    }

    .tests-table {
      border: 1px solid #2a3a4a;
      border-radius: 6px;
      background: #1e2a3a;
    }

    .test-row {
      display: grid;
      grid-template-columns: 1fr 120px 200px 80px 80px;
      gap: 12px;
      padding: 12px;
      border-bottom: 1px solid #2a3a4a;
      align-items: center;
      cursor: pointer;
      transition: background-color 0.2s;
    }

    .test-row:hover {
      background: #242f3f;
    }

    .test-row:last-child {
      border-bottom: none;
    }

    .test-name {
      font-size: 13px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .test-severity {
      display: flex;
      gap: 6px;
      align-items: center;
    }

    .badge {
      display: inline-block;
      padding: 3px 8px;
      border-radius: 3px;
      font-size: 11px;
      font-weight: 600;
      white-space: nowrap;
    }

    .badge-severity {
      color: #fff;
    }

    .badge-blocker {
      background: #ef4444;
    }

    .badge-critical {
      background: #ef4444;
    }

    .badge-high {
      background: #f97316;
    }

    .badge-normal,
    .badge-medium {
      background: #eab308;
      color: #000;
    }

    .badge-minor {
      background: #eab308;
      color: #000;
    }

    .badge-trivial,
    .badge-low {
      background: #6b7280;
    }

    .badge-tag {
      color: #fff;
      padding: 4px 8px;
      font-size: 10px;
    }

    .badge-owasp {
      background: #3b82f6;
    }

    .badge-goes {
      background: #10b981;
    }

    .badge-other {
      background: #6b7280;
    }

    .badge-na {
      background: #475569;
      color: #e2e8f0;
      border: 1px solid #64748b;
      letter-spacing: 0.5px;
    }

    .na-callout {
      background: #1e293b;
      border: 1px solid #475569;
      border-left: 3px solid #f59e0b;
      border-radius: 4px;
      padding: 12px 14px;
      font-size: 13px;
      color: #fbbf24;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .na-callout-label {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.8px;
      font-weight: 700;
      color: #f59e0b;
    }

    .na-callout-reason {
      color: #e2e8f0;
      font-size: 13px;
      line-height: 1.5;
    }

    .reproducibility-block {
      background: #16213e;
      border: 1px solid #2a3a4a;
      border-radius: 4px;
      padding: 12px 14px;
      font-size: 12px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .repro-row {
      display: grid;
      grid-template-columns: 56px 1fr auto;
      gap: 10px;
      align-items: center;
    }

    .repro-label {
      color: #7a8595;
      text-transform: uppercase;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.6px;
    }

    .repro-value {
      font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
      font-size: 12px;
      color: #cbd5f5;
      background: #0d1117;
      padding: 6px 10px;
      border-radius: 3px;
      overflow-x: auto;
      word-break: break-all;
      border: 1px solid #1e2a3a;
    }

    .repro-cmd {
      color: #7ee787;
    }

    .repro-copy {
      background: #2a3a4a;
      border: 1px solid #475569;
      color: #cbd5f5;
      cursor: pointer;
      padding: 6px 10px;
      border-radius: 3px;
      font-size: 12px;
      transition: background 0.2s, border-color 0.2s;
      font-family: inherit;
      white-space: nowrap;
    }

    .repro-copy:hover {
      background: #475569;
      border-color: #64748b;
    }

    .repro-copy.copied {
      background: #16a34a;
      border-color: #22c55e;
      color: #fff;
    }

    .test-status {
      text-align: center;
      font-size: 18px;
    }

    .status-pass {
      color: #22c55e;
    }

    .status-fail {
      color: #ef4444;
    }

    .status-skip {
      color: #eab308;
    }

    .test-duration {
      text-align: right;
      font-size: 12px;
      color: #a0a0a0;
    }

    .modal-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.7);
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 1000;
    }

    .modal-overlay.active {
      display: flex;
    }

    .modal {
      background: #1e2a3a;
      border: 1px solid #2a3a4a;
      border-radius: 8px;
      max-width: 700px;
      max-height: 80vh;
      overflow-y: auto;
      width: 90%;
      position: relative;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
    }

    .modal-header {
      padding: 20px;
      border-bottom: 1px solid #2a3a4a;
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 12px;
    }

    .modal-title {
      font-size: 16px;
      font-weight: 600;
      flex: 1;
      line-height: 1.4;
      word-break: break-word;
    }

    .modal-close {
      background: none;
      border: none;
      color: #a0a0a0;
      font-size: 24px;
      cursor: pointer;
      padding: 0;
      width: 24px;
      height: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .modal-close:hover {
      color: #e8e8e8;
    }

    .modal-content {
      padding: 20px;
    }

    .modal-section {
      margin-bottom: 20px;
    }

    .modal-section:last-child {
      margin-bottom: 0;
    }

    .modal-section-title {
      font-size: 12px;
      font-weight: 600;
      color: #a0a0a0;
      text-transform: uppercase;
      margin-bottom: 12px;
      padding-bottom: 8px;
      border-bottom: 1px solid #2a3a4a;
      letter-spacing: 0.5px;
    }

    .classification-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      font-size: 13px;
    }

    .classification-item {
      background: #16213e;
      padding: 8px;
      border-radius: 4px;
      border: 1px solid #2a3a4a;
    }

    .classification-label {
      font-size: 10px;
      color: #a0a0a0;
      text-transform: uppercase;
      margin-bottom: 4px;
      font-weight: 600;
    }

    .classification-value {
      color: #e8e8e8;
      word-break: break-word;
    }

    .description-content {
      background: #16213e;
      padding: 12px;
      border-radius: 4px;
      border: 1px solid #2a3a4a;
      font-size: 13px;
      line-height: 1.6;
    }

    .description-content h2 {
      font-size: 13px;
      margin: 8px 0;
      margin-top: 0;
      color: #3b82f6;
    }

    .description-content h2:first-child {
      margin-top: 0;
    }

    .description-content p {
      margin: 8px 0;
    }

    .description-content p:first-child {
      margin-top: 0;
    }

    .steps-list {
      background: #16213e;
      padding: 12px;
      border-radius: 4px;
      border: 1px solid #2a3a4a;
      font-size: 13px;
    }

    .step-item {
      margin-bottom: 8px;
      display: flex;
      gap: 8px;
    }

    .step-item:last-child {
      margin-bottom: 0;
    }

    .step-number {
      font-weight: 600;
      color: #3b82f6;
      flex-shrink: 0;
    }

    .evidence-code {
      background: #0d1117;
      padding: 12px;
      border-radius: 4px;
      border: 1px solid #2a3a4a;
      font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
      font-size: 12px;
      overflow-x: auto;
      color: #7ee787;
      line-height: 1.5;
    }

    .links-list {
      background: #16213e;
      padding: 12px;
      border-radius: 4px;
      border: 1px solid #2a3a4a;
      font-size: 13px;
    }

    .link-item {
      margin-bottom: 8px;
    }

    .link-item:last-child {
      margin-bottom: 0;
    }

    .link-item a {
      color: #3b82f6;
      text-decoration: none;
      word-break: break-all;
    }

    .link-item a:hover {
      text-decoration: underline;
    }

    .modal-status {
      padding: 12px;
      background: #16213e;
      border-radius: 4px;
      border: 1px solid #2a3a4a;
      font-size: 13px;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }

    .status-item {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .error-list {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .error-item {
      background: #16213e;
      border-radius: 6px;
      border: 1px solid #2a3a4a;
      overflow: hidden;
    }

    .error-file-bar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      background: #1a1a2e;
      border-bottom: 1px solid #2a3a4a;
      font-size: 12px;
      font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
    }

    .error-file-icon {
      flex-shrink: 0;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #ef4444;
    }

    .error-file-path {
      color: #93c5fd;
      word-break: break-all;
    }

    .error-file-line {
      color: #fbbf24;
      flex-shrink: 0;
      margin-left: auto;
    }

    .error-body {
      padding: 12px;
    }

    .error-message {
      font-size: 12px;
      font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
      color: #fca5a5;
      line-height: 1.5;
      white-space: pre-wrap;
      word-break: break-word;
    }

    .error-expected-received {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      margin-top: 10px;
    }

    .error-expected, .error-received {
      padding: 8px 12px;
      border-radius: 4px;
      font-size: 12px;
      font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
      line-height: 1.5;
    }

    .error-expected {
      background: rgba(34, 197, 94, 0.08);
      border: 1px solid rgba(34, 197, 94, 0.2);
      color: #86efac;
    }

    .error-received {
      background: rgba(239, 68, 68, 0.08);
      border: 1px solid rgba(239, 68, 68, 0.2);
      color: #fca5a5;
    }

    .error-er-label {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 4px;
      opacity: 0.7;
    }

    .error-steps-context {
      margin-top: 10px;
      padding: 8px 12px;
      background: rgba(234, 179, 8, 0.05);
      border: 1px solid rgba(234, 179, 8, 0.15);
      border-radius: 4px;
    }

    .error-steps-title {
      font-size: 10px;
      font-weight: 600;
      color: #fbbf24;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 4px;
    }

    .error-steps-list {
      font-size: 12px;
      color: #fde68a;
      line-height: 1.6;
    }

    .error-raw-toggle {
      margin-top: 8px;
      padding: 3px 8px;
      background: transparent;
      border: 1px solid #2a3a4a;
      border-radius: 3px;
      color: #4b5563;
      font-size: 10px;
      cursor: pointer;
      transition: all 0.2s;
    }

    .error-raw-toggle:hover {
      background: #1a1a2e;
      color: #6b7280;
    }

    .error-raw-stack {
      display: none;
      margin-top: 6px;
      padding: 8px 10px;
      background: #0d1117;
      border-radius: 4px;
      font-size: 10px;
      font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
      color: #6b7280;
      line-height: 1.5;
      white-space: pre-wrap;
      word-break: break-word;
      max-height: 200px;
      overflow-y: auto;
    }

    .error-raw-stack.open {
      display: block;
    }

    .test-file-path {
      font-size: 11px;
      color: #6b7280;
      margin-top: 2px;
      font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
    }

    /* ── Source file context bar (modal) ────────────────────── */
    .modal-source-file {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 16px;
      background: #0f1729;
      border-bottom: 1px solid #2a3a4a;
      font-size: 12px;
      font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
    }

    .modal-source-file .source-icon {
      flex-shrink: 0;
      width: 14px;
      height: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #93c5fd;
    }

    .modal-source-file .source-path {
      color: #93c5fd;
      word-break: break-all;
    }

    .modal-source-file .source-label {
      color: #4b5563;
      flex-shrink: 0;
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    /* ── Error number badge ─────────────────────────────────── */
    .error-number {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 20px;
      height: 20px;
      border-radius: 50%;
      background: rgba(239, 68, 68, 0.2);
      color: #fca5a5;
      font-size: 11px;
      font-weight: 600;
      flex-shrink: 0;
    }

    .error-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      background: #1a1a2e;
      border-bottom: 1px solid #2a3a4a;
    }

    .error-header-info {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
      flex: 1;
    }

    .error-header-file {
      font-size: 12px;
      font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
      color: #93c5fd;
      word-break: break-all;
    }

    .error-header-line {
      font-size: 11px;
      color: #fbbf24;
      flex-shrink: 0;
    }

    .error-summary {
      font-size: 12px;
      color: #d1d5db;
      line-height: 1.4;
      padding: 10px 12px;
      background: rgba(239, 68, 68, 0.05);
      border-bottom: 1px solid #2a3a4a;
      word-break: break-word;
    }

    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: #a0a0a0;
      text-align: center;
      padding: 40px;
    }

    .empty-state-icon {
      font-size: 48px;
      margin-bottom: 16px;
      opacity: 0.5;
    }

    .empty-state-text {
      font-size: 14px;
    }

    @media print {
      body {
        background: #fff;
        color: #000;
        overflow: visible;
      }

      .container {
        display: block;
        height: auto;
        overflow: visible;
      }

      .sidebar,
      .header-actions,
      .modal-overlay,
      .filter-pill {
        display: none !important;
      }

      .main {
        width: 100%;
        overflow: visible;
      }

      .header,
      .charts-row,
      .stats-row,
      .tests-section {
        background: #fff !important;
        border-color: #d1d5db !important;
        page-break-inside: avoid;
      }

      .header-title,
      .header-project,
      .header-meta,
      .stat-value,
      .test-name,
      .test-duration {
        color: #000 !important;
      }

      .chart-card,
      .stat-card,
      .tests-table {
        background: #fff !important;
        border: 1px solid #d1d5db !important;
        color: #000 !important;
      }

      .chart-title,
      .stat-label,
      .tests-header {
        color: #555 !important;
      }

      .test-row {
        page-break-inside: avoid;
        border-bottom: 1px solid #d1d5db !important;
        color: #000 !important;
        animation: none;
      }

      .test-row:hover {
        background: transparent !important;
      }

      .badge,
      .badge-tag,
      .badge-severity,
      .chart-svg path,
      .chart-svg rect {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }

      .tests-table {
        overflow: visible;
      }
    }

    ::-webkit-scrollbar {
      width: 8px;
      height: 8px;
    }

    ::-webkit-scrollbar-track {
      background: #1a1a2e;
    }

    ::-webkit-scrollbar-thumb {
      background: #2a3a4a;
      border-radius: 4px;
    }

    ::-webkit-scrollbar-thumb:hover {
      background: #3a4a5a;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="sidebar">
      <div class="sidebar-header">
        <input
          type="text"
          class="search-box"
          id="searchBox"
          placeholder="Buscar tests..."
        />
      </div>
      <div class="sidebar-content" id="sidebarContent">
        <div class="sidebar-item active" data-filter="all">
          <div class="sidebar-item-header">
            <span>📊 Dashboard</span>
          </div>
        </div>
      </div>
    </div>

    <div class="main">
      <div class="header">
        <div class="header-title">${escapedTitle}</div>
        <div class="header-project">${escapedProject}</div>
        <div class="header-meta">Generado: ${escapedGeneratedAt} &middot; Reporter v${escapedReporterVersion}</div>
        <div class="header-actions">
          <button class="btn btn-primary" onclick="window.print()">
            📥 Exportar PDF
          </button>
        </div>
      </div>

      <div class="charts-row" id="chartsRow"></div>
      <div class="stats-row" id="statsRow"></div>

      <div class="tests-section">
        <div class="tests-section-header">
          <div class="tests-header">Resultados de Tests</div>
          <input
            type="text"
            class="tests-search"
            id="testsSearch"
            placeholder="Filtrar resultados..."
          />
          <span id="filterPill" class="filter-pill">
            <span id="filterPillLabel"></span>
            <button class="filter-pill-clear" onclick="clearChartFilter()" title="Limpiar filtro">✕</button>
          </span>
        </div>
        <div class="tests-table" id="testsTable"></div>
      </div>
    </div>
  </div>

  <div class="modal-overlay" id="modalOverlay">
    <div class="modal" id="modal"></div>
  </div>

  <script>
    const DATA = ${dataJson};

    let currentFilter = 'all';
    let filteredTests = DATA.tests;

    const SEVERITY_ES = {
      blocker: 'BLOQUEANTE',
      critical: 'CRÍTICO',
      high: 'ALTO',
      normal: 'NORMAL',
      medium: 'MEDIO',
      minor: 'MENOR',
      trivial: 'TRIVIAL',
      low: 'BAJO',
    };
    function sevLabel(sev) { return SEVERITY_ES[sev] || sev.toUpperCase(); }

    const STATUS_ES = {
      passed: 'APROBADO',
      failed: 'FALLIDO',
      skipped: 'N/A',
    };
    function statusLabel(st) { return STATUS_ES[st] || st.toUpperCase(); }

    function init() {
      buildSidebar();
      renderCharts();
      renderStats();
      renderTests();
      setupSidebarSearch();
      setupTestsSearch();
    }

    function buildSidebar() {
      const content = document.getElementById('sidebarContent');
      const tree = buildTree();

      for (const [key, node] of Object.entries(tree)) {
        const item = createSidebarNode(key, node);
        content.appendChild(item);
      }
    }

    function buildTree() {
      const tree = {};

      for (const test of DATA.tests) {
        const epic = test.epic || 'Uncategorized';
        const feature = test.feature || 'Ungrouped';
        const story = test.story || 'No story';

        if (!tree[epic]) {
          tree[epic] = { children: {}, tests: [] };
        }

        if (!tree[epic].children[feature]) {
          tree[epic].children[feature] = { children: {}, tests: [] };
        }

        if (!tree[epic].children[feature].children[story]) {
          tree[epic].children[feature].children[story] = { tests: [] };
        }

        tree[epic].children[feature].children[story].tests.push(test);
        tree[epic].tests.push(test);
        tree[epic].children[feature].tests.push(test);
      }

      return tree;
    }

    function createSidebarNode(key, node, depth = 0) {
      const container = document.createElement('div');
      const item = document.createElement('div');
      item.className = 'sidebar-item';

      const hasChildren = Object.keys(node.children || {}).length > 0;
      const passCount = node.tests.filter((t) => t.status === 'passed').length;
      const failCount = node.tests.filter((t) => t.status === 'failed').length;
      const indicator = failCount > 0 ? 'fail' : 'pass';

      const html = \`
        <div class="sidebar-item-header">
          \${
            hasChildren
              ? \`<span class="sidebar-toggle" onclick="toggleChildren(event)">▼</span>\`
              : '<span style="width: 16px;"></span>'
          }
          <span>\${escapeHtml(key)}</span>
          <span class="sidebar-count">\${node.tests.length}</span>
          <div class="sidebar-indicator indicator-\${indicator}"></div>
        </div>
      \`;

      item.innerHTML = html;
      item.onclick = (e) => {
        if (
          e.target.closest('.sidebar-toggle') ||
          e.target.closest('.sidebar-indicator')
        ) {
          return;
        }
        filterByNode(item, node.tests);
      };

      container.appendChild(item);

      if (hasChildren) {
        const childrenContainer = document.createElement('div');
        childrenContainer.className = 'sidebar-item-children hidden';

        for (const [childKey, childNode] of Object.entries(node.children || {})) {
          childrenContainer.appendChild(createSidebarNode(childKey, childNode, depth + 1));
        }

        container.appendChild(childrenContainer);

        const toggle = item.querySelector('.sidebar-toggle');
        if (toggle) toggle.textContent = '▶';
      }

      return container;
    }

    function toggleChildren(e) {
      e.stopPropagation();
      const target = e.target.closest('.sidebar-toggle');
      const container = target.closest('.sidebar-item').parentElement;
      const children = container.querySelector('.sidebar-item-children');

      if (children) {
        children.classList.toggle('hidden');
        target.textContent = children.classList.contains('hidden') ? '▶' : '▼';
      }
    }

    function filterByNode(item, tests) {
      document.querySelectorAll('.sidebar-item.active').forEach((el) => {
        el.classList.remove('active');
      });

      item.classList.add('active');
      filteredTests = tests;

      document.querySelectorAll('.chart-segment').forEach((seg) => {
        seg.classList.remove('chart-segment-active', 'chart-segment-dim');
      });
      const pill = document.getElementById('filterPill');
      if (pill) pill.classList.remove('visible');

      const testsSearch = document.getElementById('testsSearch');
      if (testsSearch) testsSearch.value = '';

      renderTests();
    }

    function setupSidebarSearch() {
      const searchBox = document.getElementById('searchBox');
      const sidebarContent = document.getElementById('sidebarContent');

      searchBox.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase().trim();

        Array.from(sidebarContent.children).forEach((node) => {
          if (
            node.classList &&
            node.classList.contains('sidebar-item') &&
            node.dataset.filter === 'all'
          ) {
            return;
          }

          if (!query) {
            node.style.display = '';
            return;
          }

          const text = (node.textContent || '').toLowerCase();
          node.style.display = text.includes(query) ? '' : 'none';
        });
      });
    }

    function setupTestsSearch() {
      const searchBox = document.getElementById('testsSearch');
      if (!searchBox) return;

      searchBox.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase().trim();

        document.querySelectorAll('.chart-segment').forEach((seg) => {
          seg.classList.remove('chart-segment-active', 'chart-segment-dim');
        });
        const pill = document.getElementById('filterPill');
        if (pill) pill.classList.remove('visible');

        if (!query) {
          filteredTests = DATA.tests;
        } else {
          filteredTests = DATA.tests.filter((test) => {
            const name = (test.name || '').toLowerCase();
            const fullName = (test.fullName || '').toLowerCase();
            const tags = (test.tags || []).map((t) => t.toLowerCase()).join(' ');
            const epic = (test.epic || '').toLowerCase();
            const feature = (test.feature || '').toLowerCase();
            const story = (test.story || '').toLowerCase();

            return (
              name.includes(query) ||
              fullName.includes(query) ||
              tags.includes(query) ||
              epic.includes(query) ||
              feature.includes(query) ||
              story.includes(query)
            );
          });
        }

        renderTests();
      });
    }

    function renderCharts() {
      const chartsRow = document.getElementById('chartsRow');

      const statusChart = createStatusChart();
      const severityChart = createSeverityChart();

      const statusCard = document.createElement('div');
      statusCard.className = 'chart-card';
      statusCard.innerHTML = \`
        <div class="chart-title">Estado de Tests</div>
        \${statusChart}
      \`;

      const severityCard = document.createElement('div');
      severityCard.className = 'chart-card';
      severityCard.innerHTML = \`
        <div class="chart-title">Distribución por Severidad</div>
        \${severityChart}
      \`;

      chartsRow.appendChild(statusCard);
      chartsRow.appendChild(severityCard);

      attachChartHandlers();
    }

    function attachChartHandlers() {
      document.querySelectorAll('.chart-segment, .chart-legend-item').forEach((el) => {
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          const type = el.dataset.filterType;
          const value = el.dataset.filterValue;
          if (type && value) {
            applyChartFilter(type, value);
          }
        });
      });
    }

    function applyChartFilter(type, value) {
      let predicate;
      let label;

      if (type === 'status') {
        predicate = (t) => t.status === value;
        label = 'Estado: ' + value;
      } else if (type === 'severity') {
        predicate = (t) => t.severity === value && !t.naReason && t.status !== 'skipped';
        label = 'Severidad: ' + value;
      } else if (type === 'owasp') {
        predicate = (t) => (t.tags || []).includes(value);
        label = value;
      } else {
        return;
      }

      filteredTests = DATA.tests.filter(predicate);

      document.querySelectorAll('.chart-segment').forEach((seg) => {
        seg.classList.remove('chart-segment-active', 'chart-segment-dim');
        if (seg.dataset.filterType === type && seg.dataset.filterValue === value) {
          seg.classList.add('chart-segment-active');
        } else {
          seg.classList.add('chart-segment-dim');
        }
      });

      const pill = document.getElementById('filterPill');
      const pillLabel = document.getElementById('filterPillLabel');
      if (pill && pillLabel) {
        pillLabel.textContent = label;
        pill.classList.add('visible');
      }

      document.querySelectorAll('.sidebar-item.active').forEach((el) => {
        el.classList.remove('active');
      });

      const testsSearch = document.getElementById('testsSearch');
      if (testsSearch) testsSearch.value = '';

      renderTests();
    }

    function clearChartFilter() {
      filteredTests = DATA.tests;

      document.querySelectorAll('.chart-segment').forEach((seg) => {
        seg.classList.remove('chart-segment-active', 'chart-segment-dim');
      });

      const pill = document.getElementById('filterPill');
      if (pill) {
        pill.classList.remove('visible');
      }

      const dashboard = document.querySelector('.sidebar-item[data-filter="all"]');
      if (dashboard) {
        dashboard.classList.add('active');
      }

      const searchBox = document.getElementById('searchBox');
      if (searchBox) {
        searchBox.value = '';
        searchBox.dispatchEvent(new Event('input'));
      }

      const testsSearch = document.getElementById('testsSearch');
      if (testsSearch) testsSearch.value = '';

      renderTests();
    }

    function createStatusChart() {
      const total = DATA.summary.total;
      const passed = DATA.summary.passed;
      const failed = DATA.summary.failed;
      const skipped = DATA.summary.skipped;

      // Guard: empty run (zero tests) — render an empty placeholder instead
      // of dividing by zero (which would produce NaN paths and a broken SVG).
      if (!total || total <= 0) {
        return \`
          <svg class="chart-svg" viewBox="0 0 120 120" width="120" height="120">
            <circle cx="60" cy="60" r="50" fill="none" stroke="#2a3a4a" stroke-width="2" stroke-dasharray="4 4" />
            <text x="60" y="64" text-anchor="middle" fill="#a0a0a0" font-size="11">No tests</text>
          </svg>
          <div style="font-size: 12px; margin-top: 8px; text-align: center; color: #a0a0a0;">
            No tests were executed
          </div>
        \`;
      }

      const passPercent = (passed / total) * 100;
      const failPercent = (failed / total) * 100;
      const skipPercent = (skipped / total) * 100;

      const size = 120;
      const radius = size / 2 - 10;

      const passAngle = (passPercent / 100) * 360;
      const failAngle = (failPercent / 100) * 360;
      const skipAngle = (skipPercent / 100) * 360;

      const passPath = getArcPath(size / 2, size / 2, radius, 0, passAngle);
      const failPath = getArcPath(
        size / 2,
        size / 2,
        radius,
        passAngle,
        passAngle + failAngle,
      );
      const skipPath = getArcPath(
        size / 2,
        size / 2,
        radius,
        passAngle + failAngle,
        360,
      );

      return \`
        <svg class="chart-svg" viewBox="0 0 \${size} \${size}" width="\${size}" height="\${size}">
          <path class="chart-segment" data-filter-type="status" data-filter-value="passed" d="\${passPath}" fill="#22c55e" stroke="none"><title>Aprobados: \${passed} (\${passPercent.toFixed(1)}%)</title></path>
          \${failPercent > 0 ? \`<path class="chart-segment" data-filter-type="status" data-filter-value="failed" d="\${failPath}" fill="#ef4444" stroke="none"><title>Fallidos: \${failed} (\${failPercent.toFixed(1)}%)</title></path>\` : ''}
          \${skipPercent > 0 ? \`<path class="chart-segment" data-filter-type="status" data-filter-value="skipped" d="\${skipPath}" fill="#94a3b8" stroke="none"><title>No Aplicables: \${skipped} (\${skipPercent.toFixed(1)}%)</title></path>\` : ''}
          <circle cx="\${size / 2}" cy="\${size / 2}" r="\${radius * 0.55}" fill="#1e2a3a" pointer-events="none" />
          <text x="\${size / 2}" y="\${size / 2}" text-anchor="middle" dy="0.3em" fill="#e8e8e8" font-size="16" font-weight="bold" pointer-events="none">\${passed}</text>
          <text x="\${size / 2}" y="\${size / 2 + 14}" text-anchor="middle" dy="0.3em" fill="#a0a0a0" font-size="10" pointer-events="none">passed</text>
        </svg>
        <div style="font-size: 12px; margin-top: 8px; text-align: center;">
          <div class="chart-legend-item" data-filter-type="status" data-filter-value="passed" style="color: #22c55e;">✓ \${passed} passed</div>
          <div class="chart-legend-item" data-filter-type="status" data-filter-value="failed" style="color: #ef4444;">✗ \${failed} failed</div>
          <div class="chart-legend-item" data-filter-type="status" data-filter-value="skipped" style="color: #94a3b8;">⊘ \${skipped} skipped</div>
        </div>
      \`;
    }

    function createSeverityChart() {
      const severities = ['blocker', 'critical', 'high', 'normal', 'medium', 'minor', 'trivial', 'low'];
      const counts = {};

      for (const severity of severities) {
        counts[severity] = DATA.tests.filter(
          (t) => t.severity === severity && !t.naReason && t.status !== 'skipped',
        ).length;
      }

      const naCount = DATA.tests.filter(
        (t) => t.naReason || t.status === 'skipped',
      ).length;

      const colorMap = {
        blocker: '#ef4444',
        critical: '#ef4444',
        high: '#f97316',
        normal: '#eab308',
        medium: '#eab308',
        minor: '#eab308',
        trivial: '#6b7280',
        low: '#6b7280',
        na: '#94a3b8',
      };

      const labelMap = {
        blocker: 'Bloqueante',
        critical: 'Crítico',
        high: 'Alto',
        normal: 'Normal',
        medium: 'Medio',
        minor: 'Menor',
        trivial: 'Trivial',
        low: 'Bajo',
        na: 'N/A',
      };

      const bars = severities
        .filter((s) => counts[s] > 0)
        .map((s) => ({ key: s, filterType: 'severity', count: counts[s] }));

      const maxCount = Math.max(...bars.map((b) => b.count), 1);
      const chartHeight = 100;
      const barWidth = 48;
      const gap = 14;
      const labelOffset = 24;
      const width = bars.length * (barWidth + gap) + 20;

      let svg = \`<svg class="chart-svg" viewBox="0 0 \${width} \${chartHeight + labelOffset + 10}" width="\${width}" height="\${chartHeight + labelOffset + 10}">\`;

      let x = 10;
      for (const bar of bars) {
        const height = (bar.count / maxCount) * chartHeight;
        const y = chartHeight - height + 10;
        const filterValue = bar.filterValue || bar.key;

        svg += \`<rect class="chart-segment" data-filter-type="\${bar.filterType}" data-filter-value="\${filterValue}" x="\${x}" y="\${y}" width="\${barWidth}" height="\${height}" fill="\${colorMap[bar.key]}" rx="2"><title>\${labelMap[bar.key]}: \${bar.count}</title></rect>\`;
        svg += \`<text x="\${x + barWidth / 2}" y="\${chartHeight + labelOffset}" text-anchor="middle" font-size="11" font-weight="500" fill="#a0a0a0" pointer-events="none">\${labelMap[bar.key]}</text>\`;

        x += barWidth + gap;
      }

      svg += '</svg>';
      return svg;
    }


    function getArcPath(cx, cy, r, startAngle, endAngle) {
      const start = polarToCartesian(cx, cy, r, endAngle);
      const end = polarToCartesian(cx, cy, r, startAngle);
      const largeArc = endAngle - startAngle <= 180 ? '0' : '1';

      return [
        'M',
        cx,
        cy,
        'L',
        start.x,
        start.y,
        'A',
        r,
        r,
        0,
        largeArc,
        0,
        end.x,
        end.y,
        'Z',
      ].join(' ');
    }

    function getDonutPath(cx, cy, innerR, outerR, startAngle, endAngle) {
      const outerStart = polarToCartesian(cx, cy, outerR, endAngle);
      const outerEnd = polarToCartesian(cx, cy, outerR, startAngle);
      const innerStart = polarToCartesian(cx, cy, innerR, endAngle);
      const innerEnd = polarToCartesian(cx, cy, innerR, startAngle);

      const largeArc = endAngle - startAngle <= 180 ? '0' : '1';

      return [
        'M',
        outerStart.x,
        outerStart.y,
        'A',
        outerR,
        outerR,
        0,
        largeArc,
        0,
        outerEnd.x,
        outerEnd.y,
        'L',
        innerEnd.x,
        innerEnd.y,
        'A',
        innerR,
        innerR,
        0,
        largeArc,
        1,
        innerStart.x,
        innerStart.y,
        'Z',
      ].join(' ');
    }

    function polarToCartesian(cx, cy, r, angle) {
      const radians = ((angle - 90) * Math.PI) / 180.0;
      return {
        x: cx + r * Math.cos(radians),
        y: cy + r * Math.sin(radians),
      };
    }

    function renderStats() {
      const statsRow = document.getElementById('statsRow');

      const stats = [
        {
          label: 'Total de Tests',
          value: DATA.summary.total,
        },
        {
          label: 'Aprobados',
          value: DATA.summary.passed,
        },
        {
          label: 'Fallidos',
          value: DATA.summary.failed,
        },
        {
          label: 'No Aplicables',
          value: DATA.summary.notApplicable || DATA.summary.skipped,
        },
      ];


      stats.push({
        label: 'Duración',
        value: \`\${(DATA.meta.duration / 1000).toFixed(1)}s\`,
      });

      for (const stat of stats) {
        const card = document.createElement('div');
        card.className = 'stat-card';
        card.innerHTML = \`
          <div class="stat-label">\${stat.label}</div>
          <div class="stat-value">\${stat.value}</div>
        \`;
        statsRow.appendChild(card);
      }
    }

    function renderTests() {
      const table = document.getElementById('testsTable');
      table.innerHTML = '';

      if (filteredTests.length === 0) {
        table.innerHTML = \`
          <div class="empty-state">
            <div class="empty-state-icon">🔍</div>
            <div class="empty-state-text">No hay tests que coincidan con el filtro</div>
          </div>
        \`;
        return;
      }

      const sorted = [...filteredTests].sort((a, b) => {
        const severityOrder = [
          'blocker',
          'critical',
          'high',
          'normal',
          'medium',
          'minor',
          'trivial',
          'low',
        ];
        const aIndex = severityOrder.indexOf(a.severity || 'low');
        const bIndex = severityOrder.indexOf(b.severity || 'low');

        if (aIndex !== bIndex) {
          return aIndex - bIndex;
        }

        return a.name.localeCompare(b.name);
      });

      for (const test of sorted) {
        const row = document.createElement('div');
        row.className = 'test-row';

        const statusIcon = {
          passed: '✓',
          failed: '✗',
          skipped: '⊘',
        }[test.status];

        const statusClass = \`status-\${test.status}\`;

        const tags = test.tags
          .slice(0, 2)
          .map((tag) => {
            let badgeClass = 'badge-other';
            if (tag.startsWith('OWASP')) {
              badgeClass = 'badge-owasp';
            } else if (tag.startsWith('GOES')) {
              badgeClass = 'badge-goes';
            }

            return \`<span class="badge badge-tag \${badgeClass}">\${escapeHtml(tag)}</span>\`;
          })
          .join('');

        const tagsHtml = test.tags.length > 2 ? tags + \`<span class="badge badge-tag badge-other">+\${test.tags.length - 2}</span>\` : tags;

        const severityCell = test.naReason
          ? \`<span class="badge badge-na" title="\${escapeHtml(test.naReason)}">N/A</span>\`
          : test.severity
            ? \`<span class="badge badge-severity badge-\${test.severity}">\${sevLabel(test.severity)}</span>\`
            : '';

        const fileHint = test.relativePath
          ? \`<div class="test-file-path">\${escapeHtml(test.relativePath)}</div>\`
          : '';

        row.innerHTML = \`
          <div class="test-name" title="\${escapeHtml(test.fullName)}">\${escapeHtml(test.name)}\${fileHint}</div>
          <div class="test-severity">\${severityCell}</div>
          <div class="test-severity">\${tagsHtml}</div>
          <div class="test-status \${statusClass}">\${statusIcon}</div>
          <div class="test-duration">\${test.duration}ms</div>
        \`;

        row.addEventListener('click', () => openModal(test));
        table.appendChild(row);
      }
    }

    const OWASP_TOP10_URLS = {
      'OWASP A01': 'https://owasp.org/Top10/A01_2021-Broken_Access_Control/',
      'OWASP A02': 'https://owasp.org/Top10/A02_2021-Cryptographic_Failures/',
      'OWASP A03': 'https://owasp.org/Top10/A03_2021-Injection/',
      'OWASP A04': 'https://owasp.org/Top10/A04_2021-Insecure_Design/',
      'OWASP A05': 'https://owasp.org/Top10/A05_2021-Security_Misconfiguration/',
      'OWASP A06': 'https://owasp.org/Top10/A06_2021-Vulnerable_and_Outdated_Components/',
      'OWASP A07': 'https://owasp.org/Top10/A07_2021-Identification_and_Authentication_Failures/',
      'OWASP A08': 'https://owasp.org/Top10/A08_2021-Software_and_Data_Integrity_Failures/',
      'OWASP A09': 'https://owasp.org/Top10/A09_2021-Security_Logging_and_Monitoring_Failures/',
      'OWASP A10': 'https://owasp.org/Top10/A10_2021-Server-Side_Request_Forgery_%28SSRF%29/',
    };

    const OWASP_API_URLS = {
      'OWASP API1': 'https://owasp.org/API-Security/editions/2023/en/0xa1-broken-object-level-authorization/',
      'OWASP API2': 'https://owasp.org/API-Security/editions/2023/en/0xa2-broken-authentication/',
      'OWASP API3': 'https://owasp.org/API-Security/editions/2023/en/0xa3-broken-object-property-level-authorization/',
      'OWASP API4': 'https://owasp.org/API-Security/editions/2023/en/0xa4-unrestricted-resource-consumption/',
      'OWASP API5': 'https://owasp.org/API-Security/editions/2023/en/0xa5-broken-function-level-authorization/',
      'OWASP API6': 'https://owasp.org/API-Security/editions/2023/en/0xa6-unrestricted-access-to-sensitive-business-flows/',
      'OWASP API7': 'https://owasp.org/API-Security/editions/2023/en/0xa7-server-side-request-forgery/',
      'OWASP API8': 'https://owasp.org/API-Security/editions/2023/en/0xa8-security-misconfiguration/',
      'OWASP API9': 'https://owasp.org/API-Security/editions/2023/en/0xa9-improper-inventory-management/',
      'OWASP API10': 'https://owasp.org/API-Security/editions/2023/en/0xaa-unsafe-consumption-of-apis/',
    };

    function referenceUrl(tag) {
      if (!tag) return null;
      if (OWASP_TOP10_URLS[tag]) return OWASP_TOP10_URLS[tag];
      if (OWASP_API_URLS[tag]) return OWASP_API_URLS[tag];
      return null;
    }

    function openModal(test) {
      const modal = document.getElementById('modal');
      const overlay = document.getElementById('modalOverlay');

      const statusIcon = {
        passed: '✓',
        failed: '✗',
        skipped: '⊘',
      }[test.status];

      const statusColor = {
        passed: '#22c55e',
        failed: '#ef4444',
        skipped: '#94a3b8',
      }[test.status];

      const headerSeverityBadge = test.naReason
        ? \`<span class="badge badge-na">N/A</span>\`
        : test.severity
          ? \`<span class="badge badge-severity badge-\${test.severity}">\${sevLabel(test.severity)}</span>\`
          : '';

      const sourceFileBar = test.relativePath
        ? \`<div class="modal-source-file">
            <span class="source-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg></span>
            <span class="source-label">Spec</span>
            <span class="source-path">\${escapeHtml(test.relativePath)}</span>
          </div>\`
        : '';

      let content = \`
        <div class="modal-header">
          <div>
            <div class="modal-title">\${escapeHtml(test.fullName)}</div>
          </div>
          <button class="modal-close" onclick="closeModal()">✕</button>
        </div>
        \${sourceFileBar}
        <div class="modal-content">
          <div class="modal-section">
            <div style="display: flex; gap: 12px; align-items: center; margin-bottom: 16px; flex-wrap: wrap;">
              \${headerSeverityBadge}
              \${test.tags
                .map((tag) => {
                  let badgeClass = 'badge-other';
                  if (tag.startsWith('OWASP')) {
                    badgeClass = 'badge-owasp';
                  } else if (tag.startsWith('GOES')) {
                    badgeClass = 'badge-goes';
                  }

                  return \`<span class="badge badge-tag \${badgeClass}">\${escapeHtml(tag)}</span>\`;
                })
                .join('')}
            </div>
          </div>
      \`;

      if (test.naReason) {
        content += \`
          <div class="modal-section">
            <div class="na-callout">
              <span class="na-callout-label">No aplicable a este proyecto</span>
              <span class="na-callout-reason">\${escapeHtml(test.naReason)}</span>
            </div>
          </div>
        \`;
      }

      if (test.epic || test.feature || test.story || test.owner) {
        content += \`
          <div class="modal-section">
            <div class="modal-section-title">Clasificación</div>
            <div class="classification-grid">
              \${test.epic ? \`<div class="classification-item"><div class="classification-label">Épica</div><div class="classification-value">\${escapeHtml(test.epic)}</div></div>\` : ''}
              \${test.feature ? \`<div class="classification-item"><div class="classification-label">Feature</div><div class="classification-value">\${escapeHtml(test.feature)}</div></div>\` : ''}
              \${test.story ? \`<div class="classification-item"><div class="classification-label">Historia</div><div class="classification-value">\${escapeHtml(test.story)}</div></div>\` : ''}
              \${test.owner ? \`<div class="classification-item"><div class="classification-label">Responsable</div><div class="classification-value">\${escapeHtml(test.owner)}</div></div>\` : ''}
            </div>
          </div>
        \`;
      }

      if (test.description) {
        content += \`
          <div class="modal-section">
            <div class="modal-section-title">Descripción</div>
            <div class="description-content">\${test.description}</div>
          </div>
        \`;
      }

      if (test.steps.length > 0) {
        content += \`
          <div class="modal-section">
            <div class="modal-section-title">Pasos</div>
            <div class="steps-list">
              \${test.steps
                .map(
                  (step, i) =>
                    \`<div class="step-item"><span class="step-number">\${i + 1}.</span> <span>\${escapeHtml(step)}</span></div>\`,
                )
                .join('')}
            </div>
          </div>
        \`;
      }

      if (test.evidences.length > 0) {
        content += \`
          <div class="modal-section">
            <div class="modal-section-title">Evidencia</div>
            \${test.evidences
              .map(
                (evidence) =>
                  \`<div style="margin-bottom: 12px;"><div style="font-size: 12px; color: #a0a0a0; margin-bottom: 6px;">\${escapeHtml(evidence.name)}</div><pre class="evidence-code">\${escapeHtml(JSON.stringify(evidence.data, null, 2))}</pre></div>\`,
              )
              .join('')}
          </div>
        \`;
      }

      const autoLinks = (test.tags || [])
        .map((tag) => {
          const url = referenceUrl(tag);
          return url ? { name: tag, url, source: 'auto' } : null;
        })
        .filter(Boolean);

      const explicitLinks = (test.links || []).map((l) => ({ ...l, source: 'explicit' }));
      const allLinks = [...explicitLinks, ...autoLinks];

      if (allLinks.length > 0) {
        content += \`
          <div class="modal-section">
            <div class="modal-section-title">Referencias</div>
            <div class="links-list">
              \${allLinks
                .map(
                  (link) =>
                    \`<div class="link-item">🔗 <a href="\${escapeHtml(link.url)}" target="_blank" rel="noopener">\${escapeHtml(link.name)}</a></div>\`,
                )
                .join('')}
            </div>
          </div>
        \`;
      }

      if (test.errors.length > 0) {
        content += \`
          <div class="modal-section">
            <div class="modal-section-title">Errores (\${test.errors.length})</div>
            <div class="error-list">
              \${test.errors.map((err, idx) => {
                const parsed = parseError(err, test.relativePath);
                const errId = test.id + '-err-' + idx;
                let html = '<div class="error-item">';

                // ── Error header with number badge + file location ──
                html += '<div class="error-header">';
                html += \`<span class="error-number">\${idx + 1}</span>\`;
                html += '<div class="error-header-info">';
                if (parsed.file) {
                  html += \`<span class="error-header-file">\${escapeHtml(parsed.file)}\`;
                  if (parsed.line) html += \`<span class="error-header-line"> : \${escapeHtml(parsed.line)}</span>\`;
                  html += '</span>';
                }
                // One-liner summary extracted from the first meaningful line
                if (parsed.firstLine) {
                  html += \`<span style="font-size:11px;color:#9ca3af;">\${escapeHtml(parsed.firstLine)}</span>\`;
                }
                html += '</div></div>';

                // ── Clean error message body ──
                html += '<div class="error-body">';
                html += \`<div class="error-message">\${escapeHtml(parsed.message)}</div>\`;

                // Expected vs Received
                if (parsed.expected || parsed.received) {
                  html += '<div class="error-expected-received">';
                  if (parsed.expected) html += \`<div class="error-expected"><div class="error-er-label">Esperado</div>\${escapeHtml(parsed.expected)}</div>\`;
                  if (parsed.received) html += \`<div class="error-received"><div class="error-er-label">Recibido</div>\${escapeHtml(parsed.received)}</div>\`;
                  html += '</div>';
                }

                // Steps context — what was verified
                if (test.steps && test.steps.length > 0) {
                  html += \`<div class="error-steps-context">
                    <div class="error-steps-title">Lo que se verificó</div>
                    <div class="error-steps-list">\${test.steps.map(s => '• ' + escapeHtml(s)).join('<br>')}</div>
                  </div>\`;
                }

                // Raw stack — toggle at the bottom
                if (parsed.stack) {
                  html += \`<button class="error-raw-toggle" onclick="toggleRawStack('\${errId}')">Mostrar salida raw</button>
                    <div class="error-raw-stack" id="raw-\${errId}">\${escapeHtml(parsed.stack)}</div>\`;
                }

                html += '</div></div>';
                return html;
              }).join('')}
            </div>
          </div>
        \`;
      }

      const fileForRepro = test.relativePath || '';

      // Regex-escape the test name so chars like (, ), |, ., *, +, ?, [, ], \\
      // are matched literally by Jest's --testNamePattern. Then escape any
      // double quote so the command stays valid in a shell-quoted string.
      const regexEscaped = (test.name || '').replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&');
      const safeName = regexEscaped.replace(/"/g, '\\\\"');

      // Narrow Jest to just this file so even short --testNamePattern values
      // can't collide with similarly-named tests in other files.
      const fileBaseRaw = fileForRepro.split('/').pop() || '';
      const fileBase = fileBaseRaw
        .replace(/\\.spec\\.ts$/, '')
        .replace(/\\.security-html$/, '');

      // Use a positional path filter (instead of --testPathPattern) so the
      // command works in both Jest 29 (where the flag is --testPathPattern)
      // and Jest 30+ (where it was renamed to --testPathPatterns). Jest
      // accepts a bare positional argument as a path regex pattern in any
      // version.
      let runCmd = 'npm run test:security:html';
      if (fileBase && safeName) {
        runCmd = \`npm run test:security:html -- "\${fileBase}" -t "\${safeName}"\`;
      } else if (safeName) {
        runCmd = \`npm run test:security:html -- -t "\${safeName}"\`;
      } else if (fileBase) {
        runCmd = \`npm run test:security:html -- "\${fileBase}"\`;
      }

      content += \`
        <div class="modal-section">
          <div class="modal-section-title">Reproducibilidad</div>
          <div class="reproducibility-block">
            <div class="repro-row">
              <span class="repro-label">Archivo</span>
              <code class="repro-value">\${escapeHtml(fileForRepro)}</code>
              <button class="repro-copy" onclick="copyRepro(this)" title="Copiar ruta">📋</button>
            </div>
            <div class="repro-row">
              <span class="repro-label">Test</span>
              <code class="repro-value">\${escapeHtml(test.name || '')}</code>
              <button class="repro-copy" onclick="copyRepro(this)" title="Copiar nombre">📋</button>
            </div>
            <div class="repro-row">
              <span class="repro-label">Ejecutar</span>
              <code class="repro-value repro-cmd">\${escapeHtml(runCmd)}</code>
              <button class="repro-copy" onclick="copyRepro(this)" title="Copiar comando">📋</button>
            </div>
          </div>
        </div>
      \`;

      content += \`
        <div class="modal-section">
          <div class="modal-status">
            <div class="status-item">
              <span style="color: \${statusColor}; font-size: 18px;">\${statusIcon}</span>
              <span>Estado: <strong>\${statusLabel(test.status)}</strong></span>
            </div>
            <div class="status-item">
              <span>Duración: <strong>\${test.duration}ms</strong></span>
            </div>
          </div>
        </div>
      \`;

      modal.innerHTML = content;
      overlay.classList.add('active');
    }

    function closeModal() {
      document.getElementById('modalOverlay').classList.remove('active');
    }

    function copyRepro(btn) {
      const value = btn.previousElementSibling?.textContent || '';
      const restore = () => {
        btn.classList.remove('copied');
        btn.textContent = '📋';
      };
      const ok = () => {
        btn.classList.add('copied');
        btn.textContent = '✓';
        setTimeout(restore, 1500);
      };
      const fail = () => {
        btn.textContent = '✗';
        setTimeout(restore, 1500);
      };

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(value).then(ok).catch(() => {
          // Fallback for browsers/contexts without clipboard API (e.g. file:// in Safari)
          try {
            const ta = document.createElement('textarea');
            ta.value = value;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            ok();
          } catch (_) {
            fail();
          }
        });
      } else {
        try {
          const ta = document.createElement('textarea');
          ta.value = value;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
          ok();
        } catch (_) {
          fail();
        }
      }
    }

    // ── Error parser ─────────────────────────────────────────────
    // Extracts file, line, expected/received from raw Jest/Vitest error text.
    function parseError(raw, fallbackFile) {
      if (!raw) return { message: '', stack: '', file: '', line: '', expected: '', received: '', firstLine: '' };
      // Strip ANSI escape codes
      const clean = raw.replace(/\\x1b\\[[0-9;]*m/g, '').replace(/\\[[0-9;]*m/g, '');

      let file = '';
      let line = '';
      let expected = '';
      let received = '';

      // Extract file:line — "at Object.<anonymous> (path/file.ts:42:5)"
      const atMatch = clean.match(/at\\s+(?:Object\\.\\<anonymous\\>|[\\w.]+)\\s+\\((.+?):(\\d+):\\d+\\)/);
      if (atMatch) { file = atMatch[1]; line = atMatch[2]; }

      // Also try "● path/file.ts" or "> path/file.ts"
      if (!file) {
        const bulletMatch = clean.match(/^\\s*(?:●|>)\\s+(.+\\.(?:ts|js|tsx|jsx|vue))(?::(\\d+))?/m);
        if (bulletMatch) { file = bulletMatch[1]; if (bulletMatch[2]) line = bulletMatch[2]; }
      }

      // Try bare path:line:col at the end of a line (Vitest style)
      if (!file) {
        const bareMatch = clean.match(/(\\S+\\.(?:ts|js|tsx|jsx|vue)):(\\d+):\\d+/);
        if (bareMatch) { file = bareMatch[1]; line = bareMatch[2]; }
      }

      // Extract Expected / Received — support multiword labels
      const expMatch = clean.match(/Expected(?:\\s+\\w+)*[:\\s]+(.+)/);
      const recMatch = clean.match(/Received(?:\\s+\\w+)*[:\\s]+(.+)/);
      if (expMatch) expected = expMatch[1].trim();
      if (recMatch) received = recMatch[1].trim();

      // Split message from stack trace
      let message = '';
      let stack = '';
      const stackIdx = clean.indexOf('\\n    at ');
      if (stackIdx > -1) {
        message = clean.substring(0, stackIdx).trim();
        stack = clean.substring(stackIdx).trim();
      } else {
        message = clean.trim();
      }

      // Extract a clean one-liner summary (first meaningful line)
      let firstLine = '';
      const msgLines = message.split('\\n');
      for (const l of msgLines) {
        const trimmed = l.replace(/^\\s*[●>]\\s*/, '').trim();
        if (trimmed && trimmed.length > 5 && !trimmed.match(/^\\s*at\\s/)) {
          if (!trimmed.match(/^[\\w/\\\\\\.\\-]+\\.(ts|js|tsx|jsx|vue)(:\\d+)?$/)) {
            firstLine = trimmed.length > 120 ? trimmed.substring(0, 117) + '...' : trimmed;
            break;
          }
        }
      }

      // Make absolute paths relative
      if (file && file.startsWith('/')) {
        const parts = file.split('/');
        const srcIdx = parts.findIndex(p => p === 'tests' || p === 'test' || p === 'src');
        if (srcIdx > -1) file = parts.slice(srcIdx).join('/');
      }

      return { message, stack, file: file || fallbackFile || '', line, expected, received, firstLine };
    }

    function toggleRawStack(errId) {
      const el = document.getElementById('raw-' + errId);
      const btn = el?.previousElementSibling;
      if (el) {
        el.classList.toggle('open');
        if (btn) btn.textContent = el.classList.contains('open') ? 'Ocultar salida raw' : 'Mostrar salida raw';
      }
    }

    function escapeHtml(text) {
      if (!text) return '';
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    document.getElementById('modalOverlay').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) {
        closeModal();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeModal();
      }
    });

    init();
  </script>
</body>
</html>
`;
  }
}

module.exports = SecurityHtmlReporter;
