/**
 * ARKI — CaptureService
 *
 * Headless screen capture service. No selection window — fully automatic.
 *
 * Modes:
 *   'fullscreen'    → Capture entire primary display (or specified displayId).
 *   'active-window' → Capture the display nearest the cursor position.
 *                     (Electron does not expose active-window bounds directly;
 *                      we capture the full display that currently owns the cursor.)
 *
 * Platform notes:
 *   - macOS: checks screen-recording permission via systemPreferences before any
 *            capture attempt. Returns a clear error if denied.
 *   - Windows / Linux: permission is always 'granted' (OS handles it at install).
 *
 * Source-matching strategy (4 steps):
 *   1. source.display_id === String(display.id)       — reliable on macOS
 *   2. source.id === `screen:${display.id}:0`         — common Electron/macOS format
 *   3. source.id.startsWith(`screen:${display.id}`)   — broader prefix match
 *   4. Screen-source index matches display index       — Windows / Linux fallback
 *   5. First available screen source                  — last resort (single monitor)
 *
 * Performance target: < 80 ms on a 1080p display.
 */

import {
  desktopCapturer,
  screen,
  shell,
  systemPreferences,
  type DesktopCapturerSource,
  type Display,
} from 'electron';

// ── Public types ───────────────────────────────────────────────────────────────

export interface CaptureResult {
  imageBase64: string;
  width:       number;
  height:      number;
  captureMs:   number;
  displayId:   number;
  scaleFactor: number;
}

export type CaptureMode      = 'active-window' | 'fullscreen';
export type PermissionStatus = 'granted' | 'denied' | 'not-determined' | 'restricted' | 'unknown';

// ── CaptureService ─────────────────────────────────────────────────────────────

export class CaptureService {

  // ── Permission ─────────────────────────────────────────────────────────────

  /**
   * Check macOS screen-recording permission status.
   * Returns 'granted' immediately on Windows / Linux.
   */
  async checkPermission(): Promise<PermissionStatus> {
    if (process.platform !== 'darwin') return 'granted';
    try {
      const status = systemPreferences.getMediaAccessStatus('screen');
      return status as PermissionStatus;
    } catch {
      return 'unknown';
    }
  }

  /**
   * Request screen-recording permission.
   *
   * On macOS: opens System Preferences → Privacy → Screen Recording so the user
   * can grant access. Returns the current status (caller must re-poll after user acts).
   *
   * On Windows / Linux: no-op, returns 'granted'.
   */
  async requestPermission(): Promise<PermissionStatus> {
    if (process.platform !== 'darwin') return 'granted';
    await shell.openExternal(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
    );
    return this.checkPermission();
  }

  // ── Capture ────────────────────────────────────────────────────────────────

  /**
   * Perform an automatic screen capture with no user interaction.
   *
   * @param mode       'fullscreen'    — capture primary (or specified) display.
   *                   'active-window' — capture the display nearest the cursor.
   * @param displayId  Optional: force a specific display by Electron display id.
   *                   Ignored when mode is 'active-window'.
   * @returns          CaptureResult with base64 PNG, dimensions, timing, and display metadata.
   * @throws           If screen-recording permission is denied, or no matching source found.
   */
  async capture(mode: CaptureMode, displayId?: number): Promise<CaptureResult> {
    const t0 = performance.now();

    // ── 1. Permission guard (macOS only) ─────────────────────────────────────
    const perm = await this.checkPermission();
    if (perm === 'denied' || perm === 'restricted') {
      throw new Error(
        `Screen recording permission ${perm}. ` +
        'Please grant access in System Preferences → Security & Privacy → Screen Recording, ' +
        'then restart ARKI.',
      );
    }

    // ── 2. Resolve target display ────────────────────────────────────────────
    const display = mode === 'active-window'
      ? this.displayNearCursor()
      : this.resolveDisplay(displayId);

    // ── 3. Compute native (HiDPI) resolution ─────────────────────────────────
    const { nativeWidth, nativeHeight, scaleFactor } = this.nativeResolution(display);

    // ── 4. getSources at native resolution ────────────────────────────────────
    const sources = await desktopCapturer.getSources({
      types:           ['screen'],
      thumbnailSize:   { width: nativeWidth, height: nativeHeight },
      fetchWindowIcons: false,
    });

    // ── 5. Match source → display ─────────────────────────────────────────────
    const source = this.matchSource(sources, display);
    if (!source) {
      throw new Error(
        `desktopCapturer: no screen source found for display ${display.id}. ` +
        `Available: [${sources.map(s => `${s.id}(display_id=${s.display_id})`).join(', ')}]`,
      );
    }

    // ── 6. Extract PNG → base64 ───────────────────────────────────────────────
    const img             = source.thumbnail;
    const { width, height } = img.getSize();
    const imageBase64     = img.toPNG().toString('base64');
    const captureMs       = Math.round(performance.now() - t0);

    console.log(
      `[CaptureService] ${mode} → display ${display.id} ${width}×${height}` +
      ` @${scaleFactor}x  ${captureMs}ms`,
    );

    return {
      imageBase64,
      width,
      height,
      captureMs,
      displayId:   display.id,
      scaleFactor,
    };
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Returns the display that contains the current cursor position.
   * Used for 'active-window' mode — closest approximation Electron allows without
   * native accessibility APIs.
   */
  private displayNearCursor(): Display {
    const cursor = screen.getCursorScreenPoint();
    return screen.getDisplayNearestPoint(cursor);
  }

  /**
   * Resolve a display by id, falling back to the primary display if not found.
   */
  private resolveDisplay(displayId?: number): Display {
    if (displayId === undefined) return screen.getPrimaryDisplay();
    return (
      screen.getAllDisplays().find(d => d.id === displayId) ??
      screen.getPrimaryDisplay()
    );
  }

  /**
   * Compute the native (physical pixel) dimensions for a display.
   * On HiDPI / Retina screens scaleFactor > 1, so logical bounds must be scaled up
   * before passing to desktopCapturer.getSources({ thumbnailSize }).
   */
  private nativeResolution(display: Display): {
    nativeWidth:  number;
    nativeHeight: number;
    scaleFactor:  number;
  } {
    const sf = display.scaleFactor;
    return {
      nativeWidth:  Math.round(display.bounds.width  * sf),
      nativeHeight: Math.round(display.bounds.height * sf),
      scaleFactor:  sf,
    };
  }

  /**
   * Match a desktopCapturer source to an Electron Display using a 4-step strategy.
   *
   * Step 1: display_id string match  → most reliable on macOS
   * Step 2: id exact `screen:<id>:0` → common macOS/Electron format
   * Step 3: id prefix match          → broader fallback
   * Step 4: array-index match        → Linux / Windows where display_id is unreliable
   * Step 5: first screen source      → last resort for single-monitor setups
   */
  private matchSource(
    sources: DesktopCapturerSource[],
    display: Display,
  ): DesktopCapturerSource | undefined {
    const screenSources = sources.filter(s => s.id.startsWith('screen:'));
    const allDisplays   = screen.getAllDisplays();
    const displayIndex  = allDisplays.findIndex(d => d.id === display.id);

    return (
      screenSources.find(s => s.display_id === String(display.id))         ??
      screenSources.find(s => s.id === `screen:${display.id}:0`)           ??
      screenSources.find(s => s.id.startsWith(`screen:${display.id}`))     ??
      (displayIndex >= 0 ? screenSources[displayIndex] : undefined)        ??
      screenSources[0]
    );
  }
}
