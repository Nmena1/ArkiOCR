/**
 * ARKI — Root Application Component
 * Initializes WebSocket, IPC listeners, and renders the overlay.
 */

import { useEffect, useState } from 'react';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useIPC }        from '@/hooks/useIPC';
import { OverlayWindow } from '@/components/OverlayWindow';

export default function App() {
  const [appInfo, setAppInfo] = useState<{
    version: string;
    isDev: boolean;
    backendUrl: string;
    websocketUrl: string;
  } | null>(null);

  // Load app info from Electron
  useEffect(() => {
    if (typeof window !== 'undefined' && window.arki) {
      window.arki.app.info().then(setAppInfo).catch(console.error);
    } else {
      // Browser dev mode fallback
      setAppInfo({
        version: '1.0.0-dev',
        isDev: true,
        backendUrl: 'http://127.0.0.1:8000',
        websocketUrl: 'ws://127.0.0.1:8765',
      });
    }
  }, []);

  // Initialize WebSocket
  const { connectionState } = useWebSocket({
    url: appInfo?.websocketUrl ?? 'ws://127.0.0.1:8765/ws',
    onOpen:  () => console.log('[ARKI] WS connected'),
    onClose: () => console.log('[ARKI] WS disconnected'),
  });

  // Initialize IPC listeners (Electron hotkeys)
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
