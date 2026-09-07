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
  it('walks the run of the dwell it is given', () => {
    const { result } = renderHook(() => useLoopingStage(plan, NOW));
    expect(result.current.index).toBe(0);
    act(() => { vi.advanceTimersByTime(2_000); });
    expect(result.current.index).toBe(1);
    act(() => { vi.advanceTimersByTime(2_000); });
    expect(result.current.index).toBe(2);
  });

  it('restarts when the dwell start changes', () => {
    const { result, rerender } = renderHook((p: { start: number }) => useLoopingStage(plan, p.start), { initialProps: { start: NOW } });
    act(() => { vi.advanceTimersByTime(4_000); });
    expect(result.current.index).toBe(2);
    rerender({ start: NOW + 4_000 });
    act(() => { vi.advanceTimersByTime(0); });
    expect(result.current.index).toBe(0);
  });

  it('is phase-locked to the dwell: one that began a tick ago is already a tick in', () => {
    const { result } = renderHook(() => useLoopingStage(plan, NOW - 2_500));
    expect(result.current.index).toBe(1); // 2.5 s in, not 0
  });

  // The reported bug. `useSoloPreview` owns when a dwell ends and ticks at
  // 250 ms, so for up to a tick past the dwell it is still on the old one. A
  // stage that wrapped on its own clock reset the run to frame 0 inside a
  // stack that had not been rebuilt, and the frames above dissolved away to
  // reveal the oldest picture — the run "fading up to an earlier image".
  // Holding the last frame leaves the restart to the walker, in the one
  // commit that also brings the new dwell.
  it('holds the last frame past the dwell instead of wrapping itself', () => {
    const { result } = renderHook(() => useLoopingStage(plan, NOW - 6_100));
    expect(result.current.index).toBe(2);
  });

  it('still holds it far past the dwell, however late the walker is', () => {
    const { result } = renderHook(() => useLoopingStage(plan, NOW - 60_000));
    expect(result.current.index).toBe(2);
  });
});
