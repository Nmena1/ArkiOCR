/**
 * ARKI — Electron Preload Script (contextBridge)
 *
 * This is the ONLY bridge between the renderer process (React) and
 * the main process (Electron). ALL IPC must go through here.
 *
 * Security rules:
 * - Only expose what the renderer explicitly needs
 * - Never expose ipcRenderer directly
 * - Validate all data passing through the bridge
 * - No Node.js APIs exposed to renderer
 */

import { contextBridge, ipcRenderer } from 'electron';

// ── Type Definitions ──────────────────────────────────────────────────────────

type IpcListener = (...args: unknown[]) => void;

interface WindowControls {
  minimize: () => void;
  close: () => void;
  hide: () => void;
  setClickThrough: (enabled: boolean) => void;
  resize: (width: number, height: number) => void;
  move: (x: number, y: number) => void;
}

interface BackendAPI {
  health: () => Promise<{ ok: boolean; status: number }>;
}

interface AppAPI {
  info: () => Promise<{
    version: string;
    name: string;
    isDev: boolean;
    platform: string;
    backendUrl: string;
    websocketUrl: string;
  }>;
  openExternal: (url: string) => void;
}

interface EventBridge {
  onCaptureTrigger: (listener: IpcListener) => () => void;
  onAnalyzeTrigger: (listener: IpcListener) => () => void;
  onClearSession:   (listener: IpcListener) => () => void;
  removeAllListeners: (channel: string) => void;
}

// ── Allowed Channels (allowlist) ──────────────────────────────────────────────

const ALLOWED_SEND_CHANNELS = [
  'window:minimize',
  'window:close',
  'window:hide',
  'window:set-click-through',
  'window:resize',
  'window:move',
  'shell:open-external',
] as const;

const ALLOWED_INVOKE_CHANNELS = [
  'backend:health',
  'app:info',
] as const;

const ALLOWED_RECEIVE_CHANNELS = [
  'ipc:capture-trigger',
  'ipc:analyze-trigger',
  'ipc:clear-session',
] as const;

type SendChannel    = typeof ALLOWED_SEND_CHANNELS[number];
type InvokeChannel  = typeof ALLOWED_INVOKE_CHANNELS[number];
type ReceiveChannel = typeof ALLOWED_RECEIVE_CHANNELS[number];

// ── Validation helpers ────────────────────────────────────────────────────────

function assertValidSendChannel(channel: string): asserts channel is SendChannel {
  if (!(ALLOWED_SEND_CHANNELS as readonly string[]).includes(channel)) {
    throw new Error(`[ARKI Preload] Blocked send on channel: ${channel}`);
  }
}

function assertValidInvokeChannel(channel: string): asserts channel is InvokeChannel {
  if (!(ALLOWED_INVOKE_CHANNELS as readonly string[]).includes(channel)) {
    throw new Error(`[ARKI Preload] Blocked invoke on channel: ${channel}`);
  }
}

function assertValidReceiveChannel(channel: string): asserts channel is ReceiveChannel {
  if (!(ALLOWED_RECEIVE_CHANNELS as readonly string[]).includes(channel)) {
    throw new Error(`[ARKI Preload] Blocked receive on channel: ${channel}`);
  }
}

// ── Context Bridge API ────────────────────────────────────────────────────────

/**
 * Window controls — exposed to renderer as window.arki.window
 */
const windowControls: WindowControls = {
  minimize: () => ipcRenderer.send('window:minimize'),
  close:    () => ipcRenderer.send('window:close'),
  hide:     () => ipcRenderer.send('window:hide'),

  setClickThrough: (enabled: boolean) => {
    if (typeof enabled !== 'boolean') throw new TypeError('enabled must be boolean');
    ipcRenderer.send('window:set-click-through', enabled);
  },

  resize: (width: number, height: number) => {
    if (typeof width !== 'number' || typeof height !== 'number') {
      throw new TypeError('width and height must be numbers');
    }
    if (width < 200 || height < 100 || width > 2000 || height > 2000) {
      throw new RangeError('Width/height out of safe bounds');
    }
    ipcRenderer.send('window:resize', { width, height });
  },

  move: (x: number, y: number) => {
    if (typeof x !== 'number' || typeof y !== 'number') {
      throw new TypeError('x and y must be numbers');
    }
    ipcRenderer.send('window:move', { x, y });
  },
};

/**
 * Backend API — exposed as window.arki.backend
 */
const backendAPI: BackendAPI = {
  health: () => ipcRenderer.invoke('backend:health'),
};

/**
 * App API — exposed as window.arki.app
 */
const appAPI: AppAPI = {
  info: () => ipcRenderer.invoke('app:info'),

  openExternal: (url: string) => {
    if (typeof url !== 'string') throw new TypeError('url must be a string');
    // Validate URL format before passing to shell
    const parsed = new URL(url);
    if (!['https:', 'http:'].includes(parsed.protocol)) {
      throw new Error(`Blocked: unsafe protocol ${parsed.protocol}`);
    }
    ipcRenderer.send('shell:open-external', url);
  },
};

/**
 * Event bridge — main → renderer events
 * Returns an unsubscribe function for cleanup.
 */
const eventBridge: EventBridge = {
  onCaptureTrigger: (listener: IpcListener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => listener(...args);
    ipcRenderer.on('ipc:capture-trigger', wrapped);
    return () => ipcRenderer.removeListener('ipc:capture-trigger', wrapped);
  },

  onAnalyzeTrigger: (listener: IpcListener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => listener(...args);
    ipcRenderer.on('ipc:analyze-trigger', wrapped);
    return () => ipcRenderer.removeListener('ipc:analyze-trigger', wrapped);
  },

  onClearSession: (listener: IpcListener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => listener(...args);
    ipcRenderer.on('ipc:clear-session', wrapped);
    return () => ipcRenderer.removeListener('ipc:clear-session', wrapped);
  },

  removeAllListeners: (channel: string) => {
    assertValidReceiveChannel(channel);
    ipcRenderer.removeAllListeners(channel);
  },
};

/**
 * Low-level IPC — for advanced use cases with channel validation
 */
const ipcBridge = {
  send: (channel: string, ...args: unknown[]) => {
    assertValidSendChannel(channel);
    ipcRenderer.send(channel, ...args);
  },
  invoke: (channel: string, ...args: unknown[]) => {
    assertValidInvokeChannel(channel);
    return ipcRenderer.invoke(channel, ...args);
  },
};

// ── Expose to Renderer ────────────────────────────────────────────────────────

contextBridge.exposeInMainWorld('arki', {
  window:  windowControls,
  backend: backendAPI,
  app:     appAPI,
  events:  eventBridge,
  ipc:     ipcBridge,
});

// ── TypeScript declarations for renderer ─────────────────────────────────────
// This block is stripped at runtime but helps IDEs provide type hints
// The actual types are declared in src/types/electron.d.ts
