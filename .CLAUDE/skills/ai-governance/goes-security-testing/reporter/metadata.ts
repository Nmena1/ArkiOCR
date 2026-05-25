/**
 * Security Reporter Helper — Metadata Collector
 * ───────────────────────────────────────────────
 * Collects metadata (epic, feature, story, severity, tags, parameters, steps, evidence)
 * per test and writes it to a temp JSON file that the custom SecurityHtmlReporter reads.
 *
 * Compatible with allure-js-commons API for zero-migration from existing Allure tests.
 *
 * Usage:
 *   import { report } from './reporter/metadata';
 *
 *   it('test name', async () => {
 *     const t = report();
 *     t.epic('Input Validation');
 *     t.severity('critical');
 *     t.parameter('email', 'test@goes.gob.sv');
 *     t.step('Validate DTO');
 *     // ... test logic ...
 *     t.evidence('Validation Result', { payload, errors });
 *     await t.flush();
 *   });
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

// ─── Temp directory for metadata files ─────────────────────────
//
// Concurrency: when Jest runs in parallel (--maxWorkers > 1) or when several
// CI jobs share the same machine, every worker process must scope its
// metadata to a unique subdirectory; otherwise the reporter would merge
// unrelated runs.
//
// Resolution order:
//   1. SECURITY_REPORTER_TEMP_DIR  (full override)
//   2. SECURITY_REPORTER_RUN_ID    (subdir scoped to this run)
//   3. fallback: $TMPDIR/security-html-reporter
function resolveTempDir(): string {
  if (process.env.SECURITY_REPORTER_TEMP_DIR) {
    return path.resolve(process.env.SECURITY_REPORTER_TEMP_DIR);
  }
  const runId = process.env.SECURITY_REPORTER_RUN_ID;
  if (runId) {
    return path.resolve(path.join(os.tmpdir(), 'security-html-reporter', runId));
  }
  return path.resolve(path.join(os.tmpdir(), 'security-html-reporter'));
}

const TEMP_DIR = resolveTempDir();

// Ensure temp directory exists
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// ─── Interfaces ─────────────────────────────────────────────────
export interface TestMetadata {
  testName: string;
  testPath: string;
  epic?: string;
  feature?: string;
  story?: string;
  severity?: string;
  owner?: string;
  tags: string[];
  labels: Record<string, string>;
  suite?: string;
  parentSuite?: string;
  links: Array<{ url: string; name: string }>;
  description?: string;
  parameters: Array<{ name: string; value: string }>;
  steps: string[];
  evidences: Array<{ name: string; data: unknown }>;
  /**
   * If set, the reporter overrides the test status to "skipped" and renders a
   * Not Applicable badge with this reason. Use it when a checklist item does
   * not apply to the project under test (e.g. R57-R60 file upload rules on a
   * backend that does not accept uploads).
   */
  naReason?: string;
}

// ─── Reporter Class ─────────────────────────────────────────────
class SecurityTestReporter {
  private meta: TestMetadata = {
    testName: '',
    testPath: '',
    tags: [],
    labels: {},
    links: [],
    parameters: [],
    steps: [],
    evidences: [],
  };

  epic(name: string): this {
    this.meta.epic = name;
    return this;
  }

  feature(name: string): this {
    this.meta.feature = name;
    return this;
  }

  story(name: string): this {
    this.meta.story = name;
    return this;
  }

  severity(level: string): this {
    this.meta.severity = level.toLowerCase();
    return this;
  }

  owner(name: string): this {
    this.meta.owner = name;
    return this;
  }

  tag(...tags: string[]): this {
    this.meta.tags.push(...tags);
    return this;
  }

  label(key: string, value: string): this {
    this.meta.labels[key] = value;
    return this;
  }

  suite(name: string): this {
    this.meta.suite = name;
    return this;
  }

  parentSuite(name: string): this {
    this.meta.parentSuite = name;
    return this;
  }

  link(url: string, name?: string): this {
    this.meta.links.push({ url, name: name || url });
    return this;
  }

  descriptionHtml(html: string): this {
    this.meta.description = html;
    return this;
  }

