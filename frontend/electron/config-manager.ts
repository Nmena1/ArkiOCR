/**
 * ARKI — ConfigManager
 *
 * Loads, watches, and hot-reloads the ARKI user config from ~/.arki/config.json.
 * Emits 'change' with the new config whenever the file is modified.
 * Deep-merges user config over built-in defaults so new keys are never undefined.
 */

import { EventEmitter }                    from 'events';
import { app, shell }                      from 'electron';
import * as fs                             from 'fs';
import * as path                           from 'path';

// ── Config interface ──────────────────────────────────────────────────────────

export interface ArkiConfig {
  hotkeys: {
    capture:           string;
    captureFullscreen: string;
    dismiss:           string;
  };
  doublePress: {
    enabled:     boolean;
    thresholdMs: number;
  };
  capture: {
    mode:            'active-window' | 'fullscreen';
    /** Milliseconds to wait before taking the screenshot (let windows settle). */
    screenshotDelay: number;
  };
  ocr: {
    provider:          'tesseract' | 'easyocr' | 'openai-vision';
    fallbackProviders: string[];
    language:          string;
    minConfidence:     number;
  };
  ai: {
    provider:         'ollama' | 'openai' | 'claude';
    model:            string;
    fallbackProvider: string;
    fallbackModel:    string;
    maxTokens:        number;
    temperature:      number;
    systemPrompt:     string;
  };
  popup: {
    autoDismissMs: number;
    position:      'cursor' | 'top-right' | 'top-left' | 'bottom-right' | 'center';
    theme:         'dark' | 'light';
    width:         number;
    maxHeight:     number;
  };
  backend: {
    host:    string;
    port:    number;
    timeout: number;
  };
}

// ── Events emitted ─────────────────────────────────────────────────────────────
//
//  'change' (config: ArkiConfig) → hotkeys + tray menu should be rebuilt

export interface ConfigManagerEvents {
  change: (config: ArkiConfig) => void;
}

export declare interface ConfigManager {
  on<K extends keyof ConfigManagerEvents>(event: K, listener: ConfigManagerEvents[K]): this;
  once<K extends keyof ConfigManagerEvents>(event: K, listener: ConfigManagerEvents[K]): this;
  off<K extends keyof ConfigManagerEvents>(event: K, listener: ConfigManagerEvents[K]): this;
  emit<K extends keyof ConfigManagerEvents>(event: K, ...args: Parameters<ConfigManagerEvents[K]>): boolean;
}

// ── Defaults ──────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: ArkiConfig = {
  hotkeys: {
    capture:           'CommandOrControl+Shift+S',
    captureFullscreen: 'CommandOrControl+Shift+F',
    dismiss:           'Escape',
  },
  doublePress: {
    enabled:     true,
    thresholdMs: 300,
  },
  capture: {
    mode:            'active-window',
    screenshotDelay: 150,
  },
  ocr: {
    provider:          'tesseract',
    fallbackProviders: ['easyocr'],
    language:          'eng+spa',
    minConfidence:     0.5,
  },
  ai: {
    provider:         'ollama',
    model:            'llama3.2',
    fallbackProvider: 'openai',
    fallbackModel:    'gpt-4o-mini',
    maxTokens:        1024,
    temperature:      0.3,
    systemPrompt:     'You are ARKI, an AI assistant. Analyze the OCR text and provide a concise, helpful response.',
  },
  popup: {
    autoDismissMs: 0,
    position:      'cursor',
    theme:         'dark',
    width:         420,
    maxHeight:     600,
  },
  backend: {
    host:    '127.0.0.1',
    port:    8000,
    timeout: 30_000,
  },
};

// ── ConfigManager ─────────────────────────────────────────────────────────────

export class ConfigManager extends EventEmitter {
  private current: ArkiConfig;
  private readonly configPath: string;
  private readonly isDev: boolean;

  private fileWatcher:    fs.FSWatcher | null = null;
  private devWatcher:     fs.FSWatcher | null = null;
  private debounceTimer:  ReturnType<typeof setTimeout> | null = null;

  /** Debounce delay for fs.watch events (ms). */
  private static readonly DEBOUNCE_MS = 500;

