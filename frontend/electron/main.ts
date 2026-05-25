/**
 * ARKI — Electron Main Process (headless tray-only)
 *
 * Architecture:
 *   - No BrowserWindow at startup — tray-only
 *   - Single instance lock prevents duplicate processes
 *   - All resources cleaned up on will-quit
 *   - macOS: hidden from dock (app.dock.hide())
 *   - Config hot-reload: hotkeys + tray menu rebuilt on every config change
 *
 * Security:
 *   - nodeIntegration: false
 *   - contextIsolation: true
 *   - sandbox: true
 *   (enforced in PopupManager windows)
 */

import { app, Tray, Menu, nativeImage, nativeTheme, ipcMain, shell } from 'electron';
import * as path from 'path';
import { HotkeyEngine }           from './hotkey-engine';
import { CaptureService }         from './capture-service';
import { PopupManager }           from './popup-manager';
import { Pipeline, PipelineOptions } from './pipeline';
import { ConfigManager }          from './config-manager';
import { BackendBridge }          from './backend-bridge';
import { BackendProcess }         from './backend-process';

// ── Constants ──────────────────────────────────────────────────────────────────

const IS_DEV = !app.isPackaged || process.env.NODE_ENV === 'development';
const PRELOAD_PATH = path.join(__dirname, 'preload.js');
const RENDERER_URL = IS_DEV ? (process.env.RENDERER_URL ?? 'http://localhost:5173') : undefined;

// ── Module-level singletons ────────────────────────────────────────────────────

let tray:            Tray | null        = null;
let hotkeyEngine:    HotkeyEngine | null = null;
let captureService:  CaptureService | null = null;
let popupManager:    PopupManager | null   = null;
let pipeline:        Pipeline | null       = null;
let configManager:   ConfigManager | null  = null;
let backendBridge:   BackendBridge | null  = null;
let backendProcess:  BackendProcess | null = null;

// ── Tray icon helpers ──────────────────────────────────────────────────────────

type TrayState = 'idle' | 'capturing' | 'processing' | 'error';

function loadTrayIcon(name: string): Electron.NativeImage {
  try {
    const iconPath = path.join(__dirname, '..', 'assets', `${name}@2x.png`);
    const img = nativeImage.createFromPath(iconPath);
    if (img.isEmpty()) throw new Error('empty');
    img.setTemplateImage(true); // macOS menu-bar auto-adapt light/dark
    return img;
  } catch {
    return nativeImage.createEmpty();
  }
}

const TRAY_ICONS: Record<TrayState, Electron.NativeImage | null> = {
  idle:       null,
  capturing:  null,
  processing: null,
  error:      null,
};

function preloadTrayIcons(): void {
  TRAY_ICONS.idle       = loadTrayIcon('tray-icon');
  TRAY_ICONS.capturing  = loadTrayIcon('tray-icon-capturing');
  TRAY_ICONS.processing = loadTrayIcon('tray-icon-processing');
  TRAY_ICONS.error      = loadTrayIcon('tray-icon-error');
}

function setTrayState(state: TrayState): void {
  if (!tray) return;
  const icon = TRAY_ICONS[state] ?? TRAY_ICONS.idle ?? nativeImage.createEmpty();
  tray.setImage(icon);

  const tooltips: Record<TrayState, string> = {
    idle:       'ARKI — Ready',
    capturing:  'ARKI — Capturing...',
    processing: 'ARKI — Processing...',
    error:      'ARKI — Error',
  };
  tray.setToolTip(tooltips[state]);
}

// ── Tray menu builder ──────────────────────────────────────────────────────────

function buildTrayMenu(): Electron.Menu {
  const version = app.getVersion();

  return Menu.buildFromTemplate([
    // Header — non-clickable label
    {
      label:   `ARKI v${version}`,
      enabled: false,
    },
    { type: 'separator' },

    // Primary actions
    {
      label:       'Capture + OCR  (Cmd+Shift+S)',
      accelerator: configManager?.get().hotkeys.capture,
      click: () => {
        void pipeline?.run({ mode: 'ocr-only' });
      },
    },
    {
      label:       'Capture + AI  (double-press)',
      click: () => {
        void pipeline?.run({ mode: 'ocr+ai' });
      },
    },
    { type: 'separator' },

    // Preferences
    {
      label: 'Open Preferences',
      click: () => configManager?.openInEditor(),
    },

    // DevTools (dev only)
    ...(IS_DEV
      ? [
          {
            label: 'DevTools',
            click: () => popupManager?.openDevTools(),
          } as Electron.MenuItemConstructorOptions,
        ]
      : []),

    { type: 'separator' },

    // Quit
    {
      label: 'Quit ARKI',
      click: () => app.quit(),
    },
  ]);
}

