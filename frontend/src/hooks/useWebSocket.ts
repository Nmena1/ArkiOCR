/**
 * ARKI — useWebSocket Hook
 * Manages the WebSocket connection to the FastAPI backend.
 * Auto-reconnects with exponential backoff on disconnect.
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { useArkiStore } from '@/store/arki.store';
import type { WsMessage } from '@/types/ipc.types';

const DEFAULT_WS_URL   = 'ws://127.0.0.1:8765/ws';
const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 16000, 30000]; // exponential backoff
const MAX_RECONNECT_ATTEMPTS = 10;

interface UseWebSocketOptions {
  url?: string;
  onOpen?:    () => void;
  onClose?:   () => void;
  onError?:   (event: Event) => void;
}

export function useWebSocket(options: UseWebSocketOptions = {}) {
  const { url = DEFAULT_WS_URL, onOpen, onClose, onError } = options;

  const ws             = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef     = useRef(0);
  const isMounted      = useRef(true);

  const [connectionState, setConnectionState] = useState<
    'connecting' | 'connected' | 'disconnected' | 'error'
  >('disconnected');

  const { setConnected, handleWsMessage } = useArkiStore();

  const connect = useCallback(() => {
    if (!isMounted.current) return;
    if (ws.current?.readyState === WebSocket.OPEN) return;

    setConnectionState('connecting');

    try {
      const socket = new WebSocket(url);

      socket.onopen = () => {
        if (!isMounted.current) { socket.close(); return; }
        attemptRef.current = 0;
        setConnectionState('connected');
        setConnected(true);
        onOpen?.();
        console.log('[ARKI WS] Connected to backend');
      };

      socket.onmessage = (event: MessageEvent) => {
        if (!isMounted.current) return;
        try {
          const message = JSON.parse(event.data as string) as WsMessage;
          handleWsMessage(message);
        } catch (err) {
          console.error('[ARKI WS] Failed to parse message:', err);
        }
      };

      socket.onclose = (event) => {
        if (!isMounted.current) return;
        setConnectionState('disconnected');
        setConnected(false);
        onClose?.();

        if (!event.wasClean && attemptRef.current < MAX_RECONNECT_ATTEMPTS) {
          const delay = RECONNECT_DELAYS[Math.min(attemptRef.current, RECONNECT_DELAYS.length - 1)];
          console.log(`[ARKI WS] Reconnecting in ${delay}ms (attempt ${attemptRef.current + 1})`);
          reconnectTimer.current = setTimeout(() => {
            attemptRef.current++;
            connect();
          }, delay);
        }
      };

      socket.onerror = (event) => {
        if (!isMounted.current) return;
        setConnectionState('error');
        console.error('[ARKI WS] Error:', event);
        onError?.(event);
      };

      ws.current = socket;
    } catch (err) {
      console.error('[ARKI WS] Failed to create WebSocket:', err);
      setConnectionState('error');
    }
  }, [url, onOpen, onClose, onError, setConnected, handleWsMessage]);

  const disconnect = useCallback(() => {
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
    if (ws.current) {
      ws.current.close(1000, 'Client disconnected');
      ws.current = null;
    }
  }, []);

  const send = useCallback((data: unknown) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify(data));
    } else {
      console.warn('[ARKI WS] Cannot send: not connected');
    }
  }, []);

  useEffect(() => {
    isMounted.current = true;
    connect();

    return () => {
      isMounted.current = false;
      disconnect();
    };
  }, [connect, disconnect]);

  return { connectionState, send, connect, disconnect };
}
