/**
 * ARKI Capture Engine — LRU Capture Result Cache
 *
 * Deduplicates rapid capture requests: if the same display + mode is requested
 * more than once within maxAgeMs (default 150ms), the second call is served
 * from cache without touching desktopCapturer.
 *
 * Capacity is bounded to maxEntries (default 3) using a simple FIFO eviction
 * on an ordered array. For the expected usage pattern (single display,
 * occasional region captures) this is indistinguishable from a true LRU.
 *
 * No external dependencies — pure TypeScript.
 */

import type { CaptureResult, CaptureRegion } from './types';

// ── Internal types ────────────────────────────────────────────────────────────

interface CacheEntry {
  result:    CaptureResult;
  key:       string;
  createdAt: number; // Date.now() at insertion time
}

// ── Cache implementation ──────────────────────────────────────────────────────

export class CaptureCache {
  private readonly maxEntries: number;
  private readonly maxAgeMs:   number;

  /** Ordered oldest-first so eviction is a simple shift(). */
  private entries: CacheEntry[] = [];

  constructor(opts: { maxEntries?: number; maxAgeMs?: number } = {}) {
    this.maxEntries = opts.maxEntries ?? 3;
    this.maxAgeMs   = opts.maxAgeMs   ?? 150;
  }

  // ── Key generation ────────────────────────────────────────────────────────

  /**
   * Builds a deterministic string key for a capture request.
   *
   * Region captures include all four coordinates so that overlapping but
   * non-identical crops are correctly treated as distinct entries.
   */
  buildKey(
    mode:      'fullscreen' | 'region',
    displayId: number,
    region?:   CaptureRegion
  ): string {
    if (mode === 'region' && region !== undefined) {
      return `region:${displayId}:${region.x},${region.y},${region.width},${region.height}`;
    }
    return `fullscreen:${displayId}`;
  }

  // ── Cache operations ──────────────────────────────────────────────────────

  /**
   * Looks up a result by key.
   *
   * Returns null if:
   *   - the key is not present, or
   *   - the entry exists but has exceeded maxAgeMs (entry is evicted on miss).
   */
  get(key: string): CaptureResult | null {
    const idx = this.entries.findIndex(e => e.key === key);
    if (idx === -1) return null;

    const entry = this.entries[idx];
    const age   = Date.now() - entry.createdAt;

    if (age > this.maxAgeMs) {
      // Expired — evict and return a miss.
      this.entries.splice(idx, 1);
      return null;
    }

    return entry.result;
  }

  /**
   * Inserts or replaces a result for the given key.
   *
   * If the cache is at capacity, the oldest entry (index 0) is evicted before
   * the new one is appended. If the key already exists, the old entry is
   * removed first so the updated version sorts to the end (most recent).
   */
  set(key: string, result: CaptureResult): void {
    // Remove a stale entry with the same key, if any.
    const existingIdx = this.entries.findIndex(e => e.key === key);
    if (existingIdx !== -1) {
      this.entries.splice(existingIdx, 1);
    }

    // Evict the oldest entry if we are at capacity.
    if (this.entries.length >= this.maxEntries) {
      this.entries.shift();
    }

    this.entries.push({ result, key, createdAt: Date.now() });
  }

  /**
   * Clears all cached entries.
   *
   * Call whenever the display configuration changes (display added / removed /
   * resolution changed) to prevent serving stale frames.
   */
  invalidate(): void {
    this.entries = [];
  }

  // ── Diagnostics ───────────────────────────────────────────────────────────

  /**
   * Returns a snapshot of the current cache state for logging or DevTools.
   *
   * `oldestMs` is the age in milliseconds of the oldest live entry, or null
   * when the cache is empty.
   */
  stats(): {
    size:       number;
    maxEntries: number;
    maxAgeMs:   number;
    oldestMs:   number | null;
  } {
    const now     = Date.now();
    const oldest  = this.entries[0];
    const oldestMs = oldest !== undefined ? now - oldest.createdAt : null;

    return {
      size:       this.entries.length,
      maxEntries: this.maxEntries,
      maxAgeMs:   this.maxAgeMs,
      oldestMs,
    };
  }
}
