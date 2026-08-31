import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useHoldToFire, DEPLOY_HOLD_MS } from './useHoldToFire';

describe('useHoldToFire', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires exactly once after ms elapses following pointerdown', () => {
    const onFire = vi.fn();
    const { result } = renderHook(() => useHoldToFire({ ms: DEPLOY_HOLD_MS, onFire }));

    act(() => {
      result.current.handlers.onPointerDown();
    });
    expect(result.current.holding).toBe(true);

    act(() => {
      vi.advanceTimersByTime(DEPLOY_HOLD_MS);
    });

    expect(onFire).toHaveBeenCalledTimes(1);
    expect(result.current.holding).toBe(false);

    // Advancing further does not fire again.
    act(() => {
      vi.advanceTimersByTime(DEPLOY_HOLD_MS);
    });
    expect(onFire).toHaveBeenCalledTimes(1);
  });

  it('releasing at ms - 1 never fires', () => {
    const onFire = vi.fn();
    const { result } = renderHook(() => useHoldToFire({ ms: DEPLOY_HOLD_MS, onFire }));

    act(() => {
      result.current.handlers.onPointerDown();
    });
    act(() => {
      vi.advanceTimersByTime(DEPLOY_HOLD_MS - 1);
    });
    act(() => {
      result.current.handlers.onPointerUp();
    });
    expect(result.current.holding).toBe(false);

    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(onFire).not.toHaveBeenCalled();
  });

  it('pointerleave before firing cancels the hold as a no-op', () => {
    const onFire = vi.fn();
    const { result } = renderHook(() => useHoldToFire({ ms: DEPLOY_HOLD_MS, onFire }));

    act(() => {
      result.current.handlers.onPointerDown();
    });
    act(() => {
      vi.advanceTimersByTime(DEPLOY_HOLD_MS - 1);
    });
    act(() => {
      result.current.handlers.onPointerLeave();
    });

    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(onFire).not.toHaveBeenCalled();
  });

  it('disabled ignores pointerdown entirely', () => {
    const onFire = vi.fn();
    const { result } = renderHook(() =>
      useHoldToFire({ ms: DEPLOY_HOLD_MS, onFire, disabled: true })
    );

    act(() => {
      result.current.handlers.onPointerDown();
    });
    expect(result.current.holding).toBe(false);

    act(() => {
      vi.advanceTimersByTime(DEPLOY_HOLD_MS);
    });
    expect(onFire).not.toHaveBeenCalled();
  });

  it('unmounting mid-hold cancels the timer so onFire never fires', () => {
    const onFire = vi.fn();
    const { result, unmount } = renderHook(() => useHoldToFire({ ms: DEPLOY_HOLD_MS, onFire }));

    act(() => {
      result.current.handlers.onPointerDown();
    });
    expect(result.current.holding).toBe(true);

    unmount();

    act(() => {
      vi.advanceTimersByTime(DEPLOY_HOLD_MS);
    });
    expect(onFire).not.toHaveBeenCalled();
  });

  it('a second hold after firing works', () => {
    const onFire = vi.fn();
    const { result } = renderHook(() => useHoldToFire({ ms: DEPLOY_HOLD_MS, onFire }));

    act(() => {
      result.current.handlers.onPointerDown();
    });
    act(() => {
      vi.advanceTimersByTime(DEPLOY_HOLD_MS);
    });
    expect(onFire).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.handlers.onPointerDown();
    });
    act(() => {
      vi.advanceTimersByTime(DEPLOY_HOLD_MS);
    });
    expect(onFire).toHaveBeenCalledTimes(2);
  });
});
