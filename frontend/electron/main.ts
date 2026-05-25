/**
 * ARKI — Electron Main Process
 *
 * Security: nodeIntegration:false, contextIsolation:true, sandbox:true
 * Pattern: Single BrowserWindow (overlay) + spawned Python backend
 * Hotkeys: GlobalShortcut for system-wide capture triggers
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
import * as fs from 'fs';

// ── Constants ─────────────────────────────────────────────────────────────────

const IS_DEV = process.env.NODE_ENV === 'development' || !app.isPackaged;
const RENDERER_URL = IS_DEV ? 'http://localhost:5173' : undefined;
const PRELOAD_PATH = path.join(__dirname, 'preload.js');
const BACKEND_HOST = process.env.BACKEND_HOST || '127.0.0.1';
const BACKEND_PORT = parseInt(process.env.BACKEND_PORT || '8000', 10);

// Hotkeys — read from env or use defaults
const HOTKEYS = {
  capture: process.env.HOTKEY_CAPTURE || 'CommandOrControl+Shift+S',
  toggleOverlay: process.env.HOTKEY_TOGGLE_OVERLAY || 'CommandOrControl+Shift+A',
  analyze: process.env.HOTKEY_ANALYZE || 'CommandOrControl+Shift+X',
  clear: process.env.HOTKEY_CLEAR || 'CommandOrControl+Shift+C',
} as const;

// ── State ─────────────────────────────────────────────────────────────────────

let overlayWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let backendProcess: ChildProcess | null = null;
let isOverlayVisible = true;

// ── Backend Lifecycle ─────────────────────────────────────────────────────────

/**
 * Spawn the Python FastAPI backend process.
 * Uses uvicorn with the packaged backend or dev server.
 */
