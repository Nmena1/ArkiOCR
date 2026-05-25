/**
 * ARKI Capture Engine — Capture Manager
 *
 * Main public API for the capture subsystem. Orchestrates permission checks,
 * display resolution, cache lookups, raw capture, image processing, and the
 * interactive region selector into a single coherent surface.
 *
 * Usage:
 *   const manager = new CaptureManager({ isDev, preloadPath, htmlPath });
 *   await manager.initialize();      // call once after app.whenReady()
 *   const result = await manager.capture({ mode: 'fullscreen' });
 *
 * Events (EventEmitter):
 *   'captured'  (result: CaptureResult) — fired after every successful capture
 */

import { screen }                from 'electron';
import { EventEmitter }          from 'events';

import { CaptureRawService }     from './service';
import { PermissionManager }     from './permissions';
import { ImageProcessor }        from './processor';
import { RegionSelector }        from './region-selector';
import { CaptureCache }          from './cache';

import type {
  CaptureOptions,
  CaptureResult,
  CaptureRegion,
  DisplayInfo,
  PermissionStatus,
  ProcessorOptions,
} from './types';
import { CaptureError } from './types';

// ── Helper ─────────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

// ── Constructor options ────────────────────────────────────────────────────────

export interface CaptureManagerOptions {
  isDev:       boolean;
  preloadPath: string;   // absolute path to preload-region.js
  htmlPath:    string;   // absolute path to region-selector/index.html
  theme?:      'dark' | 'light';
}

// ── CaptureManager ─────────────────────────────────────────────────────────────

export class CaptureManager extends EventEmitter {
  private readonly service:        CaptureRawService;
  private readonly permissions:    PermissionManager;
  private readonly processor:      ImageProcessor;
  private readonly regionSelector: RegionSelector;
  private readonly cache:          CaptureCache;
  private readonly isDev:          boolean;
  private readonly theme:          'dark' | 'light';

  private busy:        boolean = false;
  private initialized: boolean = false;

