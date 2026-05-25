/**
 * ARKI Capture Engine — IPC Handlers
 *
 * Registers all capture-related ipcMain handlers so the renderer (and
 * preload bridges) can invoke capture functionality over Electron IPC.
 *
 * All channels use the `ipcMain.handle` / `ipcRenderer.invoke` pattern
 * (async request-response, no fire-and-forget).
 *
 * Channel catalogue:
 *   capture:fullscreen        → manager.captureFullscreen(displayId?, quality?)
 *   capture:region            → manager.captureRegion(displayId?)
 *   capture:displays          → manager.getDisplays()
 *   capture:check-permission  → manager.checkPermission()
 *   capture:request-permission→ manager.requestPermission()
 *
 * Display change events automatically invalidate the result cache so stale
 * frames are never served after a monitor is connected / disconnected / scaled.
 *
 * Usage:
 *   registerCaptureIpc(manager);   // call once, after manager.initialize()
 *   // … app lifecycle …
 *   unregisterCaptureIpc();        // call on before-quit or in tests
 */

import { ipcMain, screen } from 'electron';
import { CaptureManager }  from './manager';

// ── registerCaptureIpc ─────────────────────────────────────────────────────────

/**
 * Attach all capture IPC handlers to `ipcMain` and subscribe to display
 * change events from `screen`.
 *
 * Idempotent: calling it twice with the same manager is safe — Electron will
 * throw if a handler is already registered, so callers should call
 * `unregisterCaptureIpc()` first if they need to swap the manager instance.
 *
 * @param manager – A fully initialized `CaptureManager` instance.
 */
export function registerCaptureIpc(manager: CaptureManager): void {

  // ── Capture: full display ────────────────────────────────────────────────────

  ipcMain.handle(
    'capture:fullscreen',
    async (_event, displayId?: number, quality?: string) => {
      return manager.captureFullscreen(
        displayId,
        quality as Parameters<CaptureManager['captureFullscreen']>[1],
      );
    },
  );

  // ── Capture: interactive region ──────────────────────────────────────────────

  ipcMain.handle(
    'capture:region',
    async (_event, displayId?: number) => {
      // Returns null when the user cancels — the renderer should handle that gracefully.
      return manager.captureRegion(displayId);
    },
  );

  // ── Display enumeration ──────────────────────────────────────────────────────

  ipcMain.handle(
    'capture:displays',
    async () => {
      return manager.getDisplays();
    },
  );

  // ── Permission: query ────────────────────────────────────────────────────────

  ipcMain.handle(
    'capture:check-permission',
    async () => {
      return manager.checkPermission();
    },
  );

  // ── Permission: request / open settings ─────────────────────────────────────

  ipcMain.handle(
    'capture:request-permission',
    async () => {
      return manager.requestPermission();
    },
  );

  // ── Display change events → cache invalidation ───────────────────────────────
  //
  // The cache key includes the displayId; when monitors are added, removed, or
  // their metrics change (resolution, scaleFactor, rotation) any cached frame
  // may no longer be valid.  Clearing the cache ensures the next capture always
  // fetches a fresh frame from desktopCapturer.

  screen.on('display-added',          _onDisplayChanged);
  screen.on('display-removed',        _onDisplayChanged);
  screen.on('display-metrics-changed', _onDisplayChanged);

  function _onDisplayChanged(): void {
    // Access cache via bracket notation — it is a private field but accessible
    // this way within the same module for cache invalidation without exposing
    // the cache through the public API.
    (manager as unknown as { cache: { invalidate(): void } }).cache.invalidate();
  }
}

// ── unregisterCaptureIpc ───────────────────────────────────────────────────────

/**
 * Remove all capture IPC handlers from `ipcMain`.
 *
 * Call during `before-quit`, when hot-reloading in development, or in test
 * teardown to prevent handler conflicts across test cases.
 *
 * Note: display change listeners registered on `screen` during
 * `registerCaptureIpc` are cleaned up here via `screen.removeAllListeners`.
 * If your app registers other display-change listeners, remove only the
 * specific listeners instead and update this function accordingly.
 */
export function unregisterCaptureIpc(): void {
  const channels = [
    'capture:fullscreen',
    'capture:region',
    'capture:displays',
    'capture:check-permission',
    'capture:request-permission',
  ] as const;

  channels.forEach(ch => ipcMain.removeHandler(ch));

  // Electron does not support named-function removal via `screen.off` in all
  // versions, so we remove all display-change listeners.  In production this
  // is fine — display changes after quit are irrelevant.
  screen.removeAllListeners('display-added');
  screen.removeAllListeners('display-removed');
  screen.removeAllListeners('display-metrics-changed');
}