function spawnBackend(): void {
  const backendDir = IS_DEV
    ? path.join(process.cwd(), '..', 'backend')
    : path.join(process.resourcesPath, 'backend');

  const pythonBin = IS_DEV ? 'python3' : path.join(backendDir, 'venv', 'bin', 'python3');

  const args = [
    '-m', 'uvicorn',
    'main:app',
    '--host', BACKEND_HOST,
    '--port', String(BACKEND_PORT),
    '--log-level', IS_DEV ? 'debug' : 'warning',
  ];

  console.log(`[ARKI] Starting backend: ${pythonBin} ${args.join(' ')}`);

  backendProcess = spawn(pythonBin, args, {
    cwd: backendDir,
    env: {
      ...process.env,
      PYTHONUNBUFFERED: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  backendProcess.stdout?.on('data', (data: Buffer) => {
    if (IS_DEV) console.log(`[Backend] ${data.toString().trim()}`);
  });

  backendProcess.stderr?.on('data', (data: Buffer) => {
    const msg = data.toString().trim();
    // uvicorn logs to stderr — only show errors in production
    if (IS_DEV || msg.toLowerCase().includes('error')) {
      console.error(`[Backend ERR] ${msg}`);
    }
  });

  backendProcess.on('exit', (code, signal) => {
    console.warn(`[ARKI] Backend exited: code=${code} signal=${signal}`);
    backendProcess = null;
    // Restart backend if not a clean shutdown
    if (code !== 0 && signal !== 'SIGTERM') {
      console.log('[ARKI] Restarting backend in 2s...');
      setTimeout(spawnBackend, 2000);
    }
  });
}

function killBackend(): void {
  if (backendProcess) {
    backendProcess.kill('SIGTERM');
    backendProcess = null;
  }
}

// ── Window Creation ───────────────────────────────────────────────────────────

/**
 * Create the transparent overlay window.
 * SECURITY: nodeIntegration disabled, contextIsolation enabled, sandbox enabled.
 */
function createOverlayWindow(): BrowserWindow {
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;

  const overlayWidth = parseInt(process.env.OVERLAY_WIDTH || '420', 10);
  const overlayHeight = parseInt(process.env.OVERLAY_HEIGHT || '600', 10);
  const position = process.env.OVERLAY_POSITION || 'top-right';

  // Calculate position
  const positions: Record<string, { x: number; y: number }> = {
    'top-right':     { x: screenWidth - overlayWidth - 20,     y: 20 },
    'top-left':      { x: 20,                                   y: 20 },
    'bottom-right':  { x: screenWidth - overlayWidth - 20,     y: screenHeight - overlayHeight - 20 },
    'bottom-left':   { x: 20,                                   y: screenHeight - overlayHeight - 20 },
    'center':        { x: Math.floor((screenWidth - overlayWidth) / 2), y: Math.floor((screenHeight - overlayHeight) / 2) },
  };

  const { x, y } = positions[position] ?? positions['top-right'];

  const win = new BrowserWindow({
    width: overlayWidth,
    height: overlayHeight,
    x,
    y,

    // ── Overlay aesthetics ──────────────────────────────────────────────────
    frame: false,                     // No OS chrome
    transparent: true,                // Glass/blur effect
    alwaysOnTop: process.env.OVERLAY_ALWAYS_ON_TOP !== 'false',
    skipTaskbar: true,                // Don't show in taskbar
    resizable: true,
    movable: true,
    hasShadow: false,

    // ── Security (non-negotiable) ───────────────────────────────────────────
    webPreferences: {
      preload: PRELOAD_PATH,
      nodeIntegration: false,         // ❌ Never enable
      contextIsolation: true,         // ✅ Required
      sandbox: true,                  // ✅ Extra isolation
      webSecurity: true,              // ✅ Keep enabled
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      navigateOnDragDrop: false,
    },

    // ── Platform-specific ───────────────────────────────────────────────────
    ...(process.platform === 'darwin' && {
      vibrancy: 'under-window',       // macOS: native blur
      visualEffectState: 'active',
      titleBarStyle: 'hiddenInset',
    }),
    ...(process.platform === 'win32' && {
      backgroundMaterial: 'acrylic',  // Windows 11: acrylic blur
    }),
  });

  // ── Load renderer ──────────────────────────────────────────────────────────
  if (IS_DEV && RENDERER_URL) {
    win.loadURL(RENDERER_URL);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    const rendererPath = path.join(__dirname, '..', 'renderer', 'index.html');
    win.loadFile(rendererPath);
  }

  // ── Security: block navigation away from app ───────────────────────────────
  win.webContents.on('will-navigate', (event, navigationUrl) => {
    const parsedUrl = new URL(navigationUrl);
    const allowed = IS_DEV
      ? ['localhost', '127.0.0.1']
      : [];
    if (!allowed.includes(parsedUrl.hostname)) {
      event.preventDefault();
      shell.openExternal(navigationUrl); // Open in system browser instead
    }
  });

  // ── Security: block new windows ────────────────────────────────────────────
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // ── Click-through mode (if configured) ────────────────────────────────────
  if (process.env.OVERLAY_CLICK_THROUGH === 'true') {
    win.setIgnoreMouseEvents(true, { forward: true });
  }

  win.on('closed', () => {
    overlayWindow = null;
  });

  return win;
}

// ── System Tray ───────────────────────────────────────────────────────────────

function createTray(): Tray {
  // Use a 16x16 or 22x22 icon — transparent for now (replace with actual icon)
  const icon = nativeImage.createEmpty();
  const trayInstance = new Tray(icon);

  const contextMenu = Menu.buildFromTemplate([
    { label: 'ARKI Desktop', enabled: false },
    { type: 'separator' },
    {
      label: 'Show/Hide Overlay',
      accelerator: HOTKEYS.toggleOverlay,
      click: () => toggleOverlay(),
    },
    {
      label: 'Capture Screen',
      accelerator: HOTKEYS.capture,
      click: () => overlayWindow?.webContents.send('ipc:capture-trigger'),
    },
    { type: 'separator' },
    {
      label: 'Open DevTools',
      visible: IS_DEV,
      click: () => overlayWindow?.webContents.openDevTools({ mode: 'detach' }),
    },
    { type: 'separator' },
    {
      label: 'Quit ARKI',
      click: () => app.quit(),
    },
  ]);

  trayInstance.setToolTip('ARKI — AI Desktop Assistant');
  trayInstance.setContextMenu(contextMenu);
  trayInstance.on('double-click', () => toggleOverlay());

  return trayInstance;
}

// ── Overlay Controls ──────────────────────────────────────────────────────────

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

// ── Global Hotkeys ────────────────────────────────────────────────────────────

function registerHotkeys(): void {
  // OCR Capture
  const captureRegistered = globalShortcut.register(HOTKEYS.capture, () => {
    overlayWindow?.webContents.send('ipc:capture-trigger');
    if (!isOverlayVisible) {
      overlayWindow?.show();
      isOverlayVisible = true;
    }
  });

  // Toggle overlay visibility
  const toggleRegistered = globalShortcut.register(HOTKEYS.toggleOverlay, () => {
    toggleOverlay();
  });

  // Deep AI analysis (manual trigger)
  const analyzeRegistered = globalShortcut.register(HOTKEYS.analyze, () => {
    overlayWindow?.webContents.send('ipc:analyze-trigger');
  });

  // Clear session
  const clearRegistered = globalShortcut.register(HOTKEYS.clear, () => {
    overlayWindow?.webContents.send('ipc:clear-session');
  });

  if (!captureRegistered || !toggleRegistered || !analyzeRegistered || !clearRegistered) {
    console.error('[ARKI] Failed to register one or more global hotkeys. Check for conflicts.');
  } else {
    console.log('[ARKI] Global hotkeys registered successfully');
    console.log(`  Capture:        ${HOTKEYS.capture}`);
    console.log(`  Toggle Overlay: ${HOTKEYS.toggleOverlay}`);
    console.log(`  Analyze:        ${HOTKEYS.analyze}`);
    console.log(`  Clear:          ${HOTKEYS.clear}`);
  }
}

// ── IPC Handlers ──────────────────────────────────────────────────────────────

function registerIpcHandlers(): void {
  // Renderer → Main: window controls
  ipcMain.on('window:minimize', () => overlayWindow?.minimize());
  ipcMain.on('window:close',    () => app.quit());
  ipcMain.on('window:hide',     () => { overlayWindow?.hide(); isOverlayVisible = false; });

  // Renderer → Main: set click-through mode
  ipcMain.on('window:set-click-through', (_event, enabled: boolean) => {
    if (overlayWindow) {
      overlayWindow.setIgnoreMouseEvents(enabled, { forward: true });
    }
  });

  // Renderer → Main: resize overlay
  ipcMain.on('window:resize', (_event, { width, height }: { width: number; height: number }) => {
    if (overlayWindow) {
      overlayWindow.setSize(width, height, true);
    }
  });

  // Renderer → Main: move overlay
  ipcMain.on('window:move', (_event, { x, y }: { x: number; y: number }) => {
    if (overlayWindow) {
      overlayWindow.setPosition(x, y, true);
    }
  });

  // Renderer → Main: request backend health
  ipcMain.handle('backend:health', async () => {
    try {
      const response = await fetch(`http://${BACKEND_HOST}:${BACKEND_PORT}/health`);
      return { ok: response.ok, status: response.status };
    } catch {
      return { ok: false, status: 0 };
    }
  });

  // Renderer → Main: get app info
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    name: app.getName(),
    isDev: IS_DEV,
    platform: process.platform,
    backendUrl: `http://${BACKEND_HOST}:${BACKEND_PORT}`,
    websocketUrl: `ws://${BACKEND_HOST}:${process.env.WEBSOCKET_PORT || '8765'}`,
  }));

  // Renderer → Main: open external URL safely
  ipcMain.on('shell:open-external', (_event, url: string) => {
    const safeUrl = new URL(url);
    if (['https:', 'http:'].includes(safeUrl.protocol)) {
      shell.openExternal(url);
    }
  });
}

