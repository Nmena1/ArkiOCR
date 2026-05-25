/**
 * ARKI — AI Response Panel
 * Displays AI analysis results with markdown rendering, code highlighting, and streaming.
 */

import { motion, AnimatePresence } from 'framer-motion';
import { Brain, Sparkles, ChevronDown, ChevronUp, Copy, CheckCircle } from 'lucide-react';
import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { clsx } from 'clsx';

import { useArkiStore, selectLatestAIResponse, selectCostWarning } from '@/store/arki.store';
import type { AIResponse } from '@/types/ipc.types';

export function AIPanel() {
  const {
    aiResponses,
    streamingContent,
    isAIProcessing,
  } = useArkiStore((s) => ({
    aiResponses:     s.aiResponses,
    streamingContent: s.streamingContent,
    isAIProcessing:  s.isAIProcessing,
  }));

  const costWarning = useArkiStore(selectCostWarning);
  const latestResponse = useArkiStore(selectLatestAIResponse);

  if (isAIProcessing && streamingContent === null) {
    return (
      <div className="flex flex-col items-center justify-center h-40 gap-3">
        <div className="relative">
          <Brain size={24} className="text-arki-accent animate-thinking" />
          <div className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-arki-accent
                          flex items-center justify-center">
            <div className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
          </div>
        </div>
        <p className="text-arki-text-muted text-xs">Analyzing content...</p>
      </div>
    );
  }

  // Streaming response
  if (streamingContent !== null) {
    return (
      <div className="p-3">
        <StreamingResponse content={streamingContent} />
      </div>
    );
  }

  if (!latestResponse) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6 text-center gap-3">
        <div className="w-12 h-12 rounded-xl bg-arki-border flex items-center justify-center">
          <Brain size={20} className="text-arki-text-muted" />
        </div>
        <div>
          <p className="text-arki-text text-xs font-medium">No analysis yet</p>
          <p className="text-arki-text-muted text-[11px] mt-1">
            Capture content, then click <span className="text-arki-accent">Analyze with AI</span>
          </p>
        </div>
        <p className="text-[10px] text-arki-text-muted">
          or press <kbd className="bg-arki-border px-1 rounded text-[10px]">⌘⇧X</kbd>
        </p>
      </div>
    );
  }

  return (
    <div className="p-3 space-y-3">
      {costWarning && (
        <div className="text-[10px] text-arki-warning bg-arki-warning/10 rounded-lg px-2 py-1.5 flex items-center gap-1.5">
          <Sparkles size={10} />
          Approaching session cost limit
        </div>
      )}
      <AIResponseCard response={latestResponse} isLatest />
    </div>
  );
}

function StreamingResponse({ content }: { content: string }) {
  return (
    <div className="rounded-xl border border-arki-accent/30 bg-arki-accent/5 p-3 space-y-2">
      <div className="flex items-center gap-1.5 text-[11px] text-arki-accent">
        <Brain size={11} className="animate-thinking" />
        <span>Generating response...</span>
        <div className="w-1 h-3 bg-arki-accent ml-auto animate-pulse rounded-full" />
      </div>
      <div className="text-[11px] text-arki-text leading-relaxed whitespace-pre-wrap font-mono">
        {content}
      </div>
    </div>
  );
}

interface AIResponseCardProps {
  response: AIResponse;
  isLatest?: boolean;
}

function AIResponseCard({ response, isLatest }: AIResponseCardProps) {
  const [expanded, setExpanded] = useState(isLatest ?? false);
  const [copied, setCopied]     = useState(false);

  const urgencyColor = {
    explanation:  'text-arki-text',
    solution:     'text-arki-success',
    optimization: 'text-arki-accent',
    translation:  'text-arki-text',
    math_solution: 'text-arki-accent',
    code_review:  'text-arki-warning',
    error:        'text-arki-danger',
  }[response.type] ?? 'text-arki-text';

  const handleCopy = async () => {
    await navigator.clipboard.writeText(response.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={clsx(
        'rounded-xl border p-3 space-y-2',
        isLatest ? 'border-arki-accent/30 bg-arki-accent/5' : 'border-arki-border bg-arki-surface'
      )}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <Brain size={11} className={urgencyColor} />
            <span className={clsx('text-[10px] font-medium uppercase tracking-wider', urgencyColor)}>
              {response.type.replace('_', ' ')}
            </span>
          </div>
          <p className="text-[12px] font-semibold text-arki-text leading-snug">
            {response.headline}
          </p>
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-arki-text-muted hover:text-arki-text transition-colors shrink-0"
        >
          {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </button>
      </div>

      {/* Body (expandable) */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            {/* Main content */}
            <div className="text-[11px] text-arki-text leading-relaxed prose prose-invert prose-sm max-w-none
                            prose-p:text-arki-text prose-code:text-arki-accent prose-code:bg-arki-bg
                            prose-code:px-1 prose-code:rounded prose-code:text-[10px]">
              <ReactMarkdown>{response.content}</ReactMarkdown>
            </div>

            {/* Supporting points */}
            {response.supporting_points.length > 0 && (
              <ul className="mt-2 space-y-1">
                {response.supporting_points.map((point, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-[10px] text-arki-text-muted">
                    <span className="text-arki-accent mt-0.5">•</span>
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            )}

            {/* Code blocks */}
            {response.code_blocks.map((block, i) => (
              <div key={i} className="mt-2">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[9px] text-arki-accent uppercase">{block.language}</span>
                </div>
                <pre className="arki-code text-[10px] leading-relaxed overflow-x-auto">
                  <code>{block.code}</code>
                </pre>
                {block.explanation && (
                  <p className="text-[10px] text-arki-text-muted mt-1">{block.explanation}</p>
                )}
              </div>
            ))}

            {/* Follow-up */}
            {response.suggested_follow_up && (
              <div className="mt-2 text-[10px] text-arki-text-muted bg-arki-border/50 rounded-lg px-2 py-1.5 italic">
                💡 {response.suggested_follow_up}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Footer */}
      <div className="flex items-center justify-between text-[9px] text-arki-text-muted pt-0.5">
        <div className="flex items-center gap-2">
          <span>{response.provider}</span>
          <span>·</span>
          <span>{response.model}</span>
          <span>·</span>
          <span>{response.latency_ms}ms</span>
        </div>
        <button onClick={handleCopy} className="flex items-center gap-1 hover:text-arki-text transition-colors">
          <AnimatePresence mode="wait">
            {copied ? (
              <motion.span key="check" initial={{ scale: 0.8 }} animate={{ scale: 1 }}
                className="text-arki-success flex items-center gap-1">
                <CheckCircle size={9} /> Copied
              </motion.span>
            ) : (
              <motion.span key="copy" className="flex items-center gap-1">
                <Copy size={9} /> Copy
              </motion.span>
            )}
          </AnimatePresence>
        </button>
      </div>
    </motion.div>
  );
}