function rebuildTrayMenu(): void {
  if (!tray) return;
  tray.setContextMenu(buildTrayMenu());
}

// ── Tray setup ─────────────────────────────────────────────────────────────────

function createTray(): Tray {
  const icon = TRAY_ICONS.idle ?? nativeImage.createEmpty();
  const t    = new Tray(icon);

  t.setToolTip('ARKI — Ready');
  t.setContextMenu(buildTrayMenu());

  // Right-click opens context menu (default).
  // Left-click on macOS does nothing extra — menu appears on right-click.
  if (process.platform === 'win32') {
    t.on('click', () => t.popUpContextMenu());
  }

  return t;
}

// ── Pipeline event wiring ──────────────────────────────────────────────────────

function wirePipelineEvents(p: Pipeline): void {
  p.on('status', (status) => {
    switch (status) {
      case 'idle':        setTrayState('idle');        break;
      case 'capturing':   setTrayState('capturing');   break;
      case 'processing':
      case 'displaying':  setTrayState('processing');  break;
      case 'error':       setTrayState('error');       break;
    }
  });

  p.on('error', (err) => {
    console.error('[ARKI] Pipeline error:', err.message);
    // Return to idle after a short delay so user sees the error state briefly
    setTimeout(() => setTrayState('idle'), 3_000);
  });

  p.on('busy', () => {
    console.warn('[ARKI] Pipeline busy — ignoring request');
  });
}

// ── Hotkey event wiring ────────────────────────────────────────────────────────

function wireHotkeyEvents(hk: HotkeyEngine): void {
  // Single press: OCR only
  hk.on('capture:single', () => {
    void pipeline?.run({ mode: 'ocr-only' });
  });

  // Double press: OCR + AI
  hk.on('capture:double', () => {
    void pipeline?.run({ mode: 'ocr+ai' });
  });

  // Fullscreen single: OCR only, fullscreen mode
  hk.on('fullscreen:single', () => {
    void pipeline?.run({ mode: 'ocr-only', capture: 'fullscreen' });
  });

  // Fullscreen double: OCR + AI, fullscreen mode
  hk.on('fullscreen:double', () => {
    void pipeline?.run({ mode: 'ocr+ai', capture: 'fullscreen' });
  });

  // Dismiss: close popup
  hk.on('dismiss', () => {
    popupManager?.destroy();
    // Reinitialize popup manager after dismiss so pool is ready for next show
    void popupManager?.initialize?.();
  });
}

// ── Config change handler ──────────────────────────────────────────────────────

function onConfigChange(): void {
  const cfg = configManager!.get();
  console.log('[ARKI] Config changed — reloading hotkeys + tray menu');

  // Re-register hotkeys with new combos / double-press settings
  hotkeyEngine?.updateConfig(cfg.hotkeys, cfg.doublePress);

  // Rebuild tray menu (accelerator labels may have changed)
  rebuildTrayMenu();

  // Note: PopupManager config (width, auto-dismiss) takes effect on next show().
  // The pool windows are sized from config at creation time; a hot-reload
  // of popup dimensions requires app restart to fully take effect.
}

// ── IPC: misc helpers ──────────────────────────────────────────────────────────

function registerIpcHandlers(): void {
  // App info — used by popup renderer to show version/backend URL
  ipcMain.handle('app:info', () => ({
    version:    app.getVersion(),
    name:       app.getName(),
    isDev:      IS_DEV,
    platform:   process.platform,
    backendUrl: backendBridge
      ? `http://${configManager?.get().backend.host}:${configManager?.get().backend.port}`
      : null,
  }));

  // External links
  ipcMain.on('shell:open-external', (_evt, url: string) => {
    try {
      const parsed = new URL(url);
      if (['https:', 'http:'].includes(parsed.protocol)) {
        void shell.openExternal(url);
      }
    } catch {
      console.warn('[ARKI] Invalid URL for shell:open-external:', url);
    }
  });

  // Backend health check (for popup renderer status indicator)
  ipcMain.handle('backend:health', async () => {
    if (!backendBridge) return { ok: false };
    const ok = await backendBridge.health();
    return { ok };
  });

  // Trigger pipeline from IPC (future: remote trigger from popup)
  ipcMain.on('pipeline:run', (_evt, options: PipelineOptions) => {
    void pipeline?.run(options);
  });
}

