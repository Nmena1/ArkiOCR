/**
 * ARKI — Root Application Component
 *
 * Hash routing (no react-router):
 *   #/capture-selector → CaptureSelector (runs in dedicated selector window)
 *   everything else    → normal overlay
 */

import { useEffect, useState } from 'react';
import { useWebSocket }    from '@/hooks/useWebSocket';
import { useIPC }          from '@/hooks/useIPC';
import { OverlayWindow }   from '@/components/OverlayWindow';
import { CaptureSelector } from '@/components/CaptureSelector';

// Detect if we're in the capture selector window
const IS_SELECTOR = window.location.hash === '#/capture-selector' ||
  new URLSearchParams(window.location.search).get('selector') === '1';

export default function App() {
  // ── Capture selector mode (dedicated BrowserWindow) ──────────────────────
  if (IS_SELECTOR) {
    return (
      <div className="fixed inset-0 bg-transparent overflow-hidden">
        <CaptureSelector />
      </div>
    );
  }

  // ── Normal overlay mode ────────────────────────────────────────────────────
  return <OverlayApp />;
}

function OverlayApp() {
  const [appInfo, setAppInfo] = useState<{
    version: string; isDev: boolean; backendUrl: string; websocketUrl: string;
  } | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined' && window.arki) {
      window.arki.app.info().then(setAppInfo).catch(console.error);
    } else {
      setAppInfo({
        version:      '1.0.0-dev',
        isDev:        true,
        backendUrl:   'http://127.0.0.1:8000',
        websocketUrl: 'ws://127.0.0.1:8765',
      });
    }
  }, []);

  const { connectionState } = useWebSocket({
    url:     appInfo?.websocketUrl ?? 'ws://127.0.0.1:8765/ws',
    onOpen:  () => console.log('[ARKI] WS connected'),
    onClose: () => console.log('[ARKI] WS disconnected'),
  });

  useIPC();

  return (
    <div className="w-full h-full flex items-stretch bg-transparent">
      <OverlayWindow
        connectionState={connectionState}
        appVersion={appInfo?.version}
      />
    </div>
  );
}
