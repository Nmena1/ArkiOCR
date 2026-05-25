/**
 * ARKI — OCR Result Panel
 * Displays the most recent OCR capture with content-type aware rendering.
 */

import { motion, AnimatePresence } from 'framer-motion';
import { ScanLine, Copy, Zap, CheckCircle, AlertCircle, Code, Calculator, AlignLeft, Table } from 'lucide-react';
import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { clsx } from 'clsx';

import { useArkiStore, selectActiveOCR } from '@/store/arki.store';
import type { OCRResult, ContentType } from '@/types/ipc.types';

const CONTENT_TYPE_ICONS: Record<ContentType, typeof Code> = {
  code:    Code,
  math:    Calculator,
  text:    AlignLeft,
  table:   Table,
  mixed:   AlignLeft,
  unknown: AlignLeft,
};

const CONTENT_TYPE_LABELS: Record<ContentType, string> = {
  code:    'Source Code',
  math:    'Mathematical Expression',
  text:    'Plain Text',
  table:   'Table / Grid',
  mixed:   'Mixed Content',
  unknown: 'Unknown',
};

export function OCRResultPanel() {
  const { ocrResults, isCapturing } = useArkiStore((s) => ({
    ocrResults:  s.ocrResults,
    isCapturing: s.isCapturing,
  }));
  const activeResult = useArkiStore(selectActiveOCR);

  if (isCapturing) {
    return (
      <div className="flex flex-col items-center justify-center h-40 gap-3">
        <div className="w-8 h-8 rounded-full border-2 border-arki-accent border-t-transparent animate-spin" />
        <p className="text-arki-text-muted text-xs">Capturing & extracting text...</p>
      </div>
    );
  }

  if (!activeResult) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6 text-center gap-3">
        <div className="w-12 h-12 rounded-xl bg-arki-border flex items-center justify-center">
          <ScanLine size={20} className="text-arki-text-muted" />
        </div>
        <div>
          <p className="text-arki-text text-xs font-medium">No capture yet</p>
          <p className="text-arki-text-muted text-[11px] mt-1">
            Press <kbd className="bg-arki-border px-1 rounded text-[10px]">⌘⇧S</kbd> to capture
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-3 space-y-3">
      <OCRResultCard result={activeResult} isActive />
    </div>
  );
}

interface OCRResultCardProps {
  result: OCRResult;
  isActive?: boolean;
}

function OCRResultCard({ result, isActive }: OCRResultCardProps) {
  const [copied, setCopied] = useState(false);
  const { setAIProcessing } = useArkiStore((s) => ({ setAIProcessing: s.setAIProcessing }));

  const Icon = CONTENT_TYPE_ICONS[result.content_type] ?? AlignLeft;
  const hasError = !!result.error;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(result.cleaned_text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleAnalyze = () => {
    setAIProcessing(true);
    // REST call to POST /api/analyze — handled by parent via REST
    fetch('http://127.0.0.1:8000/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ocr_result_id: result.id,
        analysis_type: 'explain',
        model: 'mini',
      }),
    })
      .then((r) => r.json())
      .catch(console.error);
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={clsx(
        'rounded-xl border p-3 space-y-2.5',
        isActive ? 'border-arki-accent/30 bg-arki-accent/5' : 'border-arki-border bg-arki-surface'
      )}
    >
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Icon size={12} className="text-arki-accent" />
          <span className="text-[11px] font-medium text-arki-text">
            {CONTENT_TYPE_LABELS[result.content_type]}
          </span>
          {result.detected_language && (
            <span className="text-[9px] bg-arki-accent/15 text-arki-accent px-1.5 py-0.5 rounded-full">
              {result.detected_language}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 text-[10px] text-arki-text-muted">
          {hasError
            ? <AlertCircle size={10} className="text-arki-danger" />
            : <CheckCircle size={10} className="text-arki-success" />
          }
          <span>{Math.round(result.confidence * 100)}%</span>
          <span>·</span>
          <span>{result.processing_ms}ms</span>
        </div>
      </div>

      {/* ── Content ────────────────────────────────────────────────────────── */}
      {hasError ? (
        <div className="text-[11px] text-arki-danger bg-arki-danger/10 rounded-lg p-2">
          OCR Error: {result.error}
        </div>
      ) : (
        <div className="arki-code text-[11px] max-h-40 overflow-y-auto leading-relaxed">
          {result.cleaned_text || <span className="text-arki-text-muted italic">Empty result</span>}
        </div>
      )}

      {/* ── Actions ────────────────────────────────────────────────────────── */}
      {!hasError && (
        <div className="flex items-center gap-2 pt-0.5">
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 text-[10px] text-arki-text-muted
                       hover:text-arki-text transition-colors"
          >
            <AnimatePresence mode="wait">
              {copied ? (
                <motion.span key="check" initial={{ scale: 0.8 }} animate={{ scale: 1 }}
                  className="text-arki-success flex items-center gap-1">
                  <CheckCircle size={10} /> Copied
                </motion.span>
              ) : (
                <motion.span key="copy" className="flex items-center gap-1">
                  <Copy size={10} /> Copy
                </motion.span>
              )}
            </AnimatePresence>
          </button>
          <button
            onClick={handleAnalyze}
            className="flex items-center gap-1 text-[10px] text-arki-accent
                       hover:text-arki-accent-hover transition-colors ml-auto"
          >
            <Zap size={10} />
            Analyze with AI
          </button>
        </div>
      )}
    </motion.div>
  );
}
