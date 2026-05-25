/**
 * ARKI — Electron Preload Script (contextBridge)
 *
 * The ONLY bridge between renderer (React) and main (Electron).
 * All IPC goes through here. No Node.js APIs exposed to renderer.
 *
 * Security:
 * - Strict per-category channel allowlists
 * - Input validation on every exposed method
 * - No raw ipcRenderer exposed
 */

import { contextBridge, ipcRenderer } from 'electron';

// ── Type aliases ──────────────────────────────────────────────────────────────

type IpcListener = (...args: unknown[]) => void;

// ── Allowlists ────────────────────────────────────────────────────────────────

const SEND_CHANNELS = [
  // Window
  'window:minimize',
  'window:close',
  'window:hide',
  'window:set-click-through',
  'window:resize',
  'window:move',
  // Shell
  'shell:open-external',
  // Capture (selector window → main)
  'capture:region-confirmed',
  'capture:region-cancelled',
] as const;

const INVOKE_CHANNELS = [
  // App
  'backend:health',
  'app:info',
  // Capture
  'capture:get-displays',
  'capture:check-permission',
  'capture:request-permission',
  'capture:fullscreen',
  'capture:region',
] as const;

const RECEIVE_CHANNELS = [
  // Legacy overlay triggers
  'ipc:capture-trigger',
  'ipc:analyze-trigger',
  'ipc:clear-session',
  // Capture (main → selector window)
  'capture:selector-init',
] as const;

type SendChannel    = typeof SEND_CHANNELS[number];
type InvokeChannel  = typeof INVOKE_CHANNELS[number];
type ReceiveChannel = typeof RECEIVE_CHANNELS[number];

// ── Validators ────────────────────────────────────────────────────────────────

function assertSend(ch: string): asserts ch is SendChannel {
  if (!(SEND_CHANNELS as readonly string[]).includes(ch))
    throw new Error(`[ARKI Preload] Blocked send: ${ch}`);
}
function assertInvoke(ch: string): asserts ch is InvokeChannel {
  if (!(INVOKE_CHANNELS as readonly string[]).includes(ch))
    throw new Error(`[ARKI Preload] Blocked invoke: ${ch}`);
}
function assertReceive(ch: string): asserts ch is ReceiveChannel {
  if (!(RECEIVE_CHANNELS as readonly string[]).includes(ch))
    throw new Error(`[ARKI Preload] Blocked receive: ${ch}`);
}

// ── Window controls ───────────────────────────────────────────────────────────

const windowAPI = {
  minimize: () => ipcRenderer.send('window:minimize'),
  close:    () => ipcRenderer.send('window:close'),
  hide:     () => ipcRenderer.send('window:hide'),

  setClickThrough: (enabled: boolean) => {
    if (typeof enabled !== 'boolean') throw new TypeError('enabled must be boolean');
    ipcRenderer.send('window:set-click-through', enabled);
  },

  resize: (width: number, height: number) => {
    if (typeof width !== 'number' || typeof height !== 'number')
      throw new TypeError('width and height must be numbers');
    if (width < 200 || height < 100 || width > 4096 || height > 4096)
      throw new RangeError('Dimensions out of safe bounds');
    ipcRenderer.send('window:resize', { width, height });
  },

  move: (x: number, y: number) => {
    if (typeof x !== 'number' || typeof y !== 'number')
      throw new TypeError('x and y must be numbers');
    ipcRenderer.send('window:move', { x, y });
  },
};

// ── Backend API ───────────────────────────────────────────────────────────────

const backendAPI = {
  health: () => ipcRenderer.invoke('backend:health'),
};

// ── App API ───────────────────────────────────────────────────────────────────

const appAPI = {
  info: (): Promise<{
    version: string; name: string; isDev: boolean;
    platform: string; backendUrl: string; websocketUrl: string;
  }> => ipcRenderer.invoke('app:info'),

  openExternal: (url: string) => {
    if (typeof url !== 'string') throw new TypeError('url must be a string');
    const parsed = new URL(url);
    if (!['https:', 'http:'].includes(parsed.protocol))
      throw new Error(`Blocked: unsafe protocol ${parsed.protocol}`);
    ipcRenderer.send('shell:open-external', url);
  },
};