  parameter(name: string, value: unknown): this {
    let strValue: string;
    if (value == null) {
      strValue = String(value);
    } else if (typeof value === 'string') {
      strValue = value;
    } else {
      strValue = JSON.stringify(value);
    }
    this.meta.parameters.push({ name, value: strValue });
    return this;
  }

  step(name: string, fn?: () => any): any {
    this.meta.steps.push(name);
    if (fn) {
      return fn();
    }
    return this;
  }

  evidence(name: string, data: unknown): this {
    this.meta.evidences.push({ name, data });
    return this;
  }

  /**
   * Mark this test as Not Applicable. The reporter overrides the test status
   * to "skipped" and renders a Not Applicable badge with the given reason.
   *
   * Use it.skip() also works but loses metadata. notApplicable() keeps the
   * test body running (so metadata is captured) and reports as skipped.
   *
   * Example:
   *   it('R57-R60 — File upload rules', async () => {
   *     const t = report();
   *     t.epic('Archivos').feature('File Upload Security');
   *     t.notApplicable('Backend does not accept uploads (no multer, no FileInterceptor)');
   *     await t.flush();
   *   });
   */
  notApplicable(reason: string): this {
    this.meta.naReason = reason;
    return this;
  }

  /**
   * Flush metadata to a temp JSON file.
   * The custom reporter reads these files in onRunComplete.
   */
  async flush(): Promise<void> {
    // Get current test name and path from Jest's global state
    try {
      const state = expect.getState();
      this.meta.testName = state.currentTestName || '';
      this.meta.testPath = state.testPath || '';
    } catch {
      // Fallback if expect.getState() is not available
    }

    const id = crypto.randomBytes(8).toString('hex');
    const filePath = path.join(TEMP_DIR, `meta-${id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(this.meta, null, 2));
  }
}

// ─── Factory Function ───────────────────────────────────────────
export function report(): SecurityTestReporter {
  return new SecurityTestReporter();
}

/**
 * Compatibility layer: mirrors allure-js-commons API.
 * Use this for minimal migration effort from existing allure-based tests.
 */
export class AllureCompat {
  private reporter = new SecurityTestReporter();

  epic(name: string) { this.reporter.epic(name); }
  feature(name: string) { this.reporter.feature(name); }
  story(name: string) { this.reporter.story(name); }
  severity(level: string) { this.reporter.severity(level); }
  owner(name: string) { this.reporter.owner(name); }
  tag(...tags: string[]) { this.reporter.tag(...tags); }
  label(key: string, value: string) { this.reporter.label(key, value); }
  suite(name: string) { this.reporter.suite(name); }
  parentSuite(name: string) { this.reporter.parentSuite(name); }
  link(url: string, name?: string) { this.reporter.link(url, name); }
  descriptionHtml(html: string) { this.reporter.descriptionHtml(html); }
  // allure-js-commons exposes description() (markdown). We keep both names so
  // patterns migrated from the legacy Allure API still type-check.
  description(text: string) { this.reporter.descriptionHtml(text); }
  parameter(name: string, value: unknown) { this.reporter.parameter(name, value); }
  notApplicable(reason: string) { this.reporter.notApplicable(reason); }

  step<T = unknown>(name: string, fn?: () => T): T extends void ? this : T {
    return this.reporter.step(name, fn);
  }

  async attachment(name: string, data: unknown, _options?: any) {
    if (typeof data === 'string') {
      try {
        this.reporter.evidence(name, JSON.parse(data));
      } catch {
        this.reporter.evidence(name, data);
      }
    } else {
      this.reporter.evidence(name, data);
    }
  }

  async flush() {
    await this.reporter.flush();
  }
}

/**
 * Convenience helper used by legacy `attach('name', data)` calls in the test
 * patterns. Wires through to AllureCompat#attachment so callers do not need to
 * stringify their evidence manually.
 *
 * Usage in a spec:
 *   import { AllureCompat, attachFor } from '@security-reporter/metadata';
 *   const allure = new AllureCompat();
 *   const attach = attachFor(allure);
 *   await attach('payload (input)', { foo: 'bar' });
 */
export function attachFor(allure: AllureCompat) {
  return async (name: string, data: unknown) => {
    await allure.attachment(name, data);
  };
}

/**
 * Get the temp directory path (used by the custom reporter to read metadata files).
 */
export function getMetadataTempDir(): string {
  return TEMP_DIR;
}
