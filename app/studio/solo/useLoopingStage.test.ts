import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLoopingStage } from './useLoopingStage';
import { fitPlan } from '@/app/lib/solo2/plan';

const plan = fitPlan({ dwellS: 6, leadS: 0, minStepS: 1 }, 3); // 2 s a frame, above the floor so the budget divides
const NOW = 100_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
});
afterEach(() => vi.useRealTimers());

describe('useLoopingStage', () => {
  it('starts at the first frame, walks the run, and wraps at the dwell', () => {
    const { result } = renderHook(() => useLoopingStage(plan, NOW));
    expect(result.current.index).toBe(0);
    act(() => { vi.advanceTimersByTime(2_000); });
    expect(result.current.index).toBe(1);
    act(() => { vi.advanceTimersByTime(2_000); });
    expect(result.current.index).toBe(2);
    act(() => { vi.advanceTimersByTime(2_000); });
    expect(result.current.index).toBe(0); // round again
  });

  it('restarts when the dwell start changes', () => {
    const { result, rerender } = renderHook((p: { start: number }) => useLoopingStage(plan, p.start), { initialProps: { start: NOW } });
    act(() => { vi.advanceTimersByTime(4_000); });
    expect(result.current.index).toBe(2);
    rerender({ start: NOW + 4_000 });
    act(() => { vi.advanceTimersByTime(0); });
    expect(result.current.index).toBe(0);
  });

  // The bug: the preview's dwell walker ticks at 250 ms, so it notices a
  // boundary up to a tick late and back-dates `startMs` to the exact boundary.
  // A stage clock that started at mount instead of at that start ran a tick
  // behind the dwell, so it wrapped to frame 0 while the dwell was still on
  // its last frame — the run flashed an earlier picture just before the
  // camera changed, and the last frame was short by the same amount.
  it('is phase-locked to the dwell: a dwell that began a tick ago is already a tick in', () => {
    const { result } = renderHook(() => useLoopingStage(plan, NOW - 2_500));
    expect(result.current.index).toBe(1); // 2.5 s in, not 0
  });

  it('never wraps early: the last frame holds right up to the dwell it belongs to', () => {
    // The dwell began 250 ms before this clock was mounted, the lag the
    // walker's tick can introduce.
    const { result } = renderHook(() => useLoopingStage(plan, NOW - 250));
    act(() => { vi.advanceTimersByTime(5_450); }); // 5.7 s into a 6 s dwell
    expect(result.current.index).toBe(2); // still the last frame
    act(() => { vi.advanceTimersByTime(300); }); // 6.0 s in: the wrap, on the dwell's clock
    expect(result.current.index).toBe(0);
  });
});
