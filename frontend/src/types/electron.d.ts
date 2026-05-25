/**
 * TypeScript declarations for window.arki (contextBridge API)
 * These are injected by electron/preload.ts
 */

export {};

declare global {
  interface Window {
    arki: {
      window: {
        minimize: () => void;
        close: () => void;
        hide: () => void;
        setClickThrough: (enabled: boolean) => void;
        resize: (width: number, height: number) => void;
        move: (x: number, y: number) => void;
      };
      backend: {
        health: () => Promise<{ ok: boolean; status: number }>;
      };
      app: {
        info: () => Promise<{
          version: string;
          name: string;
          isDev: boolean;
          platform: string;
          backendUrl: string;
          websocketUrl: string;
        }>;
        openExternal: (url: string) => void;
      };
      events: {
        onCaptureTrigger: (listener: (...args: unknown[]) => void) => () => void;
        onAnalyzeTrigger: (listener: (...args: unknown[]) => void) => () => void;
        onClearSession:   (listener: (...args: unknown[]) => void) => () => void;
        removeAllListeners: (channel: string) => void;
      };
      ipc: {
        send: (channel: string, ...args: unknown[]) => void;
        invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
      };
    };
  }
}
