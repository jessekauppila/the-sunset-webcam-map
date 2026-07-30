// app/ring/useRingStation.ts
'use client';

import { useEffect, useRef, useState } from 'react';
import { getOrCreatePhoneId } from '@/app/lib/ring/stationHelpers';

const SYNC_INTERVAL_MS = 20_000;

export interface StationState {
  status: 'connecting' | 'live' | 'waiting' | 'error';
  imageUrl: string | null;
  title: string | null;
  slot: { index: number; total: number; angleDeg: number } | null;
}

export function useRingStation(): StationState {
  const [state, setState] = useState<StationState>({
    status: 'connecting',
    imageUrl: null,
    title: null,
    slot: null,
  });
  const phoneIdRef = useRef<string>('');

  useEffect(() => {
    phoneIdRef.current = getOrCreatePhoneId(window.localStorage);
    let cancelled = false;
    let wakeLock: { release: () => Promise<void> } | null = null;

    async function sync() {
      try {
        const res = await fetch('/api/ring/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phoneId: phoneIdRef.current }),
        });
        const data = await res.json();
        if (cancelled) return;
        if (data.assigned) {
          setState({
            status: 'live',
            imageUrl: data.camera.imageUrl,
            title: data.camera.title,
            slot: data.slot,
          });
        } else {
          setState((s) => ({ ...s, status: 'waiting' }));
        }
      } catch {
        if (!cancelled) setState((s) => ({ ...s, status: 'error' }));
      }
    }

    async function requestWakeLock() {
      try {
        const nav = navigator as Navigator & {
          wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> };
        };
        wakeLock = (await nav.wakeLock?.request('screen')) ?? null;
      } catch {
        /* wake lock unavailable — screen may sleep; acceptable for v1 */
      }
    }

    function leaveBeacon() {
      const blob = new Blob(
        [JSON.stringify({ phoneId: phoneIdRef.current, leave: true })],
        { type: 'application/json' }
      );
      navigator.sendBeacon?.('/api/ring/sync', blob);
    }

    function onVisibility() {
      if (document.visibilityState === 'visible') requestWakeLock();
    }

    sync();
    requestWakeLock();
    const interval = setInterval(sync, SYNC_INTERVAL_MS);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', leaveBeacon);

    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', leaveBeacon);
      void wakeLock?.release();
    };
  }, []);

  return state;
}
