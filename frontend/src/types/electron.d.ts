/**
 * ARKI — window.arki contextBridge type declarations
 * Injected by electron/preload.ts
 */

import type { CaptureResult, DisplayInfo, PermissionStatus, SelectorInitPayload } from './capture.types';

export {};

declare global {
  interface Window {
    arki: {
      window: {
        minimize:        () => void;
        close:           () => void;
        hide:            () => void;
        setClickThrough: (enabled: boolean) => void;
        resize:          (width: number, height: number) => void;
        move:            (x: number, y: number) => void;
      };

      backend: {
        health: () => Promise<{ ok: boolean; status: number }>;
      };

      app: {
        info: () => Promise<{
          version:      string;
          name:         string;
          isDev:        boolean;
          platform:     string;
          backendUrl:   string;
          websocketUrl: string;
        }>;
        openExternal: (url: string) => void;
      };

      capture: {
        getDisplays:       () => Promise<DisplayInfo[]>;
        checkPermission:   () => Promise<PermissionStatus>;
        requestPermission: () => Promise<PermissionStatus>;
        captureFullscreen: (displayId?: number) => Promise<CaptureResult>;
        captureRegion:     (displayId?: number) => Promise<CaptureResult | null>;
        confirmRegion:     (region: { x: number; y: number; width: number; height: number }) => void;
        cancelRegion:      () => void;
        onSelectorInit:    (listener: (payload: SelectorInitPayload) => void) => () => void;
      };

      events: {
        onCaptureTrigger:    (listener: (...args: unknown[]) => void) => () => void;
        onAnalyzeTrigger:    (listener: (...args: unknown[]) => void) => () => void;
        onClearSession:      (listener: (...args: unknown[]) => void) => () => void;
        removeAllListeners:  (channel: string) => void;
      };

      ipc: {
        send:   (channel: string, ...args: unknown[]) => void;
        invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
      };
    };
  }
}
