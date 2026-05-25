/**
 * ARKI — CaptureManager
 *
 * Responsibilities:
 * - Enumerate monitors (screen.getAllDisplays)
 * - Check / request macOS screen-recording permission
 * - Full-screen capture via desktopCapturer (<80 ms target)
 * - Region capture: full capture → transparent selector window → nativeImage.crop()
 * - Cross-platform: macOS (panel-level overlay), Windows (WASAPI-safe), Linux (X11/Wayland)
 *
 * Pattern: singleton instantiated in main.ts, registers all IPC handlers.
 *
 * IPC surface (all validated in preload allowlists):
 *   handle  capture:get-displays
 *   handle  capture:check-permission
 *   handle  capture:request-permission
 *   handle  capture:fullscreen      (displayId?: number) → CaptureResult
 *   handle  capture:region          (displayId?: number) → CaptureResult | null
 *   on      capture:region-confirmed  { x, y, width, height } (logical px)
 *   on      capture:region-cancelled
 */

import {
  BrowserWindow,
  desktopCapturer,
  ipcMain,
  nativeImage,
  screen,
  shell,
  systemPreferences,
  type Display,
  type DesktopCapturerSource,
} from 'electron';
import * as path from 'path';

// ── Public types (mirrored in src/types/capture.types.ts) ─────────────────────

export interface DisplayInfo {
  id: number;
  label: string;
  bounds: { x: number; y: number; width: number; height: number };
  workArea: { x: number; y: number; width: number; height: number };
  scaleFactor: number;
  rotation: number;
  isPrimary: boolean;
}

export interface CaptureRegion {
  x: number;       // logical px (origin = display top-left)
  y: number;
  width: number;
  height: number;
  displayId: number;
}

export interface CaptureResult {
  imageBase64: string;
  mimeType: 'image/png';
  region: CaptureRegion;
  displayId: number;
  scaleFactor: number;
  captureMs: number;
  width: number;   // native px
  height: number;  // native px
}

export type CaptureMode       = 'fullscreen' | 'region';
export type PermissionStatus  = 'granted' | 'denied' | 'not-determined' | 'restricted' | 'unknown';

// ── Internal ──────────────────────────────────────────────────────────────────

interface SelectorInitPayload {
  screenshot: string;      // base64 PNG (full display, native res)
  displayBounds: { x: number; y: number; width: number; height: number };
  scaleFactor: number;
}

// ── CaptureManager ────────────────────────────────────────────────────────────

export class CaptureManager {
  /** Active selector windows keyed by display id */
  private readonly selectorWindows = new Map<number, BrowserWindow>();
  private captureInProgress = false;

  constructor(
    private readonly isDev: boolean,
    private readonly rendererUrl: string | undefined,
    private readonly preloadPath: string,
  ) {
    this.registerIpcHandlers();
  }

  // ── Permission ───────────────────────────────────────────────────────────────

  async checkPermission(): Promise<PermissionStatus> {
    if (process.platform !== 'darwin') return 'granted';
    try {
      const status = systemPreferences.getMediaAccessStatus('screen');
      return status as PermissionStatus;
    } catch {
      return 'unknown';
    }
  }

  async requestPermission(): Promise<PermissionStatus> {
    if (process.platform !== 'darwin') return 'granted';
    // Open macOS System Preferences → Privacy → Screen Recording
    await shell.openExternal(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
    );
    // Status won't change until user acts; caller should re-poll
    return this.checkPermission();
  }

  // ── Display enumeration ───────────────────────────────────────────────────────

  getDisplays(): DisplayInfo[] {
    const primary = screen.getPrimaryDisplay();
    return screen.getAllDisplays().map((d): DisplayInfo => ({
      id:          d.id,
      label:       d.label || `Display ${d.id}`,
      bounds:      d.bounds,
      workArea:    d.workArea,
      scaleFactor: d.scaleFactor,
      rotation:    d.rotation ?? 0,
      isPrimary:   d.id === primary.id,
    }));
  }

  // ── Full-screen capture ───────────────────────────────────────────────────────

