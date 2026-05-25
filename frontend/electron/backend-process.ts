/**
 * ARKI — BackendProcess
 *
 * Manages the lifecycle of the Python FastAPI backend process:
 *   - Spawns uvicorn in development or uses the bundled venv in production
 *   - Auto-restarts on unexpected exit (up to MAX_RETRIES)
 *   - Polls /health until the server is ready
 *   - Emits typed lifecycle events consumed by main.ts
 */

import { EventEmitter }              from 'events';
import { spawn, ChildProcess }       from 'child_process';
import * as path                     from 'path';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface BackendProcessConfig {
  host:    string;
  port:    number;
  /** Log level passed to uvicorn. Default: 'info' in dev, 'warning' in prod. */
  logLevel?: string;
}

export interface BackendProcessEvents {
  /** Fired when the backend process is spawned and accepting connections. */
  ready:   ()            => void;
  /** Fired on each restart attempt after unexpected exit. */
  restart: (attempt: number, maxRetries: number) => void;
  /** Fired after MAX_RETRIES consecutive failures — backend will not be restarted. */
  failed:  (reason: string) => void;
  /** Fired when the backend exits cleanly (SIGTERM from stop()). */
  stopped: ()            => void;
}

export declare interface BackendProcess {
  on<K extends keyof BackendProcessEvents>(event: K, listener: BackendProcessEvents[K]): this;
  once<K extends keyof BackendProcessEvents>(event: K, listener: BackendProcessEvents[K]): this;
  off<K extends keyof BackendProcessEvents>(event: K, listener: BackendProcessEvents[K]): this;
  emit<K extends keyof BackendProcessEvents>(event: K, ...args: Parameters<BackendProcessEvents[K]>): boolean;
}

// ── BackendProcess ─────────────────────────────────────────────────────────────

export class BackendProcess extends EventEmitter {
  private process:       ChildProcess | null = null;
  private retryCount     = 0;
  private stopping       = false;

  private static readonly MAX_RETRIES      = 3;
  private static readonly RESTART_DELAY_MS = 2_000;
  private static readonly HEALTH_POLL_MS   = 250;