  constructor(opts: CaptureManagerOptions) {
    super();

    this.isDev  = opts.isDev;
    this.theme  = opts.theme ?? 'dark';

    this.service        = new CaptureRawService(opts.isDev);
    this.permissions    = new PermissionManager();
    this.processor      = new ImageProcessor(opts.isDev);
    this.regionSelector = new RegionSelector(opts.isDev, opts.preloadPath, opts.htmlPath);
    this.cache          = new CaptureCache({ maxEntries: 3, maxAgeMs: 150 });
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────────

  /**
   * Must be called once after `app.whenReady()`.
   *
   * 1. Checks screen-recording permission (warns, does not throw).
   * 2. Pre-warms desktopCapturer sources to minimise first-capture latency.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // 1. Check permission (macOS only) — surface warning but never throw here;
    //    the first capture attempt will throw with an actionable message.
    const status = await this.permissions.check();
    if (status === 'denied' || status === 'restricted') {
      console.warn(`[CaptureManager] Screen recording permission: ${status}`);
    }

    // 2. Pre-warm sources for the first capture
    const primary = screen.getPrimaryDisplay();
    const sf      = primary.scaleFactor;
    await this.service.warmSources(
      Math.round(primary.bounds.width  * sf),
      Math.round(primary.bounds.height * sf),
    ).catch(err => console.warn('[CaptureManager] Pre-warm failed:', (err as Error).message));

    this.initialized = true;
    console.log('[CaptureManager] Initialized');
  }

  // ── Core capture ──────────────────────────────────────────────────────────────

  /**
   * Capture a display and return a processed image.
   *
   * Concurrency: only one capture may run at a time. Concurrent calls receive
   * a recoverable `CAPTURE_FAILED` error and should retry after the ongoing
   * capture completes.
   */
  async capture(options: CaptureOptions): Promise<CaptureResult> {
    const t0 = performance.now();

    // Concurrency guard — one capture at a time
    if (this.busy) {
      throw new CaptureError('CAPTURE_FAILED', 'A capture is already in progress', true);
    }
    this.busy = true;

    try {
      // 1. Resolve display
      const display = options.displayId != null
        ? this.service.resolveDisplay(options.displayId)
        : this.service.getDisplayNearCursor();

      // 2. Apply screenshot delay (let windows settle after hotkey press)
      const delay = options.delayMs ?? 80;
      if (delay > 0) await sleep(delay);

      // 3. Check cache (deduplication within 150 ms window)
      const cacheKey = this.cache.buildKey(options.mode, display.id, options.region);
      const cached   = this.cache.get(cacheKey);
      if (cached !== null) {
        if (this.isDev) console.log('[CaptureManager] Cache hit:', cacheKey);
        return cached;
      }

      // 4. Assert permission (throws on macOS if denied / restricted / unknown)
      await this.permissions.assert();

      let result: CaptureResult;

      if (options.mode === 'fullscreen') {
        result = await this.captureFullscreenInternal(display, options, t0);
      } else {
        result = await this.captureRegionInternal(display, options, t0);
      }

      // 5. Store in cache
      this.cache.set(cacheKey, result);

      // 6. Re-warm sources for the next capture (fire and forget)
      const sf = display.scaleFactor;
      this.service.warmSources(
        Math.round(display.bounds.width  * sf),
        Math.round(display.bounds.height * sf),
      ).catch(() => { /* intentionally ignored */ });

      this.emit('captured', result);
      return result;

    } finally {
      this.busy = false;
    }
  }

  // ── Private: fullscreen capture ────────────────────────────────────────────────

  private async captureFullscreenInternal(
    display: Electron.Display,
    options: CaptureOptions,
    t0:      number,
  ): Promise<CaptureResult> {
    const captureStart = performance.now();
    const { nativeImage: img, scaleFactor } = await this.service.captureDisplay(display);
    const captureMs = Math.round(performance.now() - captureStart);

    const { width: nW, height: nH } = img.getSize();

    const processOpts: ProcessorOptions = {
      quality:     options.quality     ?? 'balanced',
      format:      options.format,
      jpegQuality: options.jpegQuality,
      maxWidth:    options.maxWidth,
      maxHeight:   options.maxHeight,
      scaleFactor,
    };

    const processed = await this.processor.process(img, processOpts);
    const totalMs   = Math.round(performance.now() - t0);

    return {
      imageBase64:  processed.buffer.toString('base64'),
      mimeType:     processed.mimeType,
      width:        processed.width,
      height:       processed.height,
      nativeWidth:  processed.nativeWidth,
      nativeHeight: processed.nativeHeight,
      displayId:    display.id,
      scaleFactor,
      region:       { x: 0, y: 0, width: processed.width, height: processed.height },
      timing:       { captureMs, processMs: processed.processMs, totalMs },
      quality:      options.quality ?? 'balanced',
    };
  }

  // ── Private: region capture ────────────────────────────────────────────────────

  private async captureRegionInternal(
    display: Electron.Display,
    options: CaptureOptions,
    t0:      number,
  ): Promise<CaptureResult> {
    // Step A: full-display capture first (needed as the selector backdrop)
    const captureStart = performance.now();
    const { nativeImage: fullImg, scaleFactor } = await this.service.captureDisplay(display);
    const captureMs = Math.round(performance.now() - captureStart);

    // Step B: Get region — either provided in options or via interactive selector
    let region: CaptureRegion | null = options.region ?? null;

    if (region === null) {
      // Show selector overlay with full-display screenshot as background
      const screenshot = fullImg.toPNG().toString('base64');
      region = await this.regionSelector.selectRegion(screenshot, display, this.theme);

      if (region === null) {
        // User cancelled — propagate as a typed error so callers can distinguish
        throw new CaptureError('REGION_CANCELLED', 'Region selection cancelled by user', true);
      }
    }

    // Step C: Crop to region — convert logical → native pixels
    const cropNative = {
      x:      Math.round(region.x      * scaleFactor),
      y:      Math.round(region.y      * scaleFactor),
      width:  Math.round(region.width  * scaleFactor),
      height: Math.round(region.height * scaleFactor),
    };

    const processOpts: ProcessorOptions = {
      quality:     options.quality     ?? 'ocr',   // default 'ocr' for region captures
      format:      options.format,
      jpegQuality: options.jpegQuality,
      maxWidth:    options.maxWidth,
      maxHeight:   options.maxHeight,
      cropNative,
      scaleFactor,
    };

    const processed = await this.processor.process(fullImg, processOpts);
    const totalMs   = Math.round(performance.now() - t0);

    return {
      imageBase64:  processed.buffer.toString('base64'),
      mimeType:     processed.mimeType,
      width:        processed.width,
      height:       processed.height,
      nativeWidth:  processed.nativeWidth,
      nativeHeight: processed.nativeHeight,
      displayId:    display.id,
      scaleFactor,
      region,
      timing:       { captureMs, processMs: processed.processMs, totalMs },
      quality:      options.quality ?? 'ocr',
    };
  }

  // ── Convenience methods ────────────────────────────────────────────────────────

  /**
   * Capture the full display nearest the cursor, or a specific display by id.
   *
   * @param displayId – Optional Electron Display.id; defaults to display-near-cursor.
   * @param quality   – Quality preset; defaults to 'balanced'.
   */
  async captureFullscreen(
    displayId?: number,
    quality?:   CaptureOptions['quality'],
  ): Promise<CaptureResult> {
    return this.capture({ mode: 'fullscreen', displayId, quality });
  }

  /**
   * Capture a user-drawn region of the display nearest the cursor, or a
   * specific display by id.
   *
   * @returns The captured region result, or `null` if the user cancelled.
   */
  async captureRegion(displayId?: number): Promise<CaptureResult | null> {
    try {
      return await this.capture({ mode: 'region', displayId });
    } catch (err) {
      if (err instanceof CaptureError && err.code === 'REGION_CANCELLED') {
        return null;
      }
      throw err;
    }
  }

  /**
   * Returns metadata for all connected displays.
   */
  async getDisplays(): Promise<DisplayInfo[]> {
    return this.service.getAllDisplays();
  }

  /**
   * Returns the current screen-recording permission status.
   */
  async checkPermission(): Promise<PermissionStatus> {
    return this.permissions.check();
  }

  /**
   * Opens the OS permission settings so the user can grant screen recording.
   * On macOS this opens System Settings → Privacy → Screen Recording.
   * On Windows / Linux this is a no-op (permission is implicit).
   */
  async requestPermission(): Promise<void> {
    return this.permissions.request();
  }

  // ── Teardown ──────────────────────────────────────────────────────────────────

  /**
   * Release all resources held by the manager.
   * Call during the `before-quit` event or when the window is about to close.
   */
  destroy(): void {
    this.service.destroy();
    this.cache.invalidate();
    this.removeAllListeners();
  }
}
