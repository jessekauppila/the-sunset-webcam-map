import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLoopingStage } from './useLoopingStage';
import { fitPlan } from '@/app/lib/solo2/plan';

const plan = fitPlan({ dwellS: 6, leadS: 0 }, 3); // 2 s a frame

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(100_000));
});
afterEach(() => vi.useRealTimers());

describe('useLoopingStage', () => {
  it('starts at the first frame, walks the run, and wraps at the dwell', () => {
    const { result } = renderHook(() => useLoopingStage(plan, 1));
    expect(result.current.index).toBe(0);
    act(() => { vi.advanceTimersByTime(2_000); });
    expect(result.current.index).toBe(1);
    act(() => { vi.advanceTimersByTime(2_000); });
    expect(result.current.index).toBe(2);
    act(() => { vi.advanceTimersByTime(2_000); });
    expect(result.current.index).toBe(0); // round again
  });
  it('restarts when the key changes', () => {
    const { result, rerender } = renderHook((p: { key: number }) => useLoopingStage(plan, p.key), { initialProps: { key: 1 } });
    act(() => { vi.advanceTimersByTime(4_000); });
    expect(result.current.index).toBe(2);
    rerender({ key: 2 });
    act(() => { vi.advanceTimersByTime(0); });
    expect(result.current.index).toBe(0);
  });
});
