/**
 * ARKI — Main Application Store (Zustand + Immer)
 *
 * Central state for OCR results, AI responses, and session tracking.
 * Uses immer middleware for immutable updates.
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { devtools } from 'zustand/middleware';
import type {
  OCRResult,
  AIResponse,
  SessionInfo,
  WsMessage,
} from '@/types/ipc.types';

// ── State Shape ───────────────────────────────────────────────────────────────

interface ArkiState {
  // OCR results (most recent first)
  ocrResults: OCRResult[];
  activeOCRId: string | null;

  // AI responses
  aiResponses: AIResponse[];
  streamingContent: string | null;   // content being streamed
  streamingId: string | null;
  isAIProcessing: boolean;

  // Session
  session: SessionInfo | null;
  isConnected: boolean;
  backendStatus: 'unknown' | 'ready' | 'busy' | 'error';

  // UI state
  isCapturing: boolean;
  lastCaptureTs: number | null;
}

// ── Actions ───────────────────────────────────────────────────────────────────

interface ArkiActions {
  // OCR
  addOCRResult: (result: OCRResult) => void;
  setActiveOCR: (id: string | null) => void;
  clearOCRResults: () => void;

  // AI
  addAIResponse: (response: AIResponse) => void;
  startStreaming: (id: string) => void;
  appendStreamChunk: (chunk: string) => void;
  finalizeStreaming: () => void;
  setAIProcessing: (processing: boolean) => void;

  // Session
  updateSession: (session: SessionInfo) => void;

  // Connection
  setConnected: (connected: boolean) => void;
  setBackendStatus: (status: ArkiState['backendStatus']) => void;

  // Capture
  setCapturing: (capturing: boolean) => void;

  // WebSocket dispatch
  handleWsMessage: (message: WsMessage) => void;

  // Reset
  clearSession: () => void;
}

// ── Store ─────────────────────────────────────────────────────────────────────

const MAX_OCR_HISTORY    = 50;
const MAX_AI_HISTORY     = 100;

export const useArkiStore = create<ArkiState & ArkiActions>()(
  devtools(
    immer((set, get) => ({
      // ── Initial state ──────────────────────────────────────────────────────
      ocrResults:       [],
      activeOCRId:      null,
      aiResponses:      [],
      streamingContent: null,
      streamingId:      null,
      isAIProcessing:   false,
      session:          null,
      isConnected:      false,
      backendStatus:    'unknown',
      isCapturing:      false,
      lastCaptureTs:    null,

      // ── OCR actions ────────────────────────────────────────────────────────
      addOCRResult: (result) => set((state) => {
        state.ocrResults.unshift(result);
        if (state.ocrResults.length > MAX_OCR_HISTORY) {
          state.ocrResults = state.ocrResults.slice(0, MAX_OCR_HISTORY);
        }
        state.activeOCRId = result.id;
        state.isCapturing = false;
        state.lastCaptureTs = Date.now();
      }),

      setActiveOCR: (id) => set((state) => {
        state.activeOCRId = id;
      }),

      clearOCRResults: () => set((state) => {
        state.ocrResults = [];
        state.activeOCRId = null;
      }),

      // ── AI actions ─────────────────────────────────────────────────────────
      addAIResponse: (response) => set((state) => {
        state.aiResponses.unshift(response);
        if (state.aiResponses.length > MAX_AI_HISTORY) {
          state.aiResponses = state.aiResponses.slice(0, MAX_AI_HISTORY);
        }
        state.isAIProcessing = false;
        state.streamingContent = null;
        state.streamingId = null;
      }),

      startStreaming: (id) => set((state) => {
        state.streamingId = id;
        state.streamingContent = '';
        state.isAIProcessing = true;
      }),

      appendStreamChunk: (chunk) => set((state) => {
        if (state.streamingContent !== null) {
          state.streamingContent += chunk;
        }
      }),

      finalizeStreaming: () => set((state) => {
        state.streamingContent = null;
        state.streamingId = null;
        state.isAIProcessing = false;
      }),

      setAIProcessing: (processing) => set((state) => {
        state.isAIProcessing = processing;
      }),

      // ── Session actions ────────────────────────────────────────────────────
      updateSession: (session) => set((state) => {
        state.session = session;
      }),

      // ── Connection actions ─────────────────────────────────────────────────
      setConnected: (connected) => set((state) => {
        state.isConnected = connected;
        if (!connected) state.backendStatus = 'error';
      }),

      setBackendStatus: (status) => set((state) => {
        state.backendStatus = status;
      }),

      // ── Capture actions ────────────────────────────────────────────────────
      setCapturing: (capturing) => set((state) => {
        state.isCapturing = capturing;
      }),

      // ── WebSocket dispatch ─────────────────────────────────────────────────
      handleWsMessage: (message) => {
        const { type, payload } = message;
        const actions = get();
        switch (type) {
          case 'ocr_result':
            actions.addOCRResult(payload as OCRResult);
            break;
          case 'ai_response':
            actions.addAIResponse(payload as AIResponse);
            break;
          case 'ai_streaming_chunk':
            actions.appendStreamChunk((payload as { id: string; delta: string }).delta);
            break;
          case 'ai_streaming_done':
            actions.finalizeStreaming();
            break;
          case 'session_update':
            actions.updateSession(payload as SessionInfo);
            break;
          case 'backend_status':
            actions.setBackendStatus(
              (payload as { status: ArkiState['backendStatus'] }).status
            );
            break;
          default:
            console.warn('[ARKI Store] Unknown WS message type:', type);
        }
      },

      // ── Reset ──────────────────────────────────────────────────────────────
      clearSession: () => set((state) => {
        state.ocrResults       = [];
        state.activeOCRId      = null;
        state.aiResponses      = [];
        state.streamingContent = null;
        state.streamingId      = null;
        state.isAIProcessing   = false;
        state.session          = null;
        state.isCapturing      = false;
        state.lastCaptureTs    = null;
      }),
    })),
    { name: 'ArkiStore' }
  )
);

// ── Selectors ─────────────────────────────────────────────────────────────────

export const selectActiveOCR = (state: ArkiState) =>
  state.ocrResults.find((r) => r.id === state.activeOCRId) ?? null;

export const selectLatestAIResponse = (state: ArkiState) =>
  state.aiResponses[0] ?? null;

export const selectCostWarning = (state: ArkiState) =>
  state.session && state.session.totalCostUsd >= state.session.costAlertThreshold;

export const selectCostExceeded = (state: ArkiState) =>
  state.session && state.session.totalCostUsd >= state.session.costMaxThreshold;
