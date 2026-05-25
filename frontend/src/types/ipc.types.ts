/**
 * ARKI — IPC & Backend Contract Types
 * Shared between frontend and (mirrored in) backend Pydantic models.
 */

// ── OCR ───────────────────────────────────────────────────────────────────────

export type ContentType = 'code' | 'math' | 'text' | 'table' | 'mixed' | 'unknown';
export type Language    = 'python' | 'typescript' | 'javascript' | 'java' | 'sql' | 'bash' | 'other';

export interface OCRResult {
  id: string;
  timestamp: string;           // ISO-8601
  rawText: string;
  cleanedText: string;
  contentType: ContentType;
  detectedLanguage?: Language; // if contentType === 'code'
  confidence: number;          // 0.0 – 1.0
  processingMs: number;
  provider: 'tesseract' | 'easyocr' | 'openai_vision';
  error?: string;
}

// ── AI Response ───────────────────────────────────────────────────────────────

export type AIResponseType =
  | 'explanation'
  | 'solution'
  | 'optimization'
  | 'translation'
  | 'math_solution'
  | 'code_review'
  | 'error';

export interface AIResponse {
  id: string;
  timestamp: string;
  type: AIResponseType;
  headline: string;            // ≤10 words — shown as title
  content: string;             // Main response, markdown
  supportingPoints?: string[];
  codeBlocks?: CodeBlock[];
  suggestedFollowUp?: string;
  provider: 'openai' | 'ollama';
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  sessionCostUsd?: number;
  error?: string;
}

export interface CodeBlock {
  language: string;
  code: string;
  explanation?: string;
}

// ── Session ───────────────────────────────────────────────────────────────────

export interface SessionInfo {
  id: string;
  startedAt: string;
  captureCount: number;
  aiCallCount: number;
  totalCostUsd: number;
  costAlertThreshold: number;
  costMaxThreshold: number;
}

// ── WebSocket Messages ────────────────────────────────────────────────────────

export type WsMessageType =
  | 'ocr_result'
  | 'ai_response'
  | 'ai_streaming_chunk'
  | 'ai_streaming_done'
  | 'session_update'
  | 'backend_status'
  | 'error';

export interface WsMessage<T = unknown> {
  type: WsMessageType;
  payload: T;
  timestamp: string;
}

export type WsOCRMessage      = WsMessage<OCRResult>;
export type WsAIMessage       = WsMessage<AIResponse>;
export type WsSessionMessage  = WsMessage<SessionInfo>;
export type WsStreamChunk     = WsMessage<{ id: string; delta: string }>;
export type WsStreamDone      = WsMessage<{ id: string }>;
export type WsStatusMessage   = WsMessage<{ status: 'ready' | 'busy' | 'error'; detail?: string }>;

// ── REST API ──────────────────────────────────────────────────────────────────

export interface HealthResponse {
  status: 'ok' | 'degraded' | 'error';
  version: string;
  timestamp: string;
  services: {
    ocr: 'ok' | 'error';
    ai: 'ok' | 'error';
    database: 'ok' | 'error';
  };
}

export interface CaptureRequest {
  imageBase64: string;         // base64-encoded PNG/JPEG
  mimeType: 'image/png' | 'image/jpeg';
  ocrProvider?: 'tesseract' | 'easyocr' | 'openai_vision' | 'auto';
  analyzeWithAI?: boolean;     // trigger AI analysis after OCR
}

export interface AnalyzeRequest {
  ocrResultId: string;         // Reference to existing OCR result
  analysisType?: 'explain' | 'solve' | 'optimize' | 'translate';
  context?: string;            // Additional user context
  model?: 'mini' | 'full';     // mini = fast, full = deep analysis
}
