/**
 * ARKI Capture Engine — Region Selector
 *
 * Manages a short-lived, transparent BrowserWindow that lets the user draw a
 * rectangle over a screenshot of their display.  One window per selection —
 * created fresh, destroyed after the user confirms or cancels.
 *
 * IPC protocol:
 *   main  → renderer  capture:selector-init    SelectorInitPayload
 *   renderer → main   capture:region-confirmed RegionConfirmedPayload
 *   renderer → main   capture:region-cancelled (no payload)
 *
 * Security:
 *   - contextIsolation: true / sandbox: true / nodeIntegration: false
 *   - Every incoming IPC message is validated against the window's webContents.id
 *     before it is acted upon (drops spoofed messages from other windows)
 */

import {
  BrowserWindow,
  ipcMain,
  type Display,
  type IpcMainEvent,
} from 'electron';
import {
  CaptureError,
  type CaptureRegion,
  type RegionConfirmedPayload,
  type SelectorInitPayload,
} from './types';

// ── Constants ──────────────────────────────────────────────────────────────────

/** If the user does not interact within this window, reject with SELECTOR_TIMEOUT. */
const SELECTOR_TIMEOUT_MS = 60_000;

/** CSS exit-animation budget before we hard-close the window. */
const CLOSE_ANIMATION_MS = 150;

// ── RegionSelector ─────────────────────────────────────────────────────────────

export class RegionSelector {
  /**
   * @param isDev       – Enables verbose logging in development.
   * @param preloadPath – Absolute path to the compiled preload-region.js file.
   * @param htmlPath    – Absolute path to region-selector/index.html.
   */
  constructor(
    private readonly isDev:       boolean,
    private readonly preloadPath: string,
    private readonly htmlPath:    string,
  ) {}

  // ── Public API ───────────────────────────────────────────────────────────────

  /**
   * Display an overlay on `display` so the user can draw a region rectangle.
   *
   * @param screenshot – base64 PNG of the full display (used as the backdrop).
   * @param display    – Electron Display object for the target screen.
   * @param theme      – UI colour scheme forwarded to the renderer.
   *
   * @returns The selected region in logical pixels, or `null` if the user
   *          cancelled (ESC / clicking X / any cancel action in the renderer).
   *
   * @throws {CaptureError} code='SELECTOR_TIMEOUT' after 60 s of inactivity.
   */
  async selectRegion(
    screenshot: string,
    display:    Display,
    theme:      'dark' | 'light' = 'dark',
  ): Promise<CaptureRegion | null> {
    return new Promise<CaptureRegion | null>((resolve, reject) => {
      // ── 1. Create the overlay window ───────────────────────────────────────
      const win = this.createOverlayWindow(display);

      // ── 2. Shared cleanup ──────────────────────────────────────────────────
      let settled = false;   // prevents double-resolve

      const cleanup = (): void => {
        clearTimeout(timer);
        ipcMain.removeListener('capture:region-confirmed', onConfirm);
        ipcMain.removeListener('capture:region-cancelled', onCancel);

        if (!win.isDestroyed()) {
          win.hide();
          // Allow CSS exit animation to finish before hard-closing
          setTimeout(() => {
            if (!win.isDestroyed()) win.close();
          }, CLOSE_ANIMATION_MS);
        }
      };

      // ── 3. Timeout guard ───────────────────────────────────────────────────
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new CaptureError('SELECTOR_TIMEOUT', 'Region selector timed out after 60s', true));
      }, SELECTOR_TIMEOUT_MS);

      // ── 4. IPC: region confirmed ───────────────────────────────────────────
      const onConfirm = (event: IpcMainEvent, payload: RegionConfirmedPayload): void => {
        // Security: only accept from our window's renderer
        if (event.sender.id !== win.webContents.id) return;
        if (settled) return;
        settled = true;

        if (this.isDev) {
          console.log(
            `[RegionSelector] confirmed  x:${payload.x} y:${payload.y} ` +
            `${payload.width}×${payload.height}  (logical px)`,
          );
        }

        cleanup();
        resolve({
          x:      payload.x,
          y:      payload.y,
          width:  payload.width,
          height: payload.height,
        });
      };

      // ── 5. IPC: region cancelled ───────────────────────────────────────────
      const onCancel = (event: IpcMainEvent): void => {
        if (event.sender.id !== win.webContents.id) return;
        if (settled) return;
        settled = true;

        if (this.isDev) {
          console.log('[RegionSelector] cancelled by user');
        }

        cleanup();
        resolve(null);
      };

      // Register IPC listeners before the window loads so we never miss an event
      ipcMain.on('capture:region-confirmed', onConfirm);
      ipcMain.on('capture:region-cancelled', onCancel);

      // ── 6. Guard: window closed by OS / external force ─────────────────────
      win.on('closed', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        ipcMain.removeListener('capture:region-confirmed', onConfirm);
        ipcMain.removeListener('capture:region-cancelled', onCancel);
        resolve(null);   // treat external close as cancel, not an error
      });

      // ── 7. Send init payload once the page is ready ────────────────────────
      win.webContents.once('did-finish-load', () => {
        const payload: SelectorInitPayload = {
          screenshot,
          displayBounds: {
            width:  display.bounds.width,
            height: display.bounds.height,
          },
          scaleFactor: display.scaleFactor,
          theme,
        };

        win.webContents.send('capture:selector-init', payload);

        if (this.isDev) {
          console.log(
            `[RegionSelector] init sent — display ${display.id} ` +
            `${display.bounds.width}×${display.bounds.height} @${display.scaleFactor}x`,
          );
        }

        win.show();
      });

      // ── 8. Load the selector HTML ──────────────────────────────────────────
      win.loadFile(this.htmlPath).catch((err: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(
          new CaptureError(
            'CAPTURE_FAILED',
            `Failed to load region-selector HTML: ${err.message}`,
            true,
          ),
        );
      });
    });
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  /**
   * Build and return a transparent, frameless, always-on-top overlay window
   * sized and positioned to cover the entire target display.
   */
  private createOverlayWindow(display: Display): BrowserWindow {
    const win = new BrowserWindow({
      // Position and size match the target display exactly
      x:           display.bounds.x,
      y:           display.bounds.y,
      width:       display.bounds.width,
      height:      display.bounds.height,

      // Appearance
      frame:       false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable:   false,
      movable:     false,
      hasShadow:   false,

      // Do not flash on open; we call show() after did-finish-load
      show:        false,

      webPreferences: {
        preload:         this.preloadPath,
        nodeIntegration: false,   // never true — security baseline
        contextIsolation: true,   // required for sandbox
        sandbox:          true,   // renderer cannot access Node APIs
      },

      // macOS: 'panel' type floats above fullscreen apps (Mission Control level)
      ...(process.platform === 'darwin' && {
        type: 'panel' as const,
      }),
    });

    // macOS: raise above fullscreen windows and make visible on all Spaces
    if (process.platform === 'darwin') {
      win.setAlwaysOnTop(true, 'screen-saver');
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    }

    return win;
  }
}