  constructor(isDev = false) {
    super();
    this.isDev      = isDev;
    this.configPath = path.join(app.getPath('home'), '.arki', 'config.json');
    this.current    = structuredClone(DEFAULT_CONFIG);
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Load config from disk, write defaults if file doesn't exist, start file watcher.
   * Must be called once during app startup (after app.whenReady).
   */
  init(): void {
    this.ensureConfigDir();
    this.loadFromDisk();
    this.startWatcher();

    if (this.isDev) {
      this.startDevWatcher();
    }

    console.log(`[ConfigManager] Loaded config from ${this.configPath}`);
  }

  /** Returns the current in-memory config (fast, synchronous). */
  get(): ArkiConfig {
    return this.current;
  }

  /** Open the config file in the user's default editor. */
  openInEditor(): void {
    shell.openPath(this.configPath).catch((err: unknown) => {
      console.error('[ConfigManager] Failed to open config in editor:', err);
    });
  }

  /** Stop all file watchers and timers. */
  destroy(): void {
    this.fileWatcher?.close();
    this.fileWatcher = null;

    this.devWatcher?.close();
    this.devWatcher = null;

    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  // ── Disk I/O ───────────────────────────────────────────────────────────────

  private ensureConfigDir(): void {
    const dir = path.dirname(this.configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`[ConfigManager] Created config directory: ${dir}`);
    }
  }

  private loadFromDisk(): void {
    if (!fs.existsSync(this.configPath)) {
      // Write defaults on first run
      this.writeToDisk(DEFAULT_CONFIG);
      this.current = structuredClone(DEFAULT_CONFIG);
      console.log(`[ConfigManager] Created default config at ${this.configPath}`);
      return;
    }

    try {
      const raw     = fs.readFileSync(this.configPath, 'utf8');
      const parsed  = JSON.parse(raw) as Partial<ArkiConfig>;
      const base    = structuredClone(DEFAULT_CONFIG) as unknown as Record<string, unknown>;
      const override = parsed as unknown as Record<string, unknown>;
      this.current  = deepMerge(base, override) as unknown as ArkiConfig;
    } catch (err) {
      console.error('[ConfigManager] Failed to parse config — using defaults:', err);
      this.current = structuredClone(DEFAULT_CONFIG);
    }
  }

  private writeToDisk(config: ArkiConfig): void {
    try {
      this.ensureConfigDir();
      fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2), 'utf8');
    } catch (err) {
      console.error('[ConfigManager] Failed to write default config:', err);
    }
  }

  // ── File watcher ───────────────────────────────────────────────────────────

  private startWatcher(): void {
    try {
      this.fileWatcher = fs.watch(this.configPath, (_eventType) => {
        this.scheduleReload();
      });
      this.fileWatcher.on('error', (err) => {
        console.error('[ConfigManager] File watcher error:', err);
      });
    } catch (err) {
      console.warn('[ConfigManager] Could not watch config file:', err);
    }
  }

  /**
   * In IS_DEV mode, also watch the project-local `config/default.json`
   * so developers can iterate on defaults without touching ~/.arki/config.json.
   */
  private startDevWatcher(): void {
    const devConfigPath = path.join(process.cwd(), 'config', 'default.json');
    if (!fs.existsSync(devConfigPath)) return;

    try {
      this.devWatcher = fs.watch(devConfigPath, () => {
        console.log('[ConfigManager] DEV: local config/default.json changed — reloading');
        this.scheduleReload();
      });
      this.devWatcher.on('error', () => { /* non-critical */ });
      console.log(`[ConfigManager] DEV: watching ${devConfigPath}`);
    } catch {
      // Non-fatal in dev
    }
  }

  private scheduleReload(): void {
    if (this.debounceTimer !== null) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      const before = JSON.stringify(this.current);
      this.loadFromDisk();
      const after = JSON.stringify(this.current);
      if (before !== after) {
        console.log('[ConfigManager] Config changed — emitting change event');
        this.emit('change', this.current);
      }
    }, ConfigManager.DEBOUNCE_MS);
  }
}

// ── Deep merge helper ─────────────────────────────────────────────────────────

/**
 * Recursively merge `overrides` into `base`.
 * - Plain objects are merged recursively.
 * - Arrays and primitives from `overrides` replace those in `base`.
 * - Keys present in `base` but missing in `overrides` are preserved.
 */
function deepMerge(
  base: Record<string, unknown>,
  overrides: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };

  for (const key of Object.keys(overrides)) {
    const bVal = base[key];
    const oVal = overrides[key];

    if (isPlainObject(bVal) && isPlainObject(oVal)) {
      result[key] = deepMerge(
        bVal as Record<string, unknown>,
        oVal as Record<string, unknown>,
      );
    } else if (oVal !== undefined) {
      result[key] = oVal;
    }
  }

  return result;
}

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}
