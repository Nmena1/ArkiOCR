/**
 * ARKI — Electron Main Process
 *
 * Security: nodeIntegration:false, contextIsolation:true, sandbox:true
 * Pattern: Overlay window + dedicated capture selector window + Python backend
 */

import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  screen,
  shell,
  nativeTheme,
  Tray,
  Menu,
  nativeImage,
} from 'electron';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import { CaptureManager } from './capture-manager';

// ── Constants ─────────────────────────────────────────────────────────────────

const IS_DEV       = process.env.NODE_ENV === 'development' || !app.isPackaged;
const RENDERER_URL = IS_DEV ? 'http://localhost:5173' : undefined;
const PRELOAD_PATH = path.join(__dirname, 'preload.js');
const BACKEND_HOST = process.env.BACKEND_HOST || '127.0.0.1';
const BACKEND_PORT = parseInt(process.env.BACKEND_PORT || '8000', 10);

const HOTKEYS = {
  captureRegion:     process.env.HOTKEY_CAPTURE       || 'CommandOrControl+Shift+S',
  captureFullscreen: process.env.HOTKEY_FULLSCREEN    || 'CommandOrControl+Shift+F',
  toggleOverlay:     process.env.HOTKEY_TOGGLE_OVERLAY || 'CommandOrControl+Shift+A',
  analyze:           process.env.HOTKEY_ANALYZE       || 'CommandOrControl+Shift+X',
  clear:             process.env.HOTKEY_CLEAR         || 'CommandOrControl+Shift+C',
} as const;

// ── State ─────────────────────────────────────────────────────────────────────

let overlayWindow:    BrowserWindow | null = null;
let tray:             Tray | null = null;
let backendProcess:   ChildProcess | null = null;
let captureManager:   CaptureManager | null = null;
let isOverlayVisible  = true;

// ── Backend ───────────────────────────────────────────────────────────────────

