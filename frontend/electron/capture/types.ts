/**
 * ARKI Capture Engine — Shared Types
 *
 * Single source of truth for all capture-related interfaces and enumerations.
 * Every other file in this module imports from here; no circular dependencies.
 */

// ── Core capture types ────────────────────────────────────────────────────────

/** Logical-pixel region within a display (before scaleFactor is applied). */
export interface CaptureRegion {
  x:       number;
  y:       number;
  width:   number;
  height:  number;
}

/** Options controlling how a capture is performed. */
export interface CaptureOptions {
  /** 'fullscreen' → entire display | 'region' → user-drawn rectangle */
  mode: 'fullscreen' | 'region';

  /**
   * Target display by Electron `Display.id`.
   * Omit to use the display that currently contains the cursor (active-window heuristic).
   */
  displayId?: number;

  /**
   * Image quality/compression trade-off:
   *   'fast'      → JPEG 75, ≤ 1920 px wide   — smallest file, fastest OCR upload
   *   'balanced'  → JPEG 85, ≤ 2560 px wide   — default
   *   'best'      → PNG lossless, native res   — archival / highest fidelity
   *   'ocr'       → JPEG 90, upscale < 1000 px — tuned for Tesseract / EasyOCR
   */
  quality?: 'fast' | 'balanced' | 'best' | 'ocr';

  /** Output format override (default follows quality preset). */
  format?: 'png' | 'jpeg';

  /** 0-100 JPEG quality override (only used when format is 'jpeg'). */
  jpegQuality?: number;

  /** Hard cap on output width in logical pixels (aspect ratio preserved). */
  maxWidth?: number;

  /** Hard cap on output height in logical pixels (aspect ratio preserved). */
  maxHeight?: number;

  /**
   * Pre-captured region (logical px). When supplied together with mode='region',
   * skips the interactive selector and jumps straight to crop + process.
   */
  region?: CaptureRegion;

  /** Screenshot delay in ms — give windows time to settle before capture. */
  delayMs?: number;
}

/** Metadata for a connected display. */
export interface DisplayInfo {
  id:          number;
  label:       string;
  bounds:      { x: number; y: number; width: number; height: number };
  workArea:    { x: number; y: number; width: number; height: number };
  scaleFactor: number;
  rotation:    number;   // degrees: 0 | 90 | 180 | 270
  isPrimary:   boolean;
}

/** Result returned by CaptureManager after a successful capture + process. */
export interface CaptureResult {
  /** Base64-encoded image (PNG or JPEG depending on quality preset). */
  imageBase64:  string;

  /** MIME type matching imageBase64 content. */
  mimeType:     'image/png' | 'image/jpeg';

  /** Output dimensions in logical pixels. */
  width:        number;
  height:       number;

  /** Output dimensions in native (physical) pixels. */
  nativeWidth:  number;
  nativeHeight: number;

  /** The display this capture came from. */
  displayId:    number;
  scaleFactor:  number;

  /**
   * The cropped region (logical px) for mode='region'.
   * Matches the full display bounds for mode='fullscreen'.
   */
  region:       CaptureRegion;

  /** Per-stage timing for diagnostics. */
  timing: {
    captureMs:   number;  // desktopCapturer.getSources() round-trip
    processMs:   number;  // compression + crop + resize
    totalMs:     number;
  };

  /** Quality preset that was applied. */
  quality: 'fast' | 'balanced' | 'best' | 'ocr';
}

// ── Processed image (internal pipeline type) ─────────────────────────────────

/** Intermediate type between raw nativeImage and the final CaptureResult. */
export interface ProcessedImage {
  buffer:      Buffer;
  mimeType:    'image/png' | 'image/jpeg';
  width:       number;   // logical pixels
  height:      number;
  nativeWidth: number;   // physical pixels
  nativeHeight: number;
  processMs:   number;
}

/** Options for ImageProcessor. */
export interface ProcessorOptions {
  quality:       'fast' | 'balanced' | 'best' | 'ocr';
  format?:       'png' | 'jpeg';
  jpegQuality?:  number;
  maxWidth?:     number;
  maxHeight?:    number;
  /** If set, crop to this region before other transforms. Coords in native pixels. */
  cropNative?:   { x: number; y: number; width: number; height: number };
  scaleFactor:   number;  // used to convert logical ↔ native
}

// ── Permissions ───────────────────────────────────────────────────────────────

export type PermissionStatus =
  | 'granted'
  | 'denied'
  | 'not-determined'
  | 'restricted'
  | 'unknown';

// ── Region selector ───────────────────────────────────────────────────────────

/** Payload sent from main process → region selector BrowserWindow. */
export interface SelectorInitPayload {
  /** Base64 PNG of the full display at logical resolution. */
  screenshot:    string;
  /** Logical-pixel bounds of the display. */
  displayBounds: { width: number; height: number };
  scaleFactor:   number;
  /** Theme passed for UI consistency. */
  theme:         'dark' | 'light';
}

/** Payload sent from region selector → main process on confirm. */
export interface RegionConfirmedPayload {
  /** Coordinates in logical (CSS) pixels. */
  x:      number;
  y:      number;
  width:  number;
  height: number;
}

// ── Source cache ──────────────────────────────────────────────────────────────

export interface SourceCacheEntry {
  sources:    Electron.DesktopCapturerSource[];
  capturedAt: number;  // Date.now()
  thumbW:     number;
  thumbH:     number;
}

// ── Errors ────────────────────────────────────────────────────────────────────

export type CaptureErrorCode =
  | 'PERMISSION_DENIED'    // macOS screen recording denied
  | 'PERMISSION_UNKNOWN'   // could not determine macOS permission
  | 'NO_SOURCE_FOUND'      // desktopCapturer returned no matching source
  | 'CAPTURE_FAILED'       // getSources() threw
  | 'PROCESS_FAILED'       // nativeImage processing failed
  | 'REGION_CANCELLED'     // user pressed ESC / cancelled selector
  | 'SELECTOR_TIMEOUT'     // region selector window timed out
  | 'DISPLAY_NOT_FOUND'    // displayId not in getAllDisplays()
  | 'EMPTY_CAPTURE'        // image was 0×0 or empty buffer
  | 'UNKNOWN';

export class CaptureError extends Error {
  readonly code:        CaptureErrorCode;
  readonly recoverable: boolean;  // true = user can retry; false = needs config change

  constructor(code: CaptureErrorCode, message: string, recoverable = true) {
    super(message);
    this.name       = 'CaptureError';
    this.code       = code;
    this.recoverable = recoverable;
    // Maintains proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, CaptureError.prototype);
  }
}
