/**
 * ARKI — BackendBridge
 *
 * HTTP client for the Python FastAPI backend.
 * Pure HTTP fetch — no WebSocket, no axios, no external dependencies.
 * Uses native fetch (available in Electron 21+ / Node 18+).
 *
 * Features:
 *   - Typed wrappers: ocr(), ai(), process(), health()
 *   - Per-call configurable timeouts (defaults: OCR 30s, AI 60s)
 *   - 1 automatic retry on network-level errors (not on 4xx / 5xx responses)
 *   - AbortController-based timeout — no dangling promises
 *   - Image data sent as JSON: { image_base64: string, ... }
 *
 * Usage:
 *   const bridge = new BackendBridge({ host: '127.0.0.1', port: 8000 });
 *   const ocr    = await bridge.ocr(imageBase64);
 *   const ai     = await bridge.ai(ocr.text);
 *   const both   = await bridge.process(imageBase64);
 *   const alive  = await bridge.health();
 */

// ── Public types ───────────────────────────────────────────────────────────────

export interface OcrResult {
  text:         string;
  confidence:   number;   // 0 – 1
  provider:     string;
  processingMs: number;
}

export interface AiResult {
  response:     string;
  model:        string;
  provider:     string;
  tokensUsed:   number;
  processingMs: number;
}

export interface ProcessResult {
  ocr: OcrResult;
  ai:  AiResult;
}

export interface BackendBridgeConfig {
  host:           string;
  port:           number;
  /** Timeout for OCR requests in ms. Default: 30_000 */
  ocrTimeoutMs?:  number;
  /** Timeout for AI requests in ms. Default: 60_000 */
  aiTimeoutMs?:   number;
}

// ── Internal ───────────────────────────────────────────────────────────────────

/** HTTP methods used in this client. */
type HttpMethod = 'GET' | 'POST';

/**
 * Raw backend response shapes.
 * Inline to avoid coupling the bridge to external type files.
 */
interface RawOcrResponse {
  text:          string;
  confidence:    number;
  provider:      string;
  processing_ms: number;
}

interface RawAiResponse {
  response:      string;
  model:         string;
  provider:      string;
  tokens_used:   number;
  processing_ms: number;
}

interface RawProcessResponse {
  ocr: RawOcrResponse;
  ai:  RawAiResponse;
}

// ── BackendBridge ──────────────────────────────────────────────────────────────

export class BackendBridge {
  private readonly baseUrl:      string;
  private readonly ocrTimeoutMs: number;
  private readonly aiTimeoutMs:  number;

  constructor(config: BackendBridgeConfig) {
    this.baseUrl      = `http://${config.host}:${config.port}`;
    this.ocrTimeoutMs = config.ocrTimeoutMs ?? 30_000;
    this.aiTimeoutMs  = config.aiTimeoutMs  ?? 60_000;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Check backend liveness.
   * GET /health → { ok: boolean; status: number }
   */
  async health(): Promise<{ ok: boolean; status: number }> {
    try {
      const resp = await this.request('GET', '/health', undefined, this.ocrTimeoutMs);
      return { ok: resp.ok, status: resp.status };
    } catch {
      return { ok: false, status: 0 };
    }
  }

  /**
   * Extract text from a screen capture.
   * POST /ocr  { image_base64: string }
   */
  async ocr(imageBase64: string): Promise<OcrResult> {
    const resp = await this.requestWithRetry(
      'POST',
      '/ocr',
      { image_base64: imageBase64 },
      this.ocrTimeoutMs,
    );

    await this.assertOk(resp, 'OCR');
    const data = await resp.json() as RawOcrResponse;

    return {
      text:         data.text          ?? '',
      confidence:   data.confidence    ?? 0,
      provider:     data.provider      ?? 'unknown',
      processingMs: data.processing_ms ?? 0,
    };
  }

  /**
   * Run AI analysis on OCR text.
   * POST /ai  { text: string, context?: string }
   */
  async ai(ocrText: string, context?: string): Promise<AiResult> {
    const body: Record<string, string> = { text: ocrText };
    if (context !== undefined && context.length > 0) body['context'] = context;

    const resp = await this.requestWithRetry(
      'POST',
      '/ai',
      body,
      this.aiTimeoutMs,
    );

    await this.assertOk(resp, 'AI');
    const data = await resp.json() as RawAiResponse;

    return {
      response:     data.response      ?? '',
      model:        data.model         ?? 'unknown',
      provider:     data.provider      ?? 'unknown',
      tokensUsed:   data.tokens_used   ?? 0,
      processingMs: data.processing_ms ?? 0,
    };
  }

  /**
   * OCR + AI in one backend round-trip.
   * POST /process  { image_base64: string }
   * The backend runs OCR first, then passes the text to the AI pipeline.
   */
  async process(imageBase64: string): Promise<ProcessResult> {
    const resp = await this.requestWithRetry(
      'POST',
      '/process',
      { image_base64: imageBase64 },
      this.aiTimeoutMs,   // combined call can take as long as the AI step
    );

    await this.assertOk(resp, 'Process');
    const data = await resp.json() as RawProcessResponse;

    return {
      ocr: {
        text:         data.ocr?.text          ?? '',
        confidence:   data.ocr?.confidence    ?? 0,
        provider:     data.ocr?.provider      ?? 'unknown',
        processingMs: data.ocr?.processing_ms ?? 0,
      },
      ai: {
        response:     data.ai?.response      ?? '',
        model:        data.ai?.model         ?? 'unknown',
        provider:     data.ai?.provider      ?? 'unknown',
        tokensUsed:   data.ai?.tokens_used   ?? 0,
        processingMs: data.ai?.processing_ms ?? 0,
      },
    };
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Perform a fetch with a timeout and 1 automatic retry on network errors.
   * Network errors (DNS failure, connection refused, etc.) are retried once.
   * HTTP 4xx / 5xx responses are NOT retried — they are returned to the caller
   * who checks assertOk().
   */
  private async requestWithRetry(
    method: HttpMethod,
    endpoint: string,
    body: Record<string, string> | undefined,
    timeoutMs: number,
  ): Promise<Response> {
    try {
      return await this.request(method, endpoint, body, timeoutMs);
    } catch (err) {
      // Only retry on network-level errors (not AbortError from timeout)
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(
          `[BackendBridge] ${method} ${endpoint} timed out after ${timeoutMs}ms`,
        );
      }
      console.warn(`[BackendBridge] Network error on ${endpoint}, retrying once…`, err);
      return this.request(method, endpoint, body, timeoutMs);
    }
  }

  /**
   * Single fetch call wrapped with AbortController for timeout.
   */
  private request(
    method: HttpMethod,
    endpoint: string,
    body: Record<string, string> | undefined,
    timeoutMs: number,
  ): Promise<Response> {
    const controller = new AbortController();
    const timerId    = setTimeout(() => controller.abort(), timeoutMs);

    const init: RequestInit = {
      method,
      signal: controller.signal,
      ...(body !== undefined && {
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      }),
    };

    return fetch(`${this.baseUrl}${endpoint}`, init).finally(() => {
      clearTimeout(timerId);
    });
  }

  /**
   * Assert that a Response is 2xx, throwing with a descriptive message otherwise.
   * Reads the body as text for the error message (so the response body is consumed).
   */
  private async assertOk(resp: Response, label: string): Promise<void> {
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new Error(
        `[BackendBridge] ${label} failed: HTTP ${resp.status} ${resp.statusText}` +
        (body ? ` — ${body}` : ''),
      );
    }
  }
}
