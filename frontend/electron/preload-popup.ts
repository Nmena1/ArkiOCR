/**
 * ARKI — Preload script for the popup window (contextBridge)
 *
 * Minimal bridge between the popup renderer and the main process.
 * Exposes only the channels the popup needs — nothing more.
 *
 * Security:
 *   - nodeIntegration: false  (set in BrowserWindow webPreferences)
 *   - contextIsolation: true  (set in BrowserWindow webPreferences)
 *   - sandbox: true           (set in BrowserWindow webPreferences)
 *   - Strict per-direction channel allowlists
 *   - No raw ipcRenderer exposed to the renderer
 *
 * Exposed as window.arki_popup (separate namespace from the main window.arki
 * to avoid cross-window collisions).
 *
 * Channel allowlists:
 *   SEND_CHANNELS    — renderer → main (fire-and-forget)
 *   INVOKE_CHANNELS  — renderer → main (request/response via ipcRenderer.invoke)
 *   RECEIVE_CHANNELS — main → renderer (push events via ipcRenderer.on)
 */

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

// ── Types inlined (no imports from other files — preload runs in isolated context) ──

/**
 * Data pushed from main → popup renderer when a capture result is ready.
 * Must stay in sync with PopupData in popup-manager.ts.
 */
interface PopupData {
  ocr: {
    text:       string;
    confidence: number;
    provider:   string;
  };
  ai?: {
    response:   string;
    model:      string;
    tokensUsed: number;
  };
  mode:    'ocr-only' | 'ocr+ai';
  totalMs: number;
}

/**
 * Configuration delivered to the popup renderer on demand.
 * Kept minimal — only what the popup needs to render itself correctly.
 */
interface PopupConfig {
  theme:        'dark' | 'light';
  autoDismissMs: number;
  width:         number;
}

// ── Allowlists ─────────────────────────────────────────────────────────────────

const SEND_CHANNELS    = ['popup:resize', 'popup:close', 'popup:copy'] as const;
const INVOKE_CHANNELS  = ['popup:get-config']                          as const;
const RECEIVE_CHANNELS = ['popup:data']                                as const;

type SendChannel    = typeof SEND_CHANNELS[number];
type InvokeChannel  = typeof INVOKE_CHANNELS[number];
type ReceiveChannel = typeof RECEIVE_CHANNELS[number];

// ── Validators ─────────────────────────────────────────────────────────────────

function assertSend(ch: string): asserts ch is SendChannel {
  if (!(SEND_CHANNELS as readonly string[]).includes(ch))
    throw new Error(`[ARKI Popup Preload] Blocked send on disallowed channel: ${ch}`);
}

function assertInvoke(ch: string): asserts ch is InvokeChannel {
  if (!(INVOKE_CHANNELS as readonly string[]).includes(ch))
    throw new Error(`[ARKI Popup Preload] Blocked invoke on disallowed channel: ${ch}`);
}

function assertReceive(ch: string): asserts ch is ReceiveChannel {
  if (!(RECEIVE_CHANNELS as readonly string[]).includes(ch))
    throw new Error(`[ARKI Popup Preload] Blocked receive on disallowed channel: ${ch}`);
}

// ── Popup API ──────────────────────────────────────────────────────────────────

const popupAPI = {
  /**
   * Subscribe to incoming PopupData pushed from the main process.
   * Returns an unsubscribe function — call it in a cleanup/useEffect teardown.
   *
   * @example
   *   const unsub = window.arki_popup.onData((data) => renderPopup(data));
   *   // later:
   *   unsub();
   */
  onData: (listener: (data: PopupData) => void): (() => void) => {
    assertReceive('popup:data');
    const wrapped = (_evt: IpcRendererEvent, data: PopupData) => listener(data);
    ipcRenderer.on('popup:data', wrapped);
    return () => ipcRenderer.removeListener('popup:data', wrapped);
  },

  /**
   * Tell the main process the popup needs to be a different height.
   * Main calls BrowserWindow.setSize() with smooth animation.
   *
   * @param height  Target height in logical pixels. Main clamps to config.maxHeight.
   */
  resize: (height: number): void => {
    assertSend('popup:resize');
    if (typeof height !== 'number' || height < 1)
      throw new RangeError('[ARKI Popup Preload] resize: height must be a positive number');
    ipcRenderer.send('popup:resize', { height });
  },

  /**
   * Request the popup window to close.
   * Main hides the window and returns it to the pool.
   */
  close: (): void => {
    assertSend('popup:close');
    ipcRenderer.send('popup:close');
  },

  /**
   * Copy text to the system clipboard via the main process.
   * Using clipboard API from the main process avoids requiring
   * clipboard permissions in the sandboxed renderer.
   *
   * @param text  The string to place on the clipboard.
   */
  copy: (text: string): void => {
    assertSend('popup:copy');
    if (typeof text !== 'string')
      throw new TypeError('[ARKI Popup Preload] copy: text must be a string');
    ipcRenderer.send('popup:copy', text);
  },

  /**
   * Fetch popup configuration (theme, autoDismissMs, width) from main.
   * Used during popup renderer initialization to apply theming.
   */
  getConfig: (): Promise<PopupConfig> => {
    assertInvoke('popup:get-config');
    return ipcRenderer.invoke('popup:get-config') as Promise<PopupConfig>;
  },
};

// ── Expose ─────────────────────────────────────────────────────────────────────

contextBridge.exposeInMainWorld('arki_popup', popupAPI);

// ── Global type augmentation for the popup renderer (TypeScript consumers) ─────
// This declaration is only picked up by the TypeScript compiler when this file
// is in scope. It does NOT need to be re-declared in a .d.ts file as long as
// the popup renderer project references this preload.

declare global {
  interface Window {
    arki_popup: typeof popupAPI;
  }
}