function spawnBackend(): void {
  const backendDir = IS_DEV
    ? path.join(process.cwd(), '..', 'backend')
    : path.join(process.resourcesPath, 'backend');

  const pythonBin = IS_DEV
    ? 'python3'
    : path.join(backendDir, 'venv', 'bin', 'python3');

  const args = [
    '-m', 'uvicorn', 'main:app',
    '--host', BACKEND_HOST,
    '--port', String(BACKEND_PORT),
    '--log-level', IS_DEV ? 'debug' : 'warning',
  ];

  console.log(`[ARKI] Starting backend: ${pythonBin} ${args.join(' ')}`);

  backendProcess = spawn(pythonBin, args, {
    cwd: backendDir,
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  backendProcess.stdout?.on('data', (d: Buffer) => {
    if (IS_DEV) console.log(`[Backend] ${d.toString().trim()}`);
  });
  backendProcess.stderr?.on('data', (d: Buffer) => {
    const m = d.toString().trim();
    if (IS_DEV || m.toLowerCase().includes('error')) console.error(`[Backend ERR] ${m}`);
  });
  backendProcess.on('exit', (code, sig) => {
    console.warn(`[ARKI] Backend exited: code=${code} signal=${sig}`);
    backendProcess = null;
    if (code !== 0 && sig !== 'SIGTERM') {
      console.log('[ARKI] Restarting backend in 2s...');
      setTimeout(spawnBackend, 2000);
    }
  });
}

function killBackend(): void {
  backendProcess?.kill('SIGTERM');
  backendProcess = null;
}

// ── Overlay window ────────────────────────────────────────────────────────────

function createOverlayWindow(): BrowserWindow {
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;

  const ow = parseInt(process.env.OVERLAY_WIDTH  || '420', 10);
  const oh = parseInt(process.env.OVERLAY_HEIGHT || '600', 10);
  const pos = process.env.OVERLAY_POSITION || 'top-right';

  const positions: Record<string, { x: number; y: number }> = {
    'top-right':    { x: sw - ow - 20,     y: 20 },
    'top-left':     { x: 20,               y: 20 },
    'bottom-right': { x: sw - ow - 20,     y: sh - oh - 20 },
    'bottom-left':  { x: 20,               y: sh - oh - 20 },
    'center':       { x: Math.floor((sw - ow) / 2), y: Math.floor((sh - oh) / 2) },
  };
  const { x, y } = positions[pos] ?? positions['top-right'];

  const win = new BrowserWindow({
    width: ow, height: oh, x, y,
    frame:       false,
    transparent: true,
    alwaysOnTop: process.env.OVERLAY_ALWAYS_ON_TOP !== 'false',
    skipTaskbar: true,
    resizable:   true,
    movable:     true,
    hasShadow:   false,
    webPreferences: {
      preload:                    PRELOAD_PATH,
      nodeIntegration:            false,
      contextIsolation:           true,
      sandbox:                    true,
      webSecurity:                true,
      allowRunningInsecureContent: false,
      experimentalFeatures:       false,
      navigateOnDragDrop:         false,
    },
    ...(process.platform === 'darwin' && {
      vibrancy:          'under-window',
      visualEffectState: 'active',
      titleBarStyle:     'hiddenInset',
    }),
    ...(process.platform === 'win32' && {
      backgroundMaterial: 'acrylic',
    }),
  });

  if (IS_DEV && RENDERER_URL) {
    win.loadURL(RENDERER_URL);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  }

  win.webContents.on('will-navigate', (event, url) => {
    const p = new URL(url);
    const ok = IS_DEV ? ['localhost', '127.0.0.1'].includes(p.hostname) : false;
    if (!ok) { event.preventDefault(); shell.openExternal(url); }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  if (process.env.OVERLAY_CLICK_THROUGH === 'true') {
    win.setIgnoreMouseEvents(true, { forward: true });
  }
  win.on('closed', () => { overlayWindow = null; });

  return win;
}

// ── Tray ──────────────────────────────────────────────────────────────────────

function createTray(): Tray {
  const icon = nativeImage.createEmpty();
  const t = new Tray(icon);

  const menu = Menu.buildFromTemplate([
    { label: 'ARKI Desktop', enabled: false },
    { type: 'separator' },
    { label: 'Show/Hide Overlay',     accelerator: HOTKEYS.toggleOverlay,     click: toggleOverlay },
    { label: 'Capture Region',        accelerator: HOTKEYS.captureRegion,     click: triggerRegionCapture },
    { label: 'Capture Fullscreen',    accelerator: HOTKEYS.captureFullscreen, click: triggerFullscreenCapture },
    { type: 'separator' },
    { label: 'Open DevTools', visible: IS_DEV, click: () => overlayWindow?.webContents.openDevTools({ mode: 'detach' }) },
    { type: 'separator' },
    { label: 'Quit ARKI', click: () => app.quit() },
  ]);

  t.setToolTip('ARKI — AI Desktop Assistant');
  t.setContextMenu(menu);
  t.on('double-click', toggleOverlay);
  return t;
}

// ── Overlay controls ──────────────────────────────────────────────────────────

function toggleOverlay(): void {
  if (!overlayWindow) return;
  if (isOverlayVisible) {
    overlayWindow.hide();
    isOverlayVisible = false;
  } else {
    overlayWindow.show();
    overlayWindow.focus();
    isOverlayVisible = true;
  }
}

function triggerRegionCapture(): void {
  // Signal overlay to start region capture flow
  overlayWindow?.webContents.send('ipc:capture-trigger', { mode: 'region' });
  if (!isOverlayVisible) { overlayWindow?.show(); isOverlayVisible = true; }
}

function triggerFullscreenCapture(): void {
  overlayWindow?.webContents.send('ipc:capture-trigger', { mode: 'fullscreen' });
  if (!isOverlayVisible) { overlayWindow?.show(); isOverlayVisible = true; }
}

// ── Global hotkeys ────────────────────────────────────────────────────────────

function registerHotkeys(): void {
  const registrations = [
    [HOTKEYS.captureRegion,     triggerRegionCapture],
    [HOTKEYS.captureFullscreen, triggerFullscreenCapture],
    [HOTKEYS.toggleOverlay,     toggleOverlay],
    [HOTKEYS.analyze,           () => overlayWindow?.webContents.send('ipc:analyze-trigger')],
    [HOTKEYS.clear,             () => overlayWindow?.webContents.send('ipc:clear-session')],
  ] as const;

  let allOk = true;
  for (const [key, handler] of registrations) {
    const ok = globalShortcut.register(key, handler);
    if (!ok) { console.error(`[ARKI] Failed to register hotkey: ${key}`); allOk = false; }
  }

  if (allOk) {
    console.log('[ARKI] All hotkeys registered:');
    for (const [key] of registrations) console.log(`  ${key}`);
  }
}

// ── IPC handlers ──────────────────────────────────────────────────────────────

function registerIpcHandlers(): void {
  // Window controls
  ipcMain.on('window:minimize', () => overlayWindow?.minimize());
  ipcMain.on('window:close',    () => app.quit());
  ipcMain.on('window:hide',     () => { overlayWindow?.hide(); isOverlayVisible = false; });
  ipcMain.on('window:set-click-through', (_e, enabled: boolean) => {
    overlayWindow?.setIgnoreMouseEvents(enabled, { forward: true });
  });
  ipcMain.on('window:resize', (_e, { width, height }: { width: number; height: number }) => {
    overlayWindow?.setSize(width, height, true);
  });
  ipcMain.on('window:move', (_e, { x, y }: { x: number; y: number }) => {
    overlayWindow?.setPosition(x, y, true);
  });

  // Backend health
  ipcMain.handle('backend:health', async () => {
    try {
      const r = await fetch(`http://${BACKEND_HOST}:${BACKEND_PORT}/health`);
      return { ok: r.ok, status: r.status };
    } catch {
      return { ok: false, status: 0 };
    }
  });

  // App info
  ipcMain.handle('app:info', () => ({
    version:      app.getVersion(),
    name:         app.getName(),
    isDev:        IS_DEV,
    platform:     process.platform,
    backendUrl:   `http://${BACKEND_HOST}:${BACKEND_PORT}`,
    websocketUrl: `ws://${BACKEND_HOST}:${process.env.WEBSOCKET_PORT || '8765'}`,
  }));

  // External URLs
  ipcMain.on('shell:open-external', (_e, url: string) => {
    const p = new URL(url);
    if (['https:', 'http:'].includes(p.protocol)) shell.openExternal(url);
  });
}

// ── App lifecycle ─────────────────────────────────────────────────────────────

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); process.exit(0); }

app.on('second-instance', () => {
  if (overlayWindow?.isMinimized()) overlayWindow.restore();
  overlayWindow?.focus();
});

nativeTheme.themeSource = 'dark';

app.whenReady().then(() => {
  spawnBackend();

  overlayWindow = createOverlayWindow();
  tray          = createTray();

  // CaptureManager — must be created AFTER app.whenReady()
  captureManager = new CaptureManager(IS_DEV, RENDERER_URL, PRELOAD_PATH);

  registerHotkeys();
  registerIpcHandlers();

  console.log(`[ARKI] Ready — backend: http://${BACKEND_HOST}:${BACKEND_PORT}`);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (!overlayWindow) {
    overlayWindow = createOverlayWindow();
  } else {
    overlayWindow.show();
    isOverlayVisible = true;
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  captureManager?.destroy();
  killBackend();
});

app.on('certificate-error', (event, _wc, url, _err, _cert, cb) => {
  if (IS_DEV && (url.startsWith('https://localhost') || url.startsWith('https://127.0.0.1'))) {
    event.preventDefault(); cb(true);
  } else {
    cb(false);
  }
});
