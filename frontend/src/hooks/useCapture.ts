/**
 * ARKI — useCapture hook
 *
 * Manages the full capture flow from the overlay window's perspective:
 * - Check / request permissions
 * - Trigger fullscreen or region capture via IPC
 * - Receive CaptureResult
 * - POST to backend /api/capture for OCR processing
 * - Update Zustand store with OCR result
 *
 * Used by: OverlayWindow, OCRResultPanel, capture button in toolbar.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { useArkiStore } from '@/store/arki.store';
import type { CaptureResult, DisplayInfo, PermissionStatus, CaptureMode } from '@/types/capture.types';

// Guard: running in Electron?
const isElectron = () => typeof window !== 'undefined' && !!window.arki?.capture;

interface UseCaptureOptions {
  /** Auto-send to backend for OCR after capture */
  autoOCR?: boolean;
  /** Which display to capture (undefined = primary) */
  displayId?: number;
}

interface UseCaptureReturn {
  // State
  isCapturing:        boolean;
  isSendingToBackend: boolean;
  permission:         PermissionStatus;
  displays:           DisplayInfo[];
  lastResult:         CaptureResult | null;
  error:              string | null;

  // Actions
  captureFullscreen:  (displayId?: number) => Promise<CaptureResult | null>;
  captureRegion:      (displayId?: number) => Promise<CaptureResult | null>;
  checkPermission:    () => Promise<PermissionStatus>;
  requestPermission:  () => Promise<PermissionStatus>;
  loadDisplays:       () => Promise<DisplayInfo[]>;
  sendToBackend:      (result: CaptureResult) => Promise<void>;
  clearError:         () => void;
}

export function useCapture(options: UseCaptureOptions = {}): UseCaptureReturn {
  const { autoOCR = true } = options;

  const [isCapturing,        setIsCapturing]        = useState(false);
  const [isSendingToBackend, setIsSendingToBackend] = useState(false);
  const [permission,         setPermission]         = useState<PermissionStatus>('unknown');
  const [displays,           setDisplays]           = useState<DisplayInfo[]>([]);
  const [lastResult,         setLastResult]         = useState<CaptureResult | null>(null);
  const [error,              setError]              = useState<string | null>(null);

  const { addOCRResult, setCapturing } = useArkiStore(s => ({
    addOCRResult: s.addOCRResult,
    setCapturing: s.setCapturing,
  }));

  const backendUrlRef = useRef('http://127.0.0.1:8000');

  // Load backend URL from Electron once
  useEffect(() => {
    if (isElectron()) {
      window.arki.app.info()
        .then(info => { backendUrlRef.current = info.backendUrl; })
        .catch(() => {});
    }
  }, []);

  // ── Permission ──────────────────────────────────────────────────────────────

  const checkPermission = useCallback(async (): Promise<PermissionStatus> => {
    if (!isElectron()) return 'granted';
    const status = await window.arki.capture.checkPermission();
    setPermission(status);
    return status;
  }, []);

  const requestPermission = useCallback(async (): Promise<PermissionStatus> => {
    if (!isElectron()) return 'granted';
    const status = await window.arki.capture.requestPermission();
    setPermission(status);
    return status;
  }, []);

  // Check permission on mount
  useEffect(() => { checkPermission(); }, [checkPermission]);

  // ── Displays ────────────────────────────────────────────────────────────────

  const loadDisplays = useCallback(async (): Promise<DisplayInfo[]> => {
    if (!isElectron()) return [];
    const list = await window.arki.capture.getDisplays();
    setDisplays(list);
    return list;
  }, []);

  useEffect(() => { loadDisplays(); }, [loadDisplays]);

  // ── Backend POST ────────────────────────────────────────────────────────────

  const sendToBackend = useCallback(async (result: CaptureResult): Promise<void> => {
    setIsSendingToBackend(true);
    try {
      const res = await fetch(`${backendUrlRef.current}/api/capture`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          image_base64: result.imageBase64,
          mime_type:    result.mimeType,
          ocr_provider: 'auto',
          analyze_with_ai: false,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail ?? `Backend error ${res.status}`);
      }

      const ocrResult = await res.json();
      addOCRResult(ocrResult);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to send to backend';
      setError(msg);
      console.error('[useCapture] sendToBackend error:', err);
    } finally {
      setIsSendingToBackend(false);
    }
  }, [addOCRResult]);

  // ── Capture actions ─────────────────────────────────────────────────────────

  const runCapture = useCallback(async (
    mode: CaptureMode,
    displayId?: number,
  ): Promise<CaptureResult | null> => {
    if (!isElectron()) {
      setError('Screen capture is only available in the Electron app.');
      return null;
    }

    const perm = await checkPermission();
    if (perm === 'denied' || perm === 'restricted') {
      setError('Screen recording permission denied. Please grant access in System Preferences.');
      return null;
    }

    setIsCapturing(true);
    setCapturing(true);
    setError(null);

    try {
      const result: CaptureResult | null = mode === 'fullscreen'
        ? await window.arki.capture.captureFullscreen(displayId)
        : await window.arki.capture.captureRegion(displayId);

      if (!result) return null; // Cancelled

      setLastResult(result);

      if (autoOCR) {
        await sendToBackend(result);
      }

      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Capture failed';
      setError(msg);
      console.error('[useCapture] capture error:', err);
      return null;
    } finally {
      setIsCapturing(false);
      setCapturing(false);
    }
  }, [checkPermission, autoOCR, sendToBackend, setCapturing]);

  const captureFullscreen = useCallback(
    (displayId?: number) => runCapture('fullscreen', displayId),
    [runCapture],
  );

  const captureRegion = useCallback(
    (displayId?: number) => runCapture('region', displayId),
    [runCapture],
  );

  return {
    isCapturing,
    isSendingToBackend,
    permission,
    displays,
    lastResult,
    error,
    captureFullscreen,
    captureRegion,
    checkPermission,
    requestPermission,
    loadDisplays,
    sendToBackend,
    clearError: () => setError(null),
  };
}
