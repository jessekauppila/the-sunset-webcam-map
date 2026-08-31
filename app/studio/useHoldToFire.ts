'use client';

import { useCallback, useRef, useState } from 'react';

/** Hold duration for the Take/Deploy button (ms). Shared with DeployButton's
 * CSS sweep animation so the visual fill and the fire timer stay in lockstep. */
export const DEPLOY_HOLD_MS = 600;

export interface UseHoldToFireOptions {
  ms: number;
  onFire: () => void;
  disabled?: boolean;
}

export interface UseHoldToFireResult {
  holding: boolean;
  handlers: {
    onPointerDown: () => void;
    onPointerUp: () => void;
    onPointerLeave: () => void;
  };
}

/**
 * Press-and-hold-to-fire gesture: pointerdown starts a `ms` timer; releasing
 * or leaving before it elapses cancels it as a no-op; letting it run out
 * calls `onFire` exactly once and ends the hold. `disabled` ignores all
 * input (including a hold already in flight would be cleared by the caller
 * unmounting/re-rendering — disabled itself simply refuses to start one).
 */
export function useHoldToFire({
  ms,
  onFire,
  disabled = false,
}: UseHoldToFireOptions): UseHoldToFireResult {
  const [holding, setHolding] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const onPointerDown = useCallback(() => {
    if (disabled || timerRef.current !== null) return;
    setHolding(true);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setHolding(false);
      onFire();
    }, ms);
  }, [disabled, ms, onFire]);

  const cancel = useCallback(() => {
    if (timerRef.current === null) return;
    clear();
    setHolding(false);
  }, [clear]);

  return {
    holding,
    handlers: {
      onPointerDown,
      onPointerUp: cancel,
      onPointerLeave: cancel,
    },
  };
}
