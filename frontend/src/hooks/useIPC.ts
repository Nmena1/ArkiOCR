/**
 * ARKI — useIPC Hook
 * Subscribes to IPC events from the Electron main process.
 * Auto-cleans listeners on unmount.
 */

import { useEffect, useCallback } from 'react';
import { useArkiStore } from '@/store/arki.store';

// Guard: running inside Electron?
const isElectron = () => typeof window !== 'undefined' && !!window.arki;

export function useIPC() {
  const { setCapturing, clearSession, setAIProcessing } = useArkiStore();

  // ── Capture trigger (hotkey: Cmd+Shift+S) ─────────────────────────────────
  const handleCaptureTrigger = useCallback(() => {
    setCapturing(true);
    // The backend handles actual screen capture via REST POST /api/capture
    // We just set the UI to "capturing" state here
    // The WebSocket will deliver the OCR result when done
  }, [setCapturing]);

  // ── Deep analysis trigger (hotkey: Cmd+Shift+X) ───────────────────────────
  const handleAnalyzeTrigger = useCallback(() => {
    setAIProcessing(true);
    // Backend triggered via REST POST /api/analyze with activeOCRId
  }, [setAIProcessing]);

  // ── Clear session (hotkey: Cmd+Shift+C) ───────────────────────────────────
  const handleClearSession = useCallback(() => {
    clearSession();
  }, [clearSession]);

  useEffect(() => {
    if (!isElectron()) return;

    const unsubCapture  = window.arki.events.onCaptureTrigger(handleCaptureTrigger);
    const unsubAnalyze  = window.arki.events.onAnalyzeTrigger(handleAnalyzeTrigger);
    const unsubClear    = window.arki.events.onClearSession(handleClearSession);

    return () => {
      unsubCapture();
      unsubAnalyze();
      unsubClear();
    };
  }, [handleCaptureTrigger, handleAnalyzeTrigger, handleClearSession]);

  return {
    isElectron: isElectron(),
  };
}
