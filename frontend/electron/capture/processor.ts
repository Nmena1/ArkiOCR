/**
 * ARKI Capture Engine — Image Processor
 *
 * Post-capture image pipeline using ONLY Electron's built-in `nativeImage` API.
 * No sharp, no canvas, no external libraries.
 *
 * Pipeline order per capture:
 *   1. Validate  — reject empty images early
 *   2. Crop      — physical-pixel region, reduces data size for all subsequent ops
 *   3. OCR boost — upscale narrow captures before any resize cap is applied
 *   4. Resize    — fit within dimension caps while preserving aspect ratio
 *   5. Encode    — PNG or JPEG based on quality preset
 */

import { type NativeImage } from 'electron';
import { CaptureError, type ProcessedImage, type ProcessorOptions } from './types';

// ── Quality preset ─────────────────────────────────────────────────────────────

interface QualityPreset {
  format:        'png' | 'jpeg';
  jpegQuality:   number;   // 0-100
  maxWidth:      number;   // 0 = no limit
  maxHeight:     number;   // 0 = no limit
  resizeQuality: 'good' | 'better' | 'best';
}

const QUALITY_PRESETS: Record<string, QualityPreset> = {
  fast:     { format: 'jpeg', jpegQuality: 75,  maxWidth: 1920, maxHeight: 1080, resizeQuality: 'good'   },
  balanced: { format: 'jpeg', jpegQuality: 85,  maxWidth: 2560, maxHeight: 1440, resizeQuality: 'better' },
  best:     { format: 'png',  jpegQuality: 100, maxWidth: 0,    maxHeight: 0,    resizeQuality: 'best'   },
  ocr:      { format: 'jpeg', jpegQuality: 90,  maxWidth: 3840, maxHeight: 2160, resizeQuality: 'best'   },
};

/** Minimum width (native px) that Tesseract / EasyOCR can reliably read. */
const MIN_OCR_WIDTH = 1000;

// ── ImageProcessor ─────────────────────────────────────────────────────────────

export class ImageProcessor {
  constructor(private readonly isDev: boolean) {}

  // ── Public API ───────────────────────────────────────────────────────────────

  /**
   * Main entry point. Takes a nativeImage from desktopCapturer and returns
   * a ProcessedImage ready for base64 encoding.
   *
   * @throws {CaptureError} code='EMPTY_CAPTURE'   when nativeImage is 0×0
   * @throws {CaptureError} code='PROCESS_FAILED'  on any nativeImage failure
   */
  async process(img: NativeImage, opts: ProcessorOptions): Promise<ProcessedImage> {
    const t0 = performance.now();

    try {
      // ── 0. Validate input ──────────────────────────────────────────────────
      const origSize = img.getSize();
      if (origSize.width === 0 || origSize.height === 0) {
        throw new CaptureError('EMPTY_CAPTURE', 'desktopCapturer returned empty image');
      }

      const preset = this.resolvePreset(opts);

      let current = img;

      // ── 1. Crop (physical pixel coords — always first) ─────────────────────
      if (opts.cropNative) {
        current = this.crop(current, opts.cropNative);
      }

      // ── 2. OCR upscale (before resize cap so narrow text gets boosted) ─────
      if (opts.quality === 'ocr') {
        current = this.upscaleForOcr(current);
      }

      // ── 3. Resize to fit within dimension caps ─────────────────────────────
      current = this.resize(current, preset.maxWidth, preset.maxHeight, preset.resizeQuality);

      // ── 4. Encode ──────────────────────────────────────────────────────────
      const { buffer, mimeType } = this.encode(current, preset);
      const finalSize = current.getSize();

      const processMs = Math.round(performance.now() - t0);

      if (this.isDev) {
        console.log(
          `[ImageProcessor] ${opts.quality} ${mimeType} ` +
          `${origSize.width}×${origSize.height} → ${finalSize.width}×${finalSize.height} ` +
          `${(buffer.length / 1024).toFixed(0)}KB  ${processMs}ms`,
        );
      }

      return {
        buffer,
        mimeType,
        // Logical pixels = native pixels / scaleFactor
        width:        Math.round(finalSize.width  / opts.scaleFactor),
        height:       Math.round(finalSize.height / opts.scaleFactor),
        nativeWidth:  finalSize.width,
        nativeHeight: finalSize.height,
        processMs,
      };

    } catch (err) {
      if (err instanceof CaptureError) throw err;
      throw new CaptureError(
        'PROCESS_FAILED',
        `Image processing failed: ${(err as Error).message}`,
      );
    }
  }

