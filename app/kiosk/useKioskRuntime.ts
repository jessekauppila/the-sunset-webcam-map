'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  parseQuietParam,
  isDozing,
  shouldRunTick,
  type QuietWindow,
} from './kioskSchedule';
import {
  KIOSK_TICK_INTERVAL_MS,
  KIOSK_WAKE_MINUTES,
} from '@/app/lib/masterConfig';

export function useKioskRuntime(): { dozing: boolean } {
  const [visible, setVisible] = useState(
    () => typeof document === 'undefined' || document.visibilityState === 'visible',
  );
  const [localDoze, setLocalDoze] = useState(false);
  const [remoteDoze, setRemoteDoze] = useState(false);
  const [, forceRender] = useState(0);
  const quietRef = useRef<QuietWindow>(null);
  const lastInteractionRef = useRef<number | null>(null);
  const localDozeRef = useRef(false);
  const remoteDozeRef = useRef(false);
  const visibleRef = useRef(true);
  localDozeRef.current = localDoze;
  remoteDozeRef.current = remoteDoze;
  visibleRef.current = visible;

  const gate = useCallback(
    () => ({
      visible: visibleRef.current,
      localDoze: localDozeRef.current,
      remoteDoze: remoteDozeRef.current,
      quiet: quietRef.current,
      hourLocal: new Date().getHours(),
      msSinceInteraction:
        lastInteractionRef.current === null
          ? null
          : Date.now() - lastInteractionRef.current,
      wakeMinutes: KIOSK_WAKE_MINUTES,
    }),
    [],
  );

  useEffect(() => {
    quietRef.current = parseQuietParam(
      new URLSearchParams(window.location.search).get('quiet'),
    );

    const onVisibility = () =>
      setVisible(document.visibilityState === 'visible');
    const onKeydown = (e: KeyboardEvent) => {
      if (e.key === 'd') {
        setLocalDoze((v) => !v);
        return; // the toggle itself is not a wake interaction
      }
      lastInteractionRef.current = Date.now();
    };
    const onInteraction = () => {
      lastInteractionRef.current = Date.now();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('keydown', onKeydown);
    window.addEventListener('pointerdown', onInteraction);
    window.addEventListener('pointermove', onInteraction);

    const poll = async () => {
      try {
        const res = await fetch('/api/kiosk/state');
        if (res.ok) {
          const { doze } = (await res.json()) as { doze: boolean };
          setRemoteDoze(doze);
          remoteDozeRef.current = doze;
        }
      } catch {
        /* state poll failures are non-fatal */
      }
      if (shouldRunTick(gate())) {
        fetch('/api/kiosk/tick', { method: 'POST' }).catch(() => {});
      }
    };
    void poll();
    const interval = setInterval(poll, KIOSK_TICK_INTERVAL_MS);
    // Cheap re-render so hourLocal / wake-window expiry are reflected in UI.
    const renderTick = setInterval(() => forceRender((n) => n + 1), 30_000);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('keydown', onKeydown);
      window.removeEventListener('pointerdown', onInteraction);
      window.removeEventListener('pointermove', onInteraction);
      clearInterval(interval);
      clearInterval(renderTick);
    };
  }, [gate]);

  return { dozing: isDozing(gate()) };
}
