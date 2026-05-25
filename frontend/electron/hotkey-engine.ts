/**
 * ARKI — HotkeyEngine
 *
 * Double-press detection for global shortcuts.
 * Pattern: first press → set timestamp; second press within threshold → 'double'; else → 'single'.
 * All globalShortcut calls are funneled through this class.
 */

import { EventEmitter } from 'events';
import { globalShortcut } from 'electron';

// ── Config interfaces ──────────────────────────────────────────────────────────

export interface HotkeyConfig {
  /** e.g. 'CommandOrControl+Shift+S' */
  capture: string;
  /** e.g. 'CommandOrControl+Shift+F' */
  captureFullscreen: string;
  /** e.g. 'Escape' */
  dismiss: string;
}

export interface DoublePressConfig {
  enabled: boolean;
  /** Milliseconds within which a second press counts as double. Default: 300 */
  thresholdMs: number;
}

// ── Events emitted ─────────────────────────────────────────────────────────────
//
//  'capture:single'     → single press of capture hotkey
//  'capture:double'     → double press of capture hotkey
//  'fullscreen:single'  → single press of captureFullscreen hotkey
//  'fullscreen:double'  → double press of captureFullscreen hotkey
//  'dismiss'            → dismiss hotkey pressed

export interface HotkeyEngineEvents {
  'capture:single':    () => void;
  'capture:double':    () => void;
  'fullscreen:single': () => void;
  'fullscreen:double': () => void;
  'dismiss':           () => void;
}

// Augment EventEmitter typings so callers get proper overloads
export declare interface HotkeyEngine {
  on<K extends keyof HotkeyEngineEvents>(event: K, listener: HotkeyEngineEvents[K]): this;
  once<K extends keyof HotkeyEngineEvents>(event: K, listener: HotkeyEngineEvents[K]): this;
  off<K extends keyof HotkeyEngineEvents>(event: K, listener: HotkeyEngineEvents[K]): this;
  emit<K extends keyof HotkeyEngineEvents>(event: K, ...args: Parameters<HotkeyEngineEvents[K]>): boolean;
}

// ── HotkeyEngine ──────────────────────────────────────────────────────────────

export class HotkeyEngine extends EventEmitter {
  private hotkeys: HotkeyConfig;
  private doublePressConfig: DoublePressConfig;

  /** Timestamp of last press per accelerator string */
  private readonly lastPress = new Map<string, number>();
  /** Pending single-press timers per accelerator string */
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  private registered = false;

  constructor(hotkeys: HotkeyConfig, doublePressConfig?: Partial<DoublePressConfig>) {
    super();
    this.hotkeys = hotkeys;
    this.doublePressConfig = {
      enabled:     doublePressConfig?.enabled     ?? true,
      thresholdMs: doublePressConfig?.thresholdMs ?? 300,
    };
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /** Register all global shortcuts. Safe to call multiple times (idempotent via destroy first). */
  register(): void {
    if (this.registered) {
      console.warn('[HotkeyEngine] register() called while already registered — skipping');
      return;
    }

    this.registerCombo(this.hotkeys.capture,           'capture');
    this.registerCombo(this.hotkeys.captureFullscreen, 'fullscreen');
    this.registerDismiss(this.hotkeys.dismiss);

    this.registered = true;
    console.log('[HotkeyEngine] Hotkeys registered:', {
      capture:           this.hotkeys.capture,
      captureFullscreen: this.hotkeys.captureFullscreen,
      dismiss:           this.hotkeys.dismiss,
    });
  }

  /** Unregister all global shortcuts and clear pending state. */
  destroy(): void {
    globalShortcut.unregisterAll();
    this.registered = false;

    // Clear all pending single-press timers
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.lastPress.clear();

    console.log('[HotkeyEngine] All hotkeys unregistered');
  }

  /**
   * Hot-reload config without restarting the app.
   * Destroys current registrations and re-registers with new config.
   */
  updateConfig(hotkeys: HotkeyConfig, doublePressConfig?: Partial<DoublePressConfig>): void {
    this.destroy();
    this.hotkeys = hotkeys;
    this.doublePressConfig = {
      enabled:     doublePressConfig?.enabled     ?? this.doublePressConfig.enabled,
      thresholdMs: doublePressConfig?.thresholdMs ?? this.doublePressConfig.thresholdMs,
    };
    this.register();
  }

  /** Returns true if shortcuts are currently registered. */
  isRegistered(): boolean {
    return this.registered;
  }

  // ── Private registration helpers ──────────────────────────────────────────

  /**
   * Register a combo with double-press detection.
   *
   * - First press: record timestamp, schedule single-press emit after threshold+10ms.
   * - Second press within threshold: cancel timer, emit double.
   * - If double-press disabled: always emit single immediately.
   */
  private registerCombo(combo: string, eventName: string): void {
    const ok = globalShortcut.register(combo, () => {
      const now       = Date.now();
      const last      = this.lastPress.get(combo) ?? 0;
      const threshold = this.doublePressConfig.enabled ? this.doublePressConfig.thresholdMs : 0;

      if (threshold > 0 && now - last <= threshold) {
        // ── Double press detected ──────────────────────────────────────────
        this.lastPress.delete(combo);
        const pending = this.timers.get(combo);
        if (pending !== undefined) {
          clearTimeout(pending);
          this.timers.delete(combo);
        }
        this.emit(`${eventName}:double` as keyof HotkeyEngineEvents);
      } else {
        // ── First press (or gap too large) ─────────────────────────────────
        this.lastPress.set(combo, now);

        // Cancel any leftover timer from a previous press that timed out
        const existing = this.timers.get(combo);
        if (existing !== undefined) {
          clearTimeout(existing);
        }

        const timer = setTimeout(() => {
          // Only fire single if this timestamp is still current (not consumed by double)
          if (this.lastPress.get(combo) === now) {
            this.lastPress.delete(combo);
            this.timers.delete(combo);
            this.emit(`${eventName}:single` as keyof HotkeyEngineEvents);
          }
        }, threshold + 10);

        this.timers.set(combo, timer);
      }
    });

    if (!ok) {
      console.warn(`[HotkeyEngine] Failed to register: ${combo} — may already be taken by another app`);
    }
  }

  /**
   * Register the dismiss key (no double-press logic — always fires immediately).
   */
  private registerDismiss(combo: string): void {
    if (!combo) return;
    const ok = globalShortcut.register(combo, () => {
      this.emit('dismiss');
    });
    if (!ok) {
      console.warn(`[HotkeyEngine] Failed to register dismiss hotkey: ${combo}`);
    }
  }
}
