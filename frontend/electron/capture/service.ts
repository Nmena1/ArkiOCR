/**
 * ARKI Capture Engine — Raw Capture Service
 *
 * Wraps Electron's desktopCapturer with source pre-warming to achieve
 * sub-150ms capture latency. Sources are fetched eagerly and cached for
 * SOURCE_CACHE_TTL_MS; every capture that lands within that window is free.
 */

import {
  desktopCapturer,
  screen,
  type Display,
  type DesktopCapturerSource,
  nativeImage,
  type NativeImage,
} from 'electron';

import type { DisplayInfo, SourceCacheEntry } from './types';
import { CaptureError } from './types';

export class CaptureRawService {
  private readonly isDev: boolean;

  private sourceCache: SourceCacheEntry | null = null;
  private sourceWarmTimer: NodeJS.Timeout | null = null;

  /** Cached sources remain valid for this many milliseconds. */
  private readonly SOURCE_CACHE_TTL_MS = 800;

  /** Interval between proactive re-warm calls. Must be < SOURCE_CACHE_TTL_MS. */
  private readonly WARM_INTERVAL_MS = 600;

  constructor(isDev: boolean) {
    this.isDev = isDev;
  }

  // ── Source pre-warming ────────────────────────────────────────────────────

  /**
   * Eagerly fetches sources and stores them in the cache so the next capture
   * call can skip the cold getSources() round-trip (~50-100ms on macOS).
   *
   * Call once on initialization and once again after each capture completes.
   * The method schedules its own next invocation automatically.
   */
  async warmSources(thumbW: number, thumbH: number): Promise<void> {
    // Cancel any pending warm-up before scheduling a fresh one.
    if (this.sourceWarmTimer !== null) {
      clearTimeout(this.sourceWarmTimer);
      this.sourceWarmTimer = null;
    }

    try {
      const t0 = Date.now();
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: thumbW, height: thumbH },
        fetchWindowIcons: false,
      });

      this.sourceCache = {
        sources,
        capturedAt: Date.now(),
        thumbW,
        thumbH,
      };

      if (this.isDev) {
        console.log(
          `[CaptureService] warmSources: ${Date.now() - t0}ms, ` +
          `count=${sources.length}, thumbSize=${thumbW}×${thumbH}`
        );
      }
    } catch (err) {
      if (this.isDev) {
        console.warn('[CaptureService] warmSources failed:', err);
      }
      // Non-fatal: the next capture will fetch fresh sources.
    }

    // Schedule the next proactive warm-up.
    this.sourceWarmTimer = setTimeout(
      () => { void this.warmSources(thumbW, thumbH); },
      this.WARM_INTERVAL_MS
    );
  }

  /**
   * Returns cached sources if they are still within TTL and match the requested
   * thumbnail dimensions; otherwise performs a fresh getSources() call.
   */
  private async getSources(
    thumbW: number,
    thumbH: number
  ): Promise<DesktopCapturerSource[]> {
    const now = Date.now();

    if (
      this.sourceCache !== null &&
      now - this.sourceCache.capturedAt < this.SOURCE_CACHE_TTL_MS &&
      this.sourceCache.thumbW === thumbW &&
      this.sourceCache.thumbH === thumbH
    ) {
      if (this.isDev) {
        console.log(
          `[CaptureService] Using cached sources ` +
          `(age=${now - this.sourceCache.capturedAt}ms)`
        );
      }
      return this.sourceCache.sources;
    }

    const t0 = Date.now();
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: thumbW, height: thumbH },
      fetchWindowIcons: false,
    });

    this.sourceCache = { sources, capturedAt: Date.now(), thumbW, thumbH };

    if (this.isDev) {
      console.log(
        `[CaptureService] Sources fetched in ${Date.now() - t0}ms, ` +
        `count=${sources.length}`
      );
    }

    return sources;
  }

  // ── Core capture ──────────────────────────────────────────────────────────

  /**
   * Captures a single display and returns the raw NativeImage along with
   * provenance metadata.
   *
   * @param display  - Electron Display object for the target monitor.
   * @param opts     - Optional thumbnail size override (defaults to native res).
   */
  async captureDisplay(
    display: Display,
    opts: {
      thumbnailSize?: { width: number; height: number };
    } = {}
  ): Promise<{
    nativeImage: NativeImage;
    source: DesktopCapturerSource;
    scaleFactor: number;
  }> {
    const sf = display.scaleFactor;

    // Use native (physical) resolution so the thumbnail is full-quality.
    const nativeW = opts.thumbnailSize?.width  ?? Math.round(display.bounds.width  * sf);
    const nativeH = opts.thumbnailSize?.height ?? Math.round(display.bounds.height * sf);

    let sources: DesktopCapturerSource[];
    try {
      sources = await this.getSources(nativeW, nativeH);
    } catch (err) {
      throw new CaptureError(
        'CAPTURE_FAILED',
        `desktopCapturer.getSources() failed: ${(err as Error).message}`,
        true
      );
    }

    const source = this.matchSource(sources, display);

    if (source === undefined) {
      throw new CaptureError(
        'NO_SOURCE_FOUND',
        `No desktopCapturer source matched display ${display.id} ` +
        `(available ids: ${sources.map(s => s.id).join(', ')})`,
        true
      );
    }

    const img = source.thumbnail;

    // Sanity-check: Electron may return an empty image on permission failure.
    const size = img.getSize();
    if (size.width === 0 || size.height === 0) {
      throw new CaptureError(
        'EMPTY_CAPTURE',
        `Source "${source.id}" returned a 0×0 image. ` +
        'Screen recording permission may have been revoked.',
        false
      );
    }

    if (this.isDev) {
      console.log(
        `[CaptureService] captureDisplay: source="${source.id}" ` +
        `size=${size.width}×${size.height} sf=${sf}`
      );
    }

    return { nativeImage: img, source, scaleFactor: sf };
  }

  // ── Display helpers ───────────────────────────────────────────────────────

  /** Returns the display that currently contains the mouse cursor. */
  getDisplayNearCursor(): Display {
    return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  }

  /**
   * Resolves a Display by id. Falls back to the primary display if the id is
   * not provided or not found among connected monitors.
   */
  resolveDisplay(displayId?: number): Display {
    if (displayId === undefined) {
      return screen.getPrimaryDisplay();
    }
    return (
      screen.getAllDisplays().find(d => d.id === displayId) ??
      screen.getPrimaryDisplay()
    );
  }

  /** Returns structured metadata for all connected displays. */
  getAllDisplays(): DisplayInfo[] {
    const primaryId = screen.getPrimaryDisplay().id;

    return screen.getAllDisplays().map(d => ({
      id:          d.id,
      label:       d.label || `Display ${d.id}`,
      bounds:      d.bounds,
      workArea:    d.workArea,
      scaleFactor: d.scaleFactor,
      rotation:    d.rotation,
      isPrimary:   d.id === primaryId,
    }));
  }

  // ── Source matching ───────────────────────────────────────────────────────

  /**
   * Matches a desktopCapturer source to an Electron Display using a 5-step
   * cascade that covers the quirks of each OS.
   *
   * Step 1: display_id string match  — most reliable on macOS Ventura+
   * Step 2: exact "screen:<id>:0"   — common Windows format
   * Step 3: id prefix "screen:<id>" — catches edge variants
   * Step 4: array-index match       — reliable on Windows / Linux
   * Step 5: first screen source     — single-monitor fallback
   */
  private matchSource(
    sources: DesktopCapturerSource[],
    display: Display
  ): DesktopCapturerSource | undefined {
    const screenSources = sources.filter(s => s.id.startsWith('screen:'));
    const allDisplays   = screen.getAllDisplays();
    const idx           = allDisplays.findIndex(d => d.id === display.id);

    // Step 1 — display_id property (macOS)
    const byDisplayId = screenSources.find(
      s => s.display_id === String(display.id)
    );
    if (byDisplayId !== undefined) return byDisplayId;

    // Step 2 — exact id "screen:<displayId>:0" (Windows)
    const byExact = screenSources.find(
      s => s.id === `screen:${display.id}:0`
    );
    if (byExact !== undefined) return byExact;

    // Step 3 — prefix "screen:<displayId>" (edge cases)
    const byPrefix = screenSources.find(
      s => s.id.startsWith(`screen:${display.id}`)
    );
    if (byPrefix !== undefined) return byPrefix;

    // Step 4 — positional match by display index (Windows / Linux)
    if (idx >= 0 && screenSources[idx] !== undefined) {
      return screenSources[idx];
    }

    // Step 5 — single-monitor fallback
    return screenSources[0];
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /**
   * Cancels the warm-up timer and clears the source cache.
   * Call when the application is about to quit or the service is torn down.
   */
  destroy(): void {
    if (this.sourceWarmTimer !== null) {
      clearTimeout(this.sourceWarmTimer);
      this.sourceWarmTimer = null;
    }
    this.sourceCache = null;

    if (this.isDev) {
      console.log('[CaptureService] destroyed');
    }
  }
}
