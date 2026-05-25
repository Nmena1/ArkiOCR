/**
 * ARKI — PopupManager
 *
 * Lightweight popup window manager with pre-warming pool.
 *
 * Architecture:
 *   - Pre-warms ONE hidden BrowserWindow at initialize() so first show() has
 *     near-zero window-creation overhead.
 *   - Pool: when a popup is dismissed it is NOT destroyed — its content is reset
 *     and it returns to the pool hidden. Next show() reuses it instantly.
 *   - If the pool is empty (window still busy during show()), a new window is
 *     created on demand.
 *   - Auto-dismiss timer: configurable delay, cancelled on user interaction.
 *   - Edge detection: popup never overflows the display bounds.
 *
 * IPC handlers registered:
 *   popup:resize  { height: number }  — smooth resize from renderer
 *   popup:close                        — renderer requests close
 *   popup:copy    string               — renderer copies text to clipboard
 *
 * Outgoing IPC to popup window:
 *   popup:data    PopupData            — sent on show()
 */

import {
  BrowserWindow,
  clipboard,
  ipcMain,
  screen,
  type IpcMainEvent,
} from 'electron';
import * as path from 'path';

// ── Public types ───────────────────────────────────────────────────────────────

export interface PopupData {
  ocr:  { text: string; confidence: number; provider: string };
  ai?:  { response: string; model: string; tokensUsed: number };
  mode: 'ocr-only' | 'ocr+ai';
  totalMs: number;
}

export interface PopupConfig {
  /** Auto-dismiss delay in ms. 0 = never auto-dismiss. Default: 0 */
  autoDismissMs: number;
  /** Popup width. Default: 420 */
  width: number;
  /** Initial / maximum height. Renderer resizes via popup:resize. Default: 480 */
  maxHeight: number;
  /** Dark or light theme hint sent to renderer. Default: 'dark' */
  theme: 'dark' | 'light';
}

// ── Internals ──────────────────────────────────────────────────────────────────

const IS_DEV = process.env.NODE_ENV === 'development' || process.env.APP_ENV === 'development';

/**
 * Position a BrowserWindow near the cursor with edge detection.
 * Mutates the window position — does not return a value.
 */
function positionNearCursor(win: BrowserWindow, width: number, height: number): void {
  const { x, y }     = screen.getCursorScreenPoint();
  const display       = screen.getDisplayNearestPoint({ x, y });
  const { bounds }    = display;

  const MARGIN = 12;
  let px = x + MARGIN;
  let py = y + MARGIN;

  // Push back inside display bounds when the popup would overflow
  if (px + width  > bounds.x + bounds.width)  px = x - width  - MARGIN;
  if (py + height > bounds.y + bounds.height) py = y - height - MARGIN;
  if (px < bounds.x) px = bounds.x + MARGIN;
  if (py < bounds.y) py = bounds.y + MARGIN;

  win.setPosition(Math.round(px), Math.round(py));
}

// ── PopupManager ───────────────────────────────────────────────────────────────

export class PopupManager {
  private readonly pool:    BrowserWindow[] = [];
  private activeWin:        BrowserWindow | null = null;
  private dismissTimer:     ReturnType<typeof setTimeout> | null = null;
  private ipcRegistered     = false;

  constructor(
    private readonly config: PopupConfig,
    private readonly preloadPath: string,
  ) {}

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  /**
   * Pre-warm one hidden popup window so the first show() call is instant.
   * Must be called after app.whenReady().
   */
  async initialize(): Promise<void> {
    const win = this.createWindow();
    await this.loadPopupHtml(win);
    this.pool.push(win);
    this.registerIpcHandlers();
    console.log('[PopupManager] Pre-warmed popup window ready');
  }

  /**
   * Show the popup with the given data.
   *
   * 1. Takes a pre-warmed window from the pool (or creates a new one).
   * 2. Positions it near the cursor with edge detection.
   * 3. Sends popup:data IPC to the renderer.
   * 4. Shows the window.
   * 5. Starts auto-dismiss timer.
   */
  async show(data: PopupData): Promise<void> {
    // Dismiss any currently active popup before showing a new one
    this.dismiss();

    // Take from pool or create on demand
    let win = this.pool.pop() ?? null;
    if (!win || win.isDestroyed()) {
      win = this.createWindow();
      await this.loadPopupHtml(win);
    }

    // Position near cursor (use initial height estimate for edge detection;
    // renderer will send popup:resize once content is measured)
    positionNearCursor(win, this.config.width, this.config.maxHeight);

    // Send data to renderer BEFORE showing to avoid flash
    win.webContents.send('popup:data', data);

    win.show();
    this.activeWin = win;

    // Return to pool on close/destroy
    win.once('closed', () => {
      if (this.activeWin === win) this.activeWin = null;
      this.clearDismissTimer();
    });

    // Auto-dismiss
    if (this.config.autoDismissMs > 0) {
      this.dismissTimer = setTimeout(() => this.dismiss(), this.config.autoDismissMs);
    }

    console.log('[PopupManager] Popup shown');
  }

