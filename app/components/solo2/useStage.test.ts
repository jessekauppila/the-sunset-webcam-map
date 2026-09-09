import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useStage } from './useStage';
import { fitPlan } from '@/app/lib/solo2/plan';

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
