import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useStage } from './useStage';
import type { DwellPlan } from '@/app/lib/solo2/plan';

const plan: DwellPlan = { dwellS: 6, preludeFrames: 2, preludeStepS: 1, leadS: 2, holdS: 2, clamped: false };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(100_000));
});
afterEach(() => vi.useRealTimers());

describe('useStage', () => {
  it('walks prelude → main → lead on the wall clock', () => {
    const { result } = renderHook(() => useStage(plan, 100_000));
    expect(result.current).toEqual({ layer: 'prelude', index: 0 });
    act(() => { vi.advanceTimersByTime(1_000); });
    expect(result.current).toEqual({ layer: 'prelude', index: 1 });
    act(() => { vi.advanceTimersByTime(1_000); });
    expect(result.current).toEqual({ layer: 'main', leadProgress: 0 });
    act(() => { vi.advanceTimersByTime(3_000); });
    expect(result.current).toEqual({ layer: 'main', leadProgress: 0.5 });
  });
  it('joins a dwell that started earlier at the right step', () => {
    const { result } = renderHook(() => useStage(plan, 100_000 - 1_500));
    expect(result.current).toEqual({ layer: 'prelude', index: 1 });
  });
  it('a new start resets to the first stage', () => {
    const { result, rerender } = renderHook((p: { start: number }) => useStage(plan, p.start), { initialProps: { start: 100_000 - 5_000 } });
    expect(result.current).toEqual({ layer: 'main', leadProgress: 0.5 });
    rerender({ start: 100_000 });
    expect(result.current).toEqual({ layer: 'prelude', index: 0 });
  });
});
