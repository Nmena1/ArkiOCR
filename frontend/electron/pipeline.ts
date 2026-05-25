/**
 * ARKI — Pipeline
 *
 * Async event-driven processing pipeline:
 *   capture → OCR → AI (optional) → display popup
 *
 * Prevents concurrent runs. Emits typed status events consumed by main.ts
 * to update the tray icon and tooltip.
 */

import { EventEmitter } from 'events';
import { CaptureManager, CaptureResult as ServiceCaptureResult, CaptureError } from './capture';
import { BackendBridge }   from './backend-bridge';
import { PopupManager }    from './popup-manager';

// ── Public types ──────────────────────────────────────────────────────────────

export interface PipelineOptions {
  mode:     'ocr-only' | 'ocr+ai';
  capture?: 'active-window' | 'fullscreen' | 'region';
}

export interface PipelineResult {
  ocr:         { text: string; confidence: number; provider: string };
  ai?:         { response: string; model: string; tokensUsed: number };
  imageBase64: string;
  captureMs:   number;
  ocrMs:       number;
  aiMs?:       number;
  totalMs:     number;
}

export type PipelineStatus = 'idle' | 'capturing' | 'processing' | 'displaying' | 'error';

// ── Events emitted ─────────────────────────────────────────────────────────────
//
//  'status'  (status: PipelineStatus) → tray icon / tooltip update
//  'result'  (result: PipelineResult) → optional downstream consumers
//  'error'   (err: Error)             → optional error handling
//  'busy'                             → fired when run() called while already running

export interface PipelineEvents {
  status: (status: PipelineStatus) => void;
  result: (result: PipelineResult)  => void;
  error:  (err: Error)              => void;
  busy:   ()                        => void;
}

export declare interface Pipeline {
  on<K extends keyof PipelineEvents>(event: K, listener: PipelineEvents[K]): this;
  once<K extends keyof PipelineEvents>(event: K, listener: PipelineEvents[K]): this;
  off<K extends keyof PipelineEvents>(event: K, listener: PipelineEvents[K]): this;
  emit<K extends keyof PipelineEvents>(event: K, ...args: Parameters<PipelineEvents[K]>): boolean;
}

// ── Pipeline ──────────────────────────────────────────────────────────────────

export class Pipeline extends EventEmitter {
  private busy = false;

  constructor(
    private readonly captureManager: CaptureManager,
    private readonly bridge:         BackendBridge,
    private readonly popupManager:   PopupManager,
  ) {
    super();
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Execute the full pipeline.
   * If a run is already in progress, emits 'busy' and returns immediately.
   */
  async run(options: PipelineOptions): Promise<void> {
    if (this.busy) {
      console.warn('[Pipeline] Already running — ignoring concurrent call');
      this.emit('busy');
      return;
    }

    this.busy = true;
    const t0  = performance.now();

    try {
      await this.execute(options, t0);
    } catch (err) {
      // REGION_CANCELLED is a user-initiated action, not an error
      if (err instanceof CaptureError && err.code === 'REGION_CANCELLED') {
        console.log('[Pipeline] Region selection cancelled by user');
        this.emit('status', 'idle' satisfies PipelineStatus);
        return;
      }

      const error = err instanceof Error ? err : new Error(String(err));
      console.error('[Pipeline] Unhandled error:', error.message);
      this.emit('error', error);
      this.emit('status', 'error' satisfies PipelineStatus);
    } finally {
      this.busy = false;
    }
  }

  /** Returns true if a pipeline run is currently in progress. */
  isRunning(): boolean {
    return this.busy;
  }

  // ── Stages ─────────────────────────────────────────────────────────────────

  private async execute(options: PipelineOptions, t0: number): Promise<void> {
    const captureMode = options.capture ?? 'active-window';

    // ── Stage 1: Capture ──────────────────────────────────────────────────
    this.emit('status', 'capturing' satisfies PipelineStatus);

    let captureResult: ServiceCaptureResult;
    try {
      captureResult = await this.captureManager.capture({
        mode:    captureMode === 'region' ? 'region' : 'fullscreen',
        quality: 'balanced',
        delayMs: 80,
      });
    } catch (err) {
      // Re-throw CaptureError (including REGION_CANCELLED) to be handled by run()
      if (err instanceof CaptureError) throw err;
      throw this.stageError('capture', err);
    }

    const captureMs = captureResult.timing.captureMs;
    console.log(`[Pipeline] Capture: ${captureMs}ms (${captureResult.width}×${captureResult.height})`);

    // ── Stage 2: OCR ──────────────────────────────────────────────────────
    this.emit('status', 'processing' satisfies PipelineStatus);
    const tOcr0 = performance.now();

    let ocrResult: Awaited<ReturnType<BackendBridge['ocr']>>;
    try {
      ocrResult = await this.bridge.ocr(captureResult.imageBase64);
    } catch (err) {
      throw this.stageError('ocr', err);
    }

    const ocrMs = Math.round(performance.now() - tOcr0);
    console.log(`[Pipeline] OCR: ${ocrMs}ms — confidence=${ocrResult.confidence.toFixed(2)} provider=${ocrResult.provider}`);

    // ── Stage 3: AI (optional) ────────────────────────────────────────────
    let aiResult:  Awaited<ReturnType<BackendBridge['ai']>> | undefined;
    let aiMs:      number | undefined;

    if (options.mode === 'ocr+ai') {
      const tAi0 = performance.now();
      try {
        aiResult = await this.bridge.ai(ocrResult.text);
      } catch (err) {
        throw this.stageError('ai', err);
      }
      aiMs = Math.round(performance.now() - tAi0);
      console.log(`[Pipeline] AI: ${aiMs}ms — model=${aiResult.model} tokens=${aiResult.tokensUsed}`);
    }

    // ── Stage 4: Display popup ─────────────────────────────────────────────
    this.emit('status', 'displaying' satisfies PipelineStatus);
    const totalMs = Math.round(performance.now() - t0);

    try {
      await this.popupManager.show({
        ocr:     ocrResult,
        ai:      aiResult,
        mode:    options.mode,
        totalMs,
      });
    } catch (err) {
      throw this.stageError('display', err);
    }

    console.log(`[Pipeline] Complete: total=${totalMs}ms (capture=${captureMs} ocr=${ocrMs}${aiMs !== undefined ? ` ai=${aiMs}` : ''})`);

    // ── Emit result ──────────────────────────────────────────────────────
    const result: PipelineResult = {
      ocr:         ocrResult,
      ai:          aiResult,
      imageBase64: captureResult.imageBase64,
      captureMs,
      ocrMs,
      aiMs,
      totalMs,
    };

    this.emit('result', result);
    this.emit('status', 'idle' satisfies PipelineStatus);
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private stageError(stage: string, err: unknown): Error {
    const message = err instanceof Error ? err.message : String(err);
    return new Error(`[Pipeline] Stage '${stage}' failed: ${message}`);
  }
}