// ── Capture API ───────────────────────────────────────────────────────────────

const captureAPI = {
  /** Get all connected displays */
  getDisplays: () => ipcRenderer.invoke('capture:get-displays'),

  /** macOS: check screen-recording permission */
  checkPermission: () => ipcRenderer.invoke('capture:check-permission'),

  /** macOS: open System Preferences → Screen Recording */
  requestPermission: () => ipcRenderer.invoke('capture:request-permission'),

  /** Full-screen capture of a display */
  captureFullscreen: (displayId?: number) =>
    ipcRenderer.invoke('capture:fullscreen', displayId),

  /** Interactive region capture (opens selector overlay) */
  captureRegion: (displayId?: number) =>
    ipcRenderer.invoke('capture:region', displayId),

  /**
   * Confirm region selection (called from CaptureSelector component).
   * Sends logical-pixel coordinates back to main process.
   */
  confirmRegion: (region: { x: number; y: number; width: number; height: number }) => {
    if (
      typeof region.x !== 'number' || typeof region.y !== 'number' ||
      typeof region.width !== 'number' || typeof region.height !== 'number'
    ) throw new TypeError('region fields must be numbers');
    if (region.width < 1 || region.height < 1)
      throw new RangeError('region dimensions must be positive');
    ipcRenderer.send('capture:region-confirmed', region);
  },

  /** Cancel region selection */
  cancelRegion: () => ipcRenderer.send('capture:region-cancelled'),

  /**
   * Subscribe to selector-init event (main → selector window).
   * Returns unsubscribe function.
   */
  onSelectorInit: (listener: (payload: unknown) => void): (() => void) => {
    const wrapped = (_e: Electron.IpcRendererEvent, payload: unknown) => listener(payload);
    ipcRenderer.on('capture:selector-init', wrapped);
    return () => ipcRenderer.removeListener('capture:selector-init', wrapped);
  },
};

// ── Event bridge (overlay window) ────────────────────────────────────────────

const eventBridge = {
  onCaptureTrigger: (listener: IpcListener): (() => void) => {
    const w = (_e: Electron.IpcRendererEvent, ...a: unknown[]) => listener(...a);
    ipcRenderer.on('ipc:capture-trigger', w);
    return () => ipcRenderer.removeListener('ipc:capture-trigger', w);
  },
  onAnalyzeTrigger: (listener: IpcListener): (() => void) => {
    const w = (_e: Electron.IpcRendererEvent, ...a: unknown[]) => listener(...a);
    ipcRenderer.on('ipc:analyze-trigger', w);
    return () => ipcRenderer.removeListener('ipc:analyze-trigger', w);
  },
  onClearSession: (listener: IpcListener): (() => void) => {
    const w = (_e: Electron.IpcRendererEvent, ...a: unknown[]) => listener(...a);
    ipcRenderer.on('ipc:clear-session', w);
    return () => ipcRenderer.removeListener('ipc:clear-session', w);
  },
  removeAllListeners: (channel: string) => {
    assertReceive(channel);
    ipcRenderer.removeAllListeners(channel);
  },
};

// ── Low-level IPC (advanced use) ─────────────────────────────────────────────

const ipcBridge = {
  send:   (channel: string, ...args: unknown[]) => { assertSend(channel);   ipcRenderer.send(channel, ...args); },
  invoke: (channel: string, ...args: unknown[]) => { assertInvoke(channel); return ipcRenderer.invoke(channel, ...args); },
};

// ── Expose ────────────────────────────────────────────────────────────────────

contextBridge.exposeInMainWorld('arki', {
  window:  windowAPI,
  backend: backendAPI,
  app:     appAPI,
  capture: captureAPI,
  events:  eventBridge,
  ipc:     ipcBridge,
});
