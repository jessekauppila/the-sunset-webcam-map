'use client';

import { useEffect, useRef, useState } from 'react';

// Generic polling hook. Calls `fn` immediately then every `intervalMs`
// until cleanup. Stops when `stopWhen(result)` returns true.
//
// Used by Screen 1 (confirm-camera) to poll /api/cameras/setup-status
// until the device's status flips from 'awaiting_wifi'.
export function usePolling<T>(
  fn: () => Promise<T>,
  opts: {
    intervalMs: number;
    stopWhen: (result: T) => boolean;
    enabled?: boolean;
  }
): { latest: T | null; error: Error | null; stopped: boolean } {
  const { intervalMs, stopWhen, enabled = true } = opts;
  const [latest, setLatest] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [stopped, setStopped] = useState(false);
  // Keep latest stopWhen in a ref so the effect doesn't tear down every
  // render the caller passes a fresh arrow.
  const stopWhenRef = useRef(stopWhen);
  stopWhenRef.current = stopWhen;
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setStopped(false);

    const tick = async () => {
      try {
        const result = await fnRef.current();
        if (cancelled) return;
        setLatest(result);
        setError(null);
        if (stopWhenRef.current(result)) {
          setStopped(true);
          return;
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err : new Error(String(err)));
      }
      if (!cancelled) {
        timer = setTimeout(tick, intervalMs);
      }
    };

    let timer: ReturnType<typeof setTimeout> | undefined;
    tick();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [enabled, intervalMs]);

  return { latest, error, stopped };
}
