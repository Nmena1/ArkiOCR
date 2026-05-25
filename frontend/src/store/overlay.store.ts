/**
 * ARKI — Overlay UI Store (Zustand)
 * Controls overlay visibility, position, active panel, and theme.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ActivePanel  = 'ocr' | 'ai' | 'history' | 'settings';
export type OverlaySize  = 'compact' | 'normal' | 'expanded';

interface OverlayState {
  isVisible:       boolean;
  activePanel:     ActivePanel;
  overlaySize:     OverlaySize;
  isClickThrough:  boolean;
  opacity:         number;        // 0.1 – 1.0
  isDragging:      boolean;
}

interface OverlayActions {
  show:            () => void;
  hide:            () => void;
  toggle:          () => void;
  setPanel:        (panel: ActivePanel) => void;
  setSize:         (size: OverlaySize) => void;
  setClickThrough: (enabled: boolean) => void;
  setOpacity:      (opacity: number) => void;
  setDragging:     (dragging: boolean) => void;
}

export const useOverlayStore = create<OverlayState & OverlayActions>()(
  persist(
    (set) => ({
      // ── Initial state ────────────────────────────────────────────────────
      isVisible:      true,
      activePanel:    'ocr',
      overlaySize:    'normal',
      isClickThrough: false,
      opacity:        0.92,
      isDragging:     false,

      // ── Actions ──────────────────────────────────────────────────────────
      show:   () => set({ isVisible: true }),
      hide:   () => set({ isVisible: false }),
      toggle: () => set((s) => ({ isVisible: !s.isVisible })),

      setPanel: (panel) => set({ activePanel: panel }),
      setSize:  (size)  => set({ overlaySize: size }),

      setClickThrough: (enabled) => {
        set({ isClickThrough: enabled });
        // Sync with Electron main process
        if (typeof window !== 'undefined' && window.arki) {
          window.arki.window.setClickThrough(enabled);
        }
      },

      setOpacity: (opacity) => {
        const clamped = Math.min(1.0, Math.max(0.1, opacity));
        set({ opacity: clamped });
      },

      setDragging: (dragging) => set({ isDragging: dragging }),
    }),
    {
      name: 'arki-overlay-settings',
      partialize: (state) => ({
        activePanel:    state.activePanel,
        overlaySize:    state.overlaySize,
        opacity:        state.opacity,
        isClickThrough: state.isClickThrough,
      }),
    }
  )
);