  // ── Private pipeline steps ───────────────────────────────────────────────────

  /**
   * Merge the named quality preset with any per-call overrides.
   * opts.format / opts.jpegQuality / opts.maxWidth / opts.maxHeight take precedence.
   */
  private resolvePreset(opts: ProcessorOptions): QualityPreset {
    const base: QualityPreset = { ...QUALITY_PRESETS[opts.quality] };
    if (opts.format      != null) base.format      = opts.format;
    if (opts.jpegQuality != null) base.jpegQuality = opts.jpegQuality;
    if (opts.maxWidth    != null) base.maxWidth    = opts.maxWidth;
    if (opts.maxHeight   != null) base.maxHeight   = opts.maxHeight;
    return base;
  }

  /**
   * Crop the image to physical-pixel coordinates.
   * Clamps the region so it never exceeds actual image dimensions.
   *
   * @throws {CaptureError} code='PROCESS_FAILED' if the clamped region is empty.
   */
  private crop(
    img:        NativeImage,
    cropNative: { x: number; y: number; width: number; height: number },
  ): NativeImage {
    const { width: imgW, height: imgH } = img.getSize();

    const x = Math.max(0, Math.round(cropNative.x));
    const y = Math.max(0, Math.round(cropNative.y));
    const w = Math.min(Math.round(cropNative.width),  imgW - x);
    const h = Math.min(Math.round(cropNative.height), imgH - y);

    if (w <= 0 || h <= 0) {
      throw new CaptureError(
        'PROCESS_FAILED',
        `Crop region is empty after clamping: { x:${x}, y:${y}, width:${w}, height:${h} } ` +
        `against image ${imgW}×${imgH}`,
      );
    }

    return img.crop({ x, y, width: w, height: h });
  }

  /**
   * Downscale the image so it fits within the supplied dimension caps while
   * preserving the aspect ratio.  A scale ≥ 1 is a no-op (never upscales here;
   * use `upscaleForOcr` for the OCR-specific upscale pass).
   */
  private resize(
    img:     NativeImage,
    maxW:    number,
    maxH:    number,
    quality: 'good' | 'better' | 'best',
  ): NativeImage {
    // 0 means no limit on that axis
    if (!maxW && !maxH) return img;

    const { width, height } = img.getSize();
    let scale = 1;

    if (maxW && width  > maxW) scale = Math.min(scale, maxW / width);
    if (maxH && height > maxH) scale = Math.min(scale, maxH / height);

    // Image already fits within bounds — nothing to do
    if (scale >= 1) return img;

    const newW = Math.max(1, Math.round(width  * scale));
    const newH = Math.max(1, Math.round(height * scale));

    return img.resize({ width: newW, height: newH, quality });
  }

  /**
   * OCR-specific pre-pass: upscale images that are too narrow for reliable
   * text recognition.  Applied before the dimension-cap resize so we boost
   * narrow captures without violating the user's maxWidth/maxHeight limits.
   */
  private upscaleForOcr(img: NativeImage): NativeImage {
    const { width, height } = img.getSize();
    if (width >= MIN_OCR_WIDTH) return img;

    const scale = MIN_OCR_WIDTH / width;
    return img.resize({
      width:   Math.round(width  * scale),
      height:  Math.round(height * scale),
      quality: 'best',
    });
  }

  /**
   * Encode the processed image to a buffer.
   * PNG for lossless; JPEG with the preset quality for everything else.
   */
  private encode(
    img:    NativeImage,
    preset: QualityPreset,
  ): { buffer: Buffer; mimeType: 'image/png' | 'image/jpeg' } {
    if (preset.format === 'jpeg') {
      return { buffer: img.toJPEG(preset.jpegQuality), mimeType: 'image/jpeg' };
    }
    return { buffer: img.toPNG(), mimeType: 'image/png' };
  }
}
