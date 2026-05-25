/**
 * ARKI Capture Engine — Public API Barrel
 *
 * Single import point for every consumer of the capture subsystem.
 *
 * What IS exported (public surface):
 *   - CaptureManager          — main orchestrator (instantiate once, in main.ts)
 *   - registerCaptureIpc      — wire up ipcMain handlers
 *   - unregisterCaptureIpc    — remove ipcMain handlers (teardown / tests)
 *   - All shared types & CaptureError class
 *
 * What is NOT exported (implementation details, subject to change):
 *   - CaptureRawService       — desktopCapturer wrapper
 *   - ImageProcessor          — nativeImage pipeline
 *   - CaptureCache            — result deduplication cache
 *   - PermissionManager       — OS permission abstraction
 *   - RegionSelector          — overlay BrowserWindow
 *
 * Example (main.ts):
 *   import { CaptureManager, registerCaptureIpc } from './capture';
 *
 *   const manager = new CaptureManager({ isDev, preloadPath, htmlPath });
 *   app.whenReady().then(async () => {
 *     await manager.initialize();
 *     registerCaptureIpc(manager);
 *   });
 *   app.on('before-quit', () => {
 *     unregisterCaptureIpc();
 *     manager.destroy();
 *   });
 */

// ── Public classes ─────────────────────────────────────────────────────────────

export { CaptureManager }                              from './manager';
export { registerCaptureIpc, unregisterCaptureIpc }   from './ipc-handlers';

// ── Public types ───────────────────────────────────────────────────────────────

export type {
  CaptureOptions,
  CaptureResult,
  CaptureRegion,
  DisplayInfo,
  PermissionStatus,
  ProcessedImage,
  CaptureErrorCode,
  SelectorInitPayload,
  RegionConfirmedPayload,
} from './types';

// CaptureError is a class (not just a type) — consumers need it for
// `instanceof` checks and for constructing errors in tests.
export { CaptureError } from './types';