  constructor(
    private readonly config:  BackendProcessConfig,
    private readonly isDev:   boolean,
  ) {
    super();
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /** Spawn the backend. Resolves immediately (use waitUntilReady for readiness). */
  start(): void {
    if (this.process) {
      console.warn('[BackendProcess] start() called but process already running — ignoring');
      return;
    }
    this.stopping    = false;
    this.retryCount  = 0;
    this.spawn();
  }

  /**
   * Gracefully stop the backend.
   * Sends SIGTERM and waits up to 2 s before SIGKILL.
   */
  async stop(): Promise<void> {
    this.stopping = true;

    if (!this.process) return;

    return new Promise<void>((resolve) => {
      const proc = this.process!;

      const forceKill = setTimeout(() => {
        if (!proc.killed) {
          console.warn('[BackendProcess] SIGKILL after 2 s timeout');
          proc.kill('SIGKILL');
        }
        resolve();
      }, 2_000);

      proc.once('exit', () => {
        clearTimeout(forceKill);
        this.process = null;
        this.emit('stopped');
        resolve();
      });

      proc.kill('SIGTERM');
    });
  }

  /** Returns true if the child process is currently running. */
  isRunning(): boolean {
    return this.process !== null && !this.process.killed;
  }

  /**
   * Poll GET /health until HTTP 200 is received or the timeout expires.
   * @param timeoutMs Maximum wait time in milliseconds.
   * @returns true if ready within timeout, false otherwise.
   */
  async waitUntilReady(timeoutMs = 15_000): Promise<boolean> {
    const deadline  = Date.now() + timeoutMs;
    const healthUrl = `http://${this.config.host}:${this.config.port}/health`;

    while (Date.now() < deadline) {
      try {
        const resp = await fetch(healthUrl, { signal: AbortSignal.timeout(1_000) });
        if (resp.ok) {
          console.log(`[BackendProcess] Health OK at ${healthUrl}`);
          return true;
        }
      } catch {
        // Not ready yet — keep polling
      }
      await sleep(BackendProcess.HEALTH_POLL_MS);
    }

    console.error(`[BackendProcess] Timed out waiting for backend after ${timeoutMs}ms`);
    return false;
  }

  // ── Private: process lifecycle ─────────────────────────────────────────────

  private spawn(): void {
    const { pythonBin, cwd, args } = this.resolveCommand();

    console.log(`[BackendProcess] Spawning: ${pythonBin} ${args.join(' ')}`);
    console.log(`[BackendProcess] cwd: ${cwd}`);

    const proc = spawn(pythonBin, args, {
      cwd,
      env:   { ...process.env, PYTHONUNBUFFERED: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    proc.stdout?.on('data', (chunk: Buffer) => {
      if (this.isDev) {
        process.stdout.write(`[Backend] ${chunk.toString()}`);
      }
    });

    proc.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      // Always log errors; only log other stderr in dev
      if (this.isDev || /error|exception|traceback/i.test(text)) {
        process.stderr.write(`[Backend ERR] ${text}`);
      }
    });

    proc.on('error', (err) => {
      console.error(`[BackendProcess] Spawn error: ${err.message}`);
      this.onExit(1, null);
    });

    proc.on('exit', (code, signal) => {
      this.onExit(code, signal);
    });

    this.process = proc;
  }

  private onExit(code: number | null, signal: NodeJS.Signals | null): void {
    this.process = null;

    // Clean voluntary exit via stop()
    if (this.stopping || signal === 'SIGTERM') {
      console.log(`[BackendProcess] Exited cleanly (code=${code} signal=${signal})`);
      this.emit('stopped');
      return;
    }

    console.warn(`[BackendProcess] Unexpected exit: code=${code} signal=${signal}`);

    if (this.retryCount >= BackendProcess.MAX_RETRIES) {
      const reason =
        `Backend exited unexpectedly ${BackendProcess.MAX_RETRIES} times ` +
        `(last: code=${code} signal=${signal}). Giving up.`;
      console.error(`[BackendProcess] ${reason}`);
      this.emit('failed', reason);
      return;
    }

    this.retryCount += 1;
    const attempt = this.retryCount;
    console.log(
      `[BackendProcess] Restarting in ${BackendProcess.RESTART_DELAY_MS}ms ` +
      `(attempt ${attempt}/${BackendProcess.MAX_RETRIES})`,
    );
    this.emit('restart', attempt, BackendProcess.MAX_RETRIES);

    setTimeout(() => {
      if (!this.stopping) this.spawn();
    }, BackendProcess.RESTART_DELAY_MS);
  }

  // ── Private: command resolution ────────────────────────────────────────────

  private resolveCommand(): { pythonBin: string; cwd: string; args: string[] } {
    const host     = this.config.host;
    const port     = String(this.config.port);
    const logLevel = this.config.logLevel ?? (this.isDev ? 'info' : 'warning');

    if (this.isDev) {
      // Development: use system python3, backend/ is a sibling of frontend/
      const cwd = path.resolve(process.cwd(), '..', 'backend');
      return {
        pythonBin: 'python3',
        cwd,
        args: [
          '-m', 'uvicorn', 'main:app',
          '--host',      host,
          '--port',      port,
          '--log-level', logLevel,
          '--reload',
        ],
      };
    }

    // Production: use the bundled venv inside resources/backend/
    const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
      ?? path.join(path.dirname(process.execPath), 'resources');
    const cwd       = path.join(resourcesPath, 'backend');
    const pythonBin = path.join(cwd, 'venv', 'bin', 'python3');

    return {
      pythonBin,
      cwd,
      args: [
        '-m', 'uvicorn', 'main:app',
        '--host',      host,
        '--port',      port,
        '--log-level', logLevel,
      ],
    };
  }
}

// ── Utility ───────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
