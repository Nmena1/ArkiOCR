/**
 * ARKI — Overlay Window Root Component
 *
 * The main transparent overlay container. Features:
 * - Draggable title bar
 * - Panel navigation tabs (OCR | AI | History | Settings)
 * - Connection status indicator
 * - Minimize/close controls
 * - Animated panel transitions
 */

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ScanLine, Brain, History, Settings, Minus, X,
  Wifi, WifiOff, Circle
} from 'lucide-react';
import { clsx } from 'clsx';

import { useOverlayStore, type ActivePanel } from '@/store/overlay.store';
import { useArkiStore }  from '@/store/arki.store';
import { OCRResultPanel } from '@/components/OCRResultPanel';
import { AIPanel }        from '@/components/AIPanel';

interface Props {
  connectionState: 'connecting' | 'connected' | 'disconnected' | 'error';
  appVersion?: string;
}

const TABS: { id: ActivePanel; icon: typeof ScanLine; label: string }[] = [
  { id: 'ocr',      icon: ScanLine, label: 'OCR'      },
  { id: 'ai',       icon: Brain,    label: 'AI'        },
  { id: 'history',  icon: History,  label: 'History'   },
  { id: 'settings', icon: Settings, label: 'Settings'  },
];

export function OverlayWindow({ connectionState, appVersion }: Props) {
  const { activePanel, setPanel, opacity, isCapturing } = useOverlayStore(
    (s) => ({ activePanel: s.activePanel, setPanel: s.setPanel, opacity: s.opacity, isCapturing: false })
  );
  const { isConnected, backendStatus, ocrResults, aiResponses, isAIProcessing } = useArkiStore(
    (s) => ({
      isConnected:    s.isConnected,
      backendStatus:  s.backendStatus,
      ocrResults:     s.ocrResults,
      aiResponses:    s.aiResponses,
      isAIProcessing: s.isAIProcessing,
    })
  );

  const connectionIcon = connectionState === 'connected'
    ? <Wifi    size={10} className="text-arki-success" />
    : connectionState === 'connecting'
    ? <Circle  size={10} className="text-arki-warning animate-pulse" />
    : <WifiOff size={10} className="text-arki-danger" />;

  return (
    <div
      className="arki-overlay w-full h-full flex flex-col overflow-hidden"
      style={{ opacity }}
    >
      {/* ── Title Bar ──────────────────────────────────────────────────────── */}
      <div className="arki-drag-handle flex items-center justify-between px-3 py-2 border-b border-arki-border shrink-0">
        {/* Left: Logo + status */}
        <div className="arki-no-drag flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <div className="w-5 h-5 rounded-md bg-arki-accent/20 flex items-center justify-center">
              <span className="text-arki-accent text-[9px] font-bold">AR</span>
            </div>
            <span className="text-arki-text text-xs font-semibold tracking-wide">ARKI</span>
          </div>
          <div className="flex items-center gap-1 text-arki-text-muted">
            {connectionIcon}
            <span className="text-[10px]">
              {connectionState === 'connected' ? 'Live'
                : connectionState === 'connecting' ? 'Connecting...'
                : 'Offline'}
            </span>
          </div>
        </div>

        {/* Right: Window controls */}
        <div className="arki-no-drag flex items-center gap-1">
          {appVersion && (
            <span className="text-[9px] text-arki-text-muted mr-1">v{appVersion}</span>
          )}
          <button
            onClick={() => window.arki?.window.hide()}
            className="w-5 h-5 rounded flex items-center justify-center text-arki-text-muted
                       hover:text-arki-text hover:bg-arki-border transition-colors"
            title="Hide (Cmd+Shift+A)"
          >
            <Minus size={10} />
          </button>
          <button
            onClick={() => window.arki?.window.close()}
            className="w-5 h-5 rounded flex items-center justify-center text-arki-text-muted
                       hover:text-arki-danger hover:bg-arki-danger/10 transition-colors"
            title="Quit ARKI"
          >
            <X size={10} />
          </button>
        </div>
      </div>

      {/* ── Capture indicator ──────────────────────────────────────────────── */}
      <AnimatePresence>
        {(isAIProcessing || backendStatus === 'busy') && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="px-3 py-1.5 bg-arki-accent/10 border-b border-arki-accent/20 shrink-0"
          >
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-arki-accent animate-thinking" />
              <span className="text-[10px] text-arki-accent">
                {isAIProcessing ? 'Analyzing with AI...' : 'Processing...'}
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Tab Navigation ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 px-2 pt-2 pb-1 shrink-0">
        {TABS.map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            onClick={() => setPanel(id)}
            className={clsx(
              'arki-tab flex items-center gap-1.5',
              activePanel === id && 'active'
            )}
          >
            <Icon size={11} />
            <span>{label}</span>
            {/* Badge counts */}
            {id === 'ocr' && ocrResults.length > 0 && (
              <span className="text-[9px] bg-arki-accent/20 text-arki-accent rounded-full px-1">
                {ocrResults.length}
              </span>
            )}
            {id === 'ai' && aiResponses.length > 0 && (
              <span className="text-[9px] bg-arki-accent/20 text-arki-accent rounded-full px-1">
                {aiResponses.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Panel Content ──────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-hidden relative">
        <AnimatePresence mode="wait">
          <motion.div
            key={activePanel}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.12 }}
            className="absolute inset-0 overflow-y-auto"
          >
            {activePanel === 'ocr'      && <OCRResultPanel />}
            {activePanel === 'ai'       && <AIPanel />}
            {activePanel === 'history'  && <HistoryPlaceholder />}
            {activePanel === 'settings' && <SettingsPlaceholder />}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* ── Status Bar ─────────────────────────────────────────────────────── */}
      <StatusBar />
    </div>
  );
}

function HistoryPlaceholder() {
  return (
    <div className="flex flex-col items-center justify-center h-full p-6 text-center">
      <History size={24} className="text-arki-text-muted mb-2" />
      <p className="text-arki-text-muted text-xs">Session history coming in Phase 2</p>
    </div>
  );
}

function SettingsPlaceholder() {
  return (
    <div className="flex flex-col items-center justify-center h-full p-6 text-center">
      <Settings size={24} className="text-arki-text-muted mb-2" />
      <p className="text-arki-text-muted text-xs">Settings panel coming soon</p>
    </div>
  );
}

function StatusBar() {
  const { session, isConnected } = useArkiStore(
    (s) => ({ session: s.session, isConnected: s.isConnected })
  );

  return (
    <div className="flex items-center justify-between px-3 py-1.5 border-t border-arki-border text-[10px] text-arki-text-muted shrink-0">
      <div className="flex items-center gap-2">
        <span>Captures: {session?.capture_count ?? 0}</span>
        <span>·</span>
        <span>AI calls: {session?.ai_call_count ?? 0}</span>
      </div>
      {session && (
        <span className={clsx(
          session.total_cost_usd >= session.cost_alert_threshold
            ? 'text-arki-warning'
            : 'text-arki-text-muted'
        )}>
          ${session.total_cost_usd.toFixed(4)}
        </span>
      )}
    </div>
  );
}
