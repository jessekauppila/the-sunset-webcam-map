import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useStage } from './useStage';
import { fitPlan, type Stage } from '@/app/lib/solo2/plan';

const plan = fitPlan({ dwellS: 6, leadS: 2, minStepS: 1 }, 3); // 2 s a frame, lead over the last 2 s

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(100_000));
});
afterEach(() => vi.useRealTimers());

describe('useStage', () => {
  it('walks the run then the lead on the wall clock', () => {
    const { result } = renderHook(() => useStage(plan, 100_000));
    expect(result.current).toEqual({ index: 0, leadProgress: 0, exitProgress: 0 });
    act(() => { vi.advanceTimersByTime(2_000); });
    expect(result.current).toEqual({ index: 1, leadProgress: 0, exitProgress: 0 });
    act(() => { vi.advanceTimersByTime(2_000); });
    expect(result.current).toEqual({ index: 2, leadProgress: 0, exitProgress: 0 });
    act(() => { vi.advanceTimersByTime(1_000); });
    expect(result.current).toEqual({ index: 2, leadProgress: 0.5, exitProgress: 0 });
  });
  it('joins a dwell that started earlier at the right frame', () => {
    const { result } = renderHook(() => useStage(plan, 100_000 - 2_500));
    expect(result.current).toEqual({ index: 1, leadProgress: 0, exitProgress: 0 });
  });
  it('a new start resets to the first frame', () => {
    const { result, rerender } = renderHook((p: { start: number }) => useStage(plan, p.start), { initialProps: { start: 100_000 - 5_000 } });
    expect(result.current).toEqual({ index: 2, leadProgress: 0.5, exitProgress: 0 });
    rerender({ start: 100_000 });
    expect(result.current).toEqual({ index: 0, leadProgress: 0, exitProgress: 0 });
  });
});

describe('useStage across a change of dwell', () => {
  /**
   * The render that brings a new dwell is the one the browser PAINTS. An
   * effect that corrects the stage afterwards runs a frame too late, so the
   * glass paints the previous dwell's index against the new run — its newest
   * picture — before snapping back to the oldest. Reported 2026-09-09 as a
   * flash of a lighter, later picture at the start of a sunrise run.
   */
  it('reads the new dwell during the render that brings it, not after the paint', () => {
    const seen: Stage[] = [];
    const { rerender } = renderHook(
      (p: { start: number }) => { const s = useStage(plan, p.start); seen.push(s); return s; },
      { initialProps: { start: 100_000 - 5_000 } },
    );
    expect(seen[seen.length - 1]).toEqual({ index: 2, leadProgress: 0.5, exitProgress: 0 });
    seen.length = 0;
    rerender({ start: 100_000 });
    expect(seen[0]).toEqual({ index: 0, leadProgress: 0, exitProgress: 0 });
  });
});
