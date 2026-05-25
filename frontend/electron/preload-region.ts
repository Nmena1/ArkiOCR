/**
 * ARKI — Region Selector Preload
 * Minimal bridge between the region selector renderer and main process.
 * Security: strict allowlists, no raw ipcRenderer exposed.
 */
import { contextBridge, ipcRenderer } from 'electron';

const SEND_CHANNELS    = ['capture:region-confirmed', 'capture:region-cancelled'] as const;
const RECEIVE_CHANNELS = ['capture:selector-init'] as const;

// Same validator pattern as other preloads
function assertSend(ch: string): void {
  if (!(SEND_CHANNELS as readonly string[]).includes(ch))
    throw new Error(`[RegionPreload] Blocked send: ${ch}`);
}

// Types inlined (preload runs isolated, cannot import from other files)
interface SelectorInitPayload {
  screenshot:    string;
  displayBounds: { width: number; height: number };
  scaleFactor:   number;
  theme:         'dark' | 'light';
}

interface RegionPayload {
  x: number; y: number; width: number; height: number;
}

contextBridge.exposeInMainWorld('arki_region', {
  /**
   * Subscribe to the init event from main.
   * Main sends the screenshot + display metadata when the window is ready.
   * Returns unsubscribe function.
   */
  onInit: (listener: (payload: SelectorInitPayload) => void): (() => void) => {
    const wrapped = (_e: Electron.IpcRendererEvent, payload: SelectorInitPayload) => listener(payload);
    ipcRenderer.on('capture:selector-init', wrapped);
    return () => ipcRenderer.removeListener('capture:selector-init', wrapped);
  },

  /** Send the confirmed region back to main (logical CSS pixels). */
  confirmRegion: (region: RegionPayload): void => {
    if (
      typeof region.x !== 'number' || typeof region.y !== 'number' ||
      typeof region.width !== 'number' || typeof region.height !== 'number'
    ) throw new TypeError('[RegionPreload] region fields must be numbers');
    if (region.width < 1 || region.height < 1)
      throw new RangeError('[RegionPreload] region dimensions must be positive');
    assertSend('capture:region-confirmed');
    ipcRenderer.send('capture:region-confirmed', region);
  },

  /** Send cancellation signal to main. */
  cancel: (): void => {
    assertSend('capture:region-cancelled');
    ipcRenderer.send('capture:region-cancelled');
  },
});
