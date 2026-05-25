/**
 * ARKI — CaptureSelector
 *
 * Full-screen transparent canvas overlay loaded inside the dedicated selector
 * BrowserWindow. Communicates selection back to main via IPC.
 *
 * UX:
 *  - Screenshot shown as background (semi-dimmed)
 *  - Crosshair cursor
 *  - Drag to draw selection (bright cut-out in dim overlay)
 *  - Live W×H label near cursor
 *  - ESC or right-click → cancel
 *  - Enter or double-click inside selection → confirm
 *  - Minimum size: 10×10 logical px
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import type { SelectorInitPayload } from '@/types/capture.types';

// ── Types ─────────────────────────────────────────────────────────────────────

interface DragState {
  startX: number;
  startY: number;
  endX:   number;
  endY:   number;
  active: boolean;
}

interface SelectionRect {
  x:      number;
  y:      number;
  width:  number;
  height: number;
}

const MIN_SIZE     = 10;      // minimum selection px
const OVERLAY_FILL = 'rgba(0, 0, 0, 0.45)';
const BORDER_COLOR = '#6366f1';
const BORDER_WIDTH = 1.5;
const HANDLE_SIZE  = 6;
const LABEL_FONT   = '12px "JetBrains Mono", monospace';
const LABEL_BG     = 'rgba(99, 102, 241, 0.9)';
const LABEL_COLOR  = '#ffffff';
const CROSSHAIR    = 'crosshair';

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalizeRect(x1: number, y1: number, x2: number, y2: number): SelectionRect {
  return {
    x:      Math.min(x1, x2),
    y:      Math.min(y1, y2),
    width:  Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
  };
}

function isValidSelection(r: SelectionRect): boolean {
  return r.width >= MIN_SIZE && r.height >= MIN_SIZE;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function CaptureSelector() {
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const bgImageRef  = useRef<HTMLImageElement | null>(null);
  const dragRef     = useRef<DragState>({ startX: 0, startY: 0, endX: 0, endY: 0, active: false });
  const mouseRef    = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const [payload, setPayload]     = useState<SelectorInitPayload | null>(null);
  const [selection, setSelection] = useState<SelectionRect | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const rafRef = useRef<number>(0);

  // ── IPC init ────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!window.arki) return;
    const unsub = window.arki.capture.onSelectorInit((data: SelectorInitPayload) => {
      setPayload(data);
      const img = new Image();
      img.onload = () => { bgImageRef.current = img; };
      img.src = `data:image/png;base64,${data.screenshot}`;
    });
    return unsub;
  }, []);

  // ── Keyboard shortcuts ───────────────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        window.arki?.capture.cancelRegion();
      } else if (e.key === 'Enter' && selection && isValidSelection(selection)) {
        window.arki?.capture.confirmRegion(selection);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selection]);

  // ── Canvas draw ──────────────────────────────────────────────────────────────

  const drawFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    // Background screenshot
    if (bgImageRef.current) {
      ctx.drawImage(bgImageRef.current, 0, 0, W, H);
    }

    // Full dim overlay
    ctx.fillStyle = OVERLAY_FILL;
    ctx.fillRect(0, 0, W, H);

    // Compute current selection
    const drag = dragRef.current;
    const rect: SelectionRect | null =
      isDragging || drag.active
        ? normalizeRect(drag.startX, drag.startY, drag.endX, drag.endY)
        : selection;

    if (rect && (isDragging || (rect.width >= MIN_SIZE && rect.height >= MIN_SIZE))) {
      // Clear selection area (show bright screenshot underneath)
      ctx.clearRect(rect.x, rect.y, rect.width, rect.height);
      if (bgImageRef.current) {
        ctx.drawImage(bgImageRef.current, rect.x, rect.y, rect.width, rect.height, rect.x, rect.y, rect.width, rect.height);
      }

      // Selection border
      ctx.strokeStyle = BORDER_COLOR;
      ctx.lineWidth   = BORDER_WIDTH;
      ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.width - 1, rect.height - 1);

      // Corner handles
      const hs = HANDLE_SIZE;
      ctx.fillStyle = BORDER_COLOR;
      const corners = [
        [rect.x,              rect.y],
        [rect.x + rect.width - hs, rect.y],
        [rect.x,              rect.y + rect.height - hs],
        [rect.x + rect.width - hs, rect.y + rect.height - hs],
      ];
      for (const [cx, cy] of corners) {
        ctx.fillRect(cx, cy, hs, hs);
      }

      // W×H label
      const mx = mouseRef.current.x;
      const my = mouseRef.current.y;
      const label = `${rect.width} × ${rect.height}`;
      ctx.font = LABEL_FONT;
      const tw = ctx.measureText(label).width;
      const lx = Math.min(mx + 14, W - tw - 16);
      const ly = my < 30 ? my + 24 : my - 8;
      ctx.fillStyle = LABEL_BG;
      ctx.beginPath();
      ctx.roundRect(lx - 6, ly - 14, tw + 12, 20, 4);
      ctx.fill();
      ctx.fillStyle = LABEL_COLOR;
      ctx.fillText(label, lx, ly);
    } else if (!isDragging) {
      // Crosshair lines at cursor
      const { x, y } = mouseRef.current;
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth   = 0.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      ctx.setLineDash([]);

      // Instruction label
      const inst = 'Click and drag to select a region  ·  ESC to cancel';
      ctx.font = '13px Inter, system-ui, sans-serif';
      const iw = ctx.measureText(inst).width;
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.beginPath();
      ctx.roundRect((W - iw) / 2 - 12, H / 2 - 18, iw + 24, 30, 6);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.fillText(inst, (W - iw) / 2, H / 2);
    }
  }, [isDragging, selection]);

  // Continuous RAF loop while component is mounted
  useEffect(() => {
    let running = true;
    const loop = () => {
      if (!running) return;
      drawFrame();
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      running = false;
      cancelAnimationFrame(rafRef.current);
    };
  }, [drawFrame]);

  // ── Canvas sizing ────────────────────────────────────────────────────────────

  useEffect(() => {
    const resize = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width  = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  // ── Mouse events ─────────────────────────────────────────────────────────────

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button === 2) { // right-click → cancel
      window.arki?.capture.cancelRegion();
      return;
    }
    if (e.button !== 0) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, endX: e.clientX, endY: e.clientY, active: true };
    setIsDragging(true);
    setSelection(null);
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    mouseRef.current = { x: e.clientX, y: e.clientY };
    if (dragRef.current.active) {
      dragRef.current.endX = e.clientX;
      dragRef.current.endY = e.clientY;
    }
  }, []);

  const handleMouseUp = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!dragRef.current.active) return;
    dragRef.current.active = false;
    dragRef.current.endX   = e.clientX;
    dragRef.current.endY   = e.clientY;

    const rect = normalizeRect(
      dragRef.current.startX, dragRef.current.startY,
      dragRef.current.endX,   dragRef.current.endY,
    );

    setIsDragging(false);

    if (!isValidSelection(rect)) {
      setSelection(null);
      return;
    }

    setSelection(rect);
  }, []);

  const handleDoubleClick = useCallback((_e: React.MouseEvent<HTMLCanvasElement>) => {
    if (selection && isValidSelection(selection)) {
      window.arki?.capture.confirmRegion(selection);
    }
  }, [selection]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    window.arki?.capture.cancelRegion();
  }, []);

  // ── Toolbar (shown when selection exists) ────────────────────────────────────

  const toolbar = selection && isValidSelection(selection) ? (
    <div
      style={{
        position: 'fixed',
        left:  Math.min(selection.x + selection.width / 2 - 80, window.innerWidth - 180),
        top:   selection.y + selection.height + 8,
        zIndex: 1000,
      }}
      className="flex items-center gap-2 bg-arki-surface/95 backdrop-blur border border-arki-accent/40
                 rounded-lg px-3 py-1.5 shadow-xl pointer-events-auto"
    >
      <span className="text-[11px] text-arki-text-muted font-mono">
        {selection.width}×{selection.height}
      </span>
      <div className="w-px h-3 bg-arki-border" />
      <button
        onClick={() => window.arki?.capture.confirmRegion(selection)}
        className="text-[11px] font-medium text-arki-accent hover:text-arki-accent-hover
                   flex items-center gap-1 transition-colors"
      >
        ✓ Capture <span className="text-arki-text-muted">(Enter)</span>
      </button>
      <button
        onClick={() => window.arki?.capture.cancelRegion()}
        className="text-[11px] text-arki-text-muted hover:text-arki-text transition-colors"
      >
        ✕ Cancel <span className="text-arki-text-muted">(Esc)</span>
      </button>
    </div>
  ) : null;

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div
      className="fixed inset-0 overflow-hidden select-none"
      style={{ background: 'transparent', cursor: CROSSHAIR }}
      onContextMenu={handleContextMenu}
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
        style={{ cursor: CROSSHAIR }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onDoubleClick={handleDoubleClick}
      />
      {toolbar}
    </div>
  );
}