// ── App bootstrap ──────────────────────────────────────────────────────────────

// Single instance lock — quit the second instance immediately
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  console.log('[ARKI] Another instance is already running. Quitting.');
  app.quit();
  process.exit(0);
}

// Force dark theme for any popup windows
nativeTheme.themeSource = 'dark';

app.whenReady().then(async () => {
  // ── macOS: hide from dock ────────────────────────────────────────────────
  if (process.platform === 'darwin') {
    app.dock.hide();
  }

  // ── 1. Config ─────────────────────────────────────────────────────────────
  configManager = new ConfigManager(IS_DEV);
  configManager.init();
  const cfg = configManager.get();

  configManager.on('change', onConfigChange);

  // ── 2. Backend process ────────────────────────────────────────────────────
  backendProcess = new BackendProcess(
    { host: cfg.backend.host, port: cfg.backend.port },
    IS_DEV,
  );

  backendProcess.on('failed', (reason) => {
    console.error('[ARKI] Backend permanently failed:', reason);
    setTrayState('error');
  });

  backendProcess.on('restart', (attempt, max) => {
    console.warn(`[ARKI] Backend restarting (${attempt}/${max})`);
  });

  backendProcess.start();

  // ── 3. Backend bridge ─────────────────────────────────────────────────────
  backendBridge = new BackendBridge({
    host:         cfg.backend.host,
    port:         cfg.backend.port,
    ocrTimeoutMs: cfg.backend.timeout,
    aiTimeoutMs:  cfg.backend.timeout * 2,
  });

  // ── 4. Tray ───────────────────────────────────────────────────────────────
  preloadTrayIcons();
  tray = createTray();

  // ── 5. Capture service ────────────────────────────────────────────────────
  captureService = new CaptureService();

  // ── 6. Popup manager ──────────────────────────────────────────────────────
  popupManager = new PopupManager(
    {
      autoDismissMs: cfg.popup.autoDismissMs,
      width:         cfg.popup.width,
      maxHeight:     cfg.popup.maxHeight,
      theme:         cfg.popup.theme,
    },
    PRELOAD_PATH,
  );
  await popupManager.initialize();

  // ── 7. Pipeline ───────────────────────────────────────────────────────────
  pipeline = new Pipeline(captureService, backendBridge, popupManager);
  wirePipelineEvents(pipeline);

  // ── 8. Hotkeys ────────────────────────────────────────────────────────────
  hotkeyEngine = new HotkeyEngine(cfg.hotkeys, cfg.doublePress);
  wireHotkeyEvents(hotkeyEngine);
  hotkeyEngine.register();

  // ── 9. IPC ────────────────────────────────────────────────────────────────
  registerIpcHandlers();

  // ── 10. Wait for backend readiness (non-blocking) ─────────────────────────
  backendProcess.waitUntilReady(15_000).then((ready) => {
    if (ready) {
      console.log('[ARKI] Backend is ready');
    } else {
      console.warn('[ARKI] Backend did not become ready within 15 s');
      setTrayState('error');
    }
  });

  console.log(`[ARKI] Ready — IS_DEV=${IS_DEV}`);
});

// ── Keep alive as tray app ─────────────────────────────────────────────────────

// window-all-closed must NOT quit the app — we're tray-only
app.on('window-all-closed', () => {
  // Intentionally do nothing — tray keeps the app alive
});

// ── Cleanup on quit ────────────────────────────────────────────────────────────

app.on('will-quit', async (event) => {
  // Prevent default quit until async cleanup is done
  event.preventDefault();

  console.log('[ARKI] Cleaning up before quit...');

  // 1. Stop hotkeys first (no more user input)
  hotkeyEngine?.destroy();

  // 2. Close popup if open
  popupManager?.destroy();

  // 3. Destroy tray
  tray?.destroy();
  tray = null;

  // 4. Stop config watcher
  configManager?.destroy();

  // 5. Stop backend
  await backendProcess?.stop();

  console.log('[ARKI] Cleanup complete — exiting');
  app.exit(0);
});