  /** Close all windows and release resources. */
  destroy(): void {
    this.dismiss();
    for (const win of this.pool) {
      if (!win.isDestroyed()) win.close();
    }
    this.pool.length = 0;
  }

  /** Open DevTools on the active popup (IS_DEV only). */
  openDevTools(): void {
    if (!IS_DEV) return;
    if (this.activeWin && !this.activeWin.isDestroyed()) {
      this.activeWin.webContents.openDevTools({ mode: 'detach' });
    }
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Create a new hidden BrowserWindow with popup configuration.
   * Window is initially hidden (show: false); caller decides when to show().
   */
  private createWindow(): BrowserWindow {
    const win = new BrowserWindow({
      width:    this.config.width ?? 420,
      height:   100,           // starts small — renderer will resize via popup:resize
      minWidth: 300,
      maxWidth: 700,

      frame:       false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable:   false,
      movable:     true,      // draggable
      hasShadow:   true,
      show:        false,

      webPreferences: {
        preload:          path.join(__dirname, 'preload-popup.js'),
        nodeIntegration:  false,
        contextIsolation: true,
        sandbox:          true,
      },

      ...(process.platform === 'darwin' && {
        vibrancy:           'under-window' as const,
        visualEffectState:  'active'       as const,
        type:               'panel'        as const,
      }),
    });

    // Stay on top of all windows (macOS: floating level)
    win.setAlwaysOnTop(true, 'floating');
    if (process.platform === 'darwin') {
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
    }

    return win;
  }

  /**
   * Load the popup HTML file into a BrowserWindow and wait for 'did-finish-load'.
   */
  private loadPopupHtml(win: BrowserWindow): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      win.webContents.once('did-finish-load', resolve);
      win.webContents.once('did-fail-load', (_e, code, desc) => {
        reject(new Error(`[PopupManager] Failed to load popup HTML: ${desc} (${code})`));
      });

      const htmlPath = IS_DEV
        ? path.join(__dirname, '../../popup/index.html')
        : path.join(process.resourcesPath, 'popup/index.html');

      win.loadFile(htmlPath).catch(reject);
    });
  }

  /**
   * Hide the active popup, reset its state, and return it to the pool.
   * Called on auto-dismiss, manual close IPC, and before showing a new popup.
   */
  private dismiss(): void {
    this.clearDismissTimer();
    if (!this.activeWin || this.activeWin.isDestroyed()) {
      this.activeWin = null;
      return;
    }

    const win = this.activeWin;
    this.activeWin = null;
    win.hide();

    // Return to pool for reuse
    this.pool.push(win);
    console.log('[PopupManager] Popup dismissed, returned to pool');
  }

  private clearDismissTimer(): void {
    if (this.dismissTimer !== null) {
      clearTimeout(this.dismissTimer);
      this.dismissTimer = null;
    }
  }

  /**
   * Register IPC handlers for renderer → main communication.
   * Called once during initialize(); subsequent calls are no-ops (idempotent guard).
   */
  private registerIpcHandlers(): void {
    if (this.ipcRegistered) return;
    this.ipcRegistered = true;

    // Smooth resize: renderer measures its content and requests new height
    ipcMain.on('popup:resize', (_evt: IpcMainEvent, { height }: { height: number }) => {
      if (!this.activeWin || this.activeWin.isDestroyed()) return;
      const clampedHeight = Math.min(Math.max(height, 60), this.config.maxHeight);
      this.activeWin.setSize(this.config.width, clampedHeight, true /* animate */);
    });

    // Renderer requests close
    ipcMain.on('popup:close', () => this.dismiss());

    // Renderer copies text to clipboard
    ipcMain.on('popup:copy', (_evt: IpcMainEvent, text: string) => {
      if (typeof text === 'string') clipboard.writeText(text);
    });
  }
}