// ── App Lifecycle ─────────────────────────────────────────────────────────────

// Prevent multiple instances
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

app.on('second-instance', () => {
  if (overlayWindow) {
    if (overlayWindow.isMinimized()) overlayWindow.restore();
    overlayWindow.focus();
  }
});

// macOS: dark mode support
nativeTheme.themeSource = 'dark';

app.whenReady().then(() => {
  // Spawn Python backend first
  spawnBackend();

  // Create overlay window
  overlayWindow = createOverlayWindow();

  // Create tray
  tray = createTray();

  // Register global hotkeys
  registerHotkeys();

  // Register IPC handlers
  registerIpcHandlers();

  console.log(`[ARKI] App ready. Backend: http://${BACKEND_HOST}:${BACKEND_PORT}`);
});

app.on('window-all-closed', () => {
  // On macOS: keep app alive even without windows (tray app)
  if (process.platform !== 'darwin') {
    app.quit();
  }
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
  killBackend();
});

// ── Security: Handle certificate errors ───────────────────────────────────────
// Only allow self-signed certs for localhost in dev
app.on('certificate-error', (event, _webContents, url, _error, _certificate, callback) => {
  if (IS_DEV && (url.startsWith('https://localhost') || url.startsWith('https://127.0.0.1'))) {
    event.preventDefault();
    callback(true);
  } else {
    callback(false); // Reject all other certificate errors
  }
});