  /**
   * Capture an entire display.
   * Uses desktopCapturer at native (HiDPI) resolution.
   * Target: < 80 ms on a 1080p display.
   */
  async captureFullScreen(displayId?: number): Promise<CaptureResult> {
    const t0 = performance.now();

    const perm = await this.checkPermission();
    if (perm === 'denied' || perm === 'restricted') {
      throw new Error(
        'Screen recording permission denied. ' +
        'Please grant access in System Preferences → Security & Privacy → Screen Recording.',
      );
    }

    const display = this.resolveDisplay(displayId);
    const { width, height, scaleFactor } = this.nativeResolution(display);

    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width, height },
      fetchWindowIcons: false,
    });

    const source = this.matchSource(sources, display);
    if (!source) {
      throw new Error(
        `desktopCapturer: no source matched display ${display.id}. ` +
        `Available: ${sources.map(s => `${s.id}(display_id=${s.display_id})`).join(', ')}`,
      );
    }

    const img   = source.thumbnail;
    const size  = img.getSize();
    const b64   = img.toPNG().toString('base64');
    const ms    = Math.round(performance.now() - t0);

    console.log(`[CaptureManager] fullscreen ${size.width}×${size.height} in ${ms}ms`);

    return {
      imageBase64: b64,
      mimeType:    'image/png',
      region:      { x: 0, y: 0, width: size.width, height: size.height, displayId: display.id },
      displayId:   display.id,
      scaleFactor,
      captureMs:   ms,
      width:       size.width,
      height:      size.height,
    };
  }

  // ── Region capture ────────────────────────────────────────────────────────────

  /**
   * Interactive region capture:
   *  1. Full-screen capture (fast background grab)
   *  2. Open transparent selector overlay
   *  3. User drags region (or presses ESC to cancel)
   *  4. Crop captured image to selected region
   *
   * Returns null if cancelled.
   */
  async captureRegion(displayId?: number): Promise<CaptureResult | null> {
    if (this.captureInProgress) {
      console.warn('[CaptureManager] captureRegion: already in progress, ignoring');
      return null;
    }
    this.captureInProgress = true;

    try {
      const t0 = performance.now();

      // 1. Grab full screen first — user sees no delay
      const full = await this.captureFullScreen(displayId);
      const display = this.resolveDisplay(full.displayId);

      // 2. Show selection UI
      const region = await this.showSelectorWindow(display, full.imageBase64);
      if (!region) return null; // Cancelled

      // 3. Crop — coordinates are logical px; multiply by scaleFactor for native
      const sf = display.scaleFactor;
      const cropX = Math.max(0, Math.round(region.x      * sf));
      const cropY = Math.max(0, Math.round(region.y      * sf));
      const cropW = Math.max(1, Math.round(region.width  * sf));
      const cropH = Math.max(1, Math.round(region.height * sf));

      // Clamp to image bounds
      const clampedW = Math.min(cropW, full.width  - cropX);
      const clampedH = Math.min(cropH, full.height - cropY);

      const cropped = nativeImage
        .createFromBuffer(Buffer.from(full.imageBase64, 'base64'))
        .crop({ x: cropX, y: cropY, width: clampedW, height: clampedH });

      const pngBuf   = cropped.toPNG();
      const totalMs  = Math.round(performance.now() - t0);

      console.log(`[CaptureManager] region ${clampedW}×${clampedH} (logical ${region.width}×${region.height}) in ${totalMs}ms`);

      return {
        imageBase64: pngBuf.toString('base64'),
        mimeType:    'image/png',
        region:      { ...region, displayId: display.id },
        displayId:   display.id,
        scaleFactor: sf,
        captureMs:   totalMs,
        width:       clampedW,
        height:      clampedH,
      };
    } finally {
      this.captureInProgress = false;
    }
  }

  // ── Selector window ───────────────────────────────────────────────────────────

  private showSelectorWindow(
    display: Display,
    screenshotBase64: string,
  ): Promise<{ x: number; y: number; width: number; height: number } | null> {
    return new Promise<{ x: number; y: number; width: number; height: number } | null>((resolve) => {

      // Close any existing selector on this display
      const existing = this.selectorWindows.get(display.id);
      if (existing && !existing.isDestroyed()) existing.close();

      const win = new BrowserWindow({
        // Position the window exactly over the target display
        x:      display.bounds.x,
        y:      display.bounds.y,
        width:  display.bounds.width,
        height: display.bounds.height,

        // Appearance
        frame:       false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable:   false,
        movable:     false,
        focusable:   true,
        hasShadow:   false,

        // macOS: use 'panel' type so it overlays fullscreen apps
        ...(process.platform === 'darwin' && { type: 'panel' as const }),

        // Linux: avoid fullscreen flag which causes issues on some WMs
        ...(process.platform !== 'linux' && { fullscreen: false }),

        webPreferences: {
          preload:                    this.preloadPath,
          nodeIntegration:            false,
          contextIsolation:           true,
          sandbox:                    true,
          webSecurity:                true,
          allowRunningInsecureContent: false,
        },
      });

      // Stay on top of everything (macOS: screen-saver level)
      win.setAlwaysOnTop(true, 'screen-saver');
      if (process.platform === 'darwin') {
        win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      }

      this.selectorWindows.set(display.id, win);

      // Load the React app with the capture-selector hash route
      const initPayload: SelectorInitPayload = {
        screenshot:    screenshotBase64,
        displayBounds: display.bounds,
        scaleFactor:   display.scaleFactor,
      };

      const onLoad = () => {
        win.webContents.send('capture:selector-init', initPayload);
        win.show();
        win.focus();
      };

      if (this.isDev && this.rendererUrl) {
        win.loadURL(`${this.rendererUrl}?selector=1#/capture-selector`).then(onLoad);
      } else {
        win.loadFile(
          path.join(path.dirname(this.preloadPath), '..', 'renderer', 'index.html'),
          { hash: '/capture-selector', query: { selector: '1' } },
        ).then(onLoad);
      }

      // ESC anywhere in the window → cancel
      win.webContents.on('before-input-event', (_evt, input) => {
        if (input.type === 'keyDown' && input.key === 'Escape') {
          cleanup(null);
        }
      });

      // ── One-shot IPC listeners ────────────────────────────────────────────────
      const onConfirmed = (
        _evt: Electron.IpcMainEvent,
        region: { x: number; y: number; width: number; height: number },
      ) => cleanup(region);

      const onCancelled = () => cleanup(null);

      ipcMain.once('capture:region-confirmed', onConfirmed);
      ipcMain.once('capture:region-cancelled', onCancelled);

      win.once('closed', () => cleanup(null));

      function cleanup(result: { x: number; y: number; width: number; height: number } | null) {
        ipcMain.removeListener('capture:region-confirmed', onConfirmed);
        ipcMain.removeListener('capture:region-cancelled', onCancelled);
        if (!win.isDestroyed()) win.close();
        resolve(result);
      }
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  private resolveDisplay(displayId?: number): Display {
    if (!displayId) return screen.getPrimaryDisplay();
    return screen.getAllDisplays().find(d => d.id === displayId)
      ?? screen.getPrimaryDisplay();
  }

  /** Native (HiDPI) resolution for a display */
  private nativeResolution(display: Display): { width: number; height: number; scaleFactor: number } {
    const sf = display.scaleFactor;
    return {
      width:       Math.round(display.bounds.width  * sf),
      height:      Math.round(display.bounds.height * sf),
      scaleFactor: sf,
    };
  }

  /**
   * Match a desktopCapturer source to a Display.
   *
   * Strategy (tried in order):
   *  1. source.display_id === String(display.id)   — works on macOS
   *  2. source.id starts with `screen:${display.id}`
   *  3. Screen source index matches display index   — fallback for Linux/Windows
   *  4. First screen source                        — last resort (single-monitor)
   */
  private matchSource(
    sources: DesktopCapturerSource[],
    display: Display,
  ): DesktopCapturerSource | undefined {
    const screenSources = sources.filter(s => s.id.startsWith('screen:'));
    const allDisplays   = screen.getAllDisplays();
    const displayIndex  = allDisplays.findIndex(d => d.id === display.id);

    return (
      screenSources.find(s => s.display_id === String(display.id)) ??
      screenSources.find(s => s.id === `screen:${display.id}:0`) ??
      screenSources.find(s => s.id.startsWith(`screen:${display.id}`)) ??
      (displayIndex >= 0 ? screenSources[displayIndex] : undefined) ??
      screenSources[0]
    );
  }

  // ── IPC handlers ──────────────────────────────────────────────────────────────

  private registerIpcHandlers(): void {
    // Enumerate displays
    ipcMain.handle('capture:get-displays', () => this.getDisplays());

    // Permission
    ipcMain.handle('capture:check-permission', () => this.checkPermission());
    ipcMain.handle('capture:request-permission', () => this.requestPermission());

    // Full-screen capture
    ipcMain.handle('capture:fullscreen', (_evt, displayId?: number) =>
      this.captureFullScreen(displayId),
    );

    // Region capture (opens selector window)
    ipcMain.handle('capture:region', (_evt, displayId?: number) =>
      this.captureRegion(displayId),
    );

    // NOTE: capture:region-confirmed and capture:region-cancelled are registered
    // as one-shot listeners inside showSelectorWindow() — not here — to avoid
    // accumulating stale handlers across multiple captures.
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────────

  destroy(): void {
    for (const win of this.selectorWindows.values()) {
      if (!win.isDestroyed()) win.close();
    }
    this.selectorWindows.clear();
    // Remove all ipcMain handlers registered by this instance
    ipcMain.removeHandler('capture:get-displays');
    ipcMain.removeHandler('capture:check-permission');
    ipcMain.removeHandler('capture:request-permission');
    ipcMain.removeHandler('capture:fullscreen');
    ipcMain.removeHandler('capture:region');
  }
}
