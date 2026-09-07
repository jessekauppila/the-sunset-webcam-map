import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, render, cleanup } from '@testing-library/react';
import { createElement } from 'react';
import type { EntryView } from '@/app/api/kiosk/solo/view';
import { useSoloPreview, type PreviewDwell } from './useSoloPreview';

const entry = (id: number): EntryView => ({
  snapshotId: id, webcamId: 100 + id, bin: 'sunset', quality: 0.8, detection: 0.9, isNew: false, tally: 1,
  enteredAt: 0, imageUrl: `u${id}`, title: `cam${id}`, city: 'Nuuk', region: '', country: 'Greenland',
  capturedAt: 0, timezone: null, sunAltitudeDeg: null, eligible: true, rank: 1,
  stage: { kind: 'queued', position: 1 },
});

const T0 = 100_000;
const DWELL = 8;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(T0));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useSoloPreview', () => {
  it('starts on the first frame of the order with no previous and the clock at mount', () => {
    const order = [entry(1), entry(2), entry(3)];
    const { result } = renderHook(() => useSoloPreview(order, DWELL));
    expect(result.current.entry?.snapshotId).toBe(1);
    expect(result.current.previous).toBeNull();
    expect(result.current.index).toBe(0);
    expect(result.current.startMs).toBe(T0);
  });

  it('advances a dwell later: entry, previous and startMs all move together', () => {
    const order = [entry(1), entry(2), entry(3)];
    const { result } = renderHook(() => useSoloPreview(order, DWELL));
    act(() => { vi.advanceTimersByTime(DWELL * 1000); });
    expect(result.current.entry?.snapshotId).toBe(2);
    expect(result.current.previous?.snapshotId).toBe(1);
    expect(result.current.index).toBe(1);
    expect(result.current.startMs).toBe(T0 + DWELL * 1000);
  });

  it('holds the frame until the dwell is up', () => {
    const order = [entry(1), entry(2)];
    const { result } = renderHook(() => useSoloPreview(order, DWELL));
    act(() => { vi.advanceTimersByTime(DWELL * 1000 - 500); });
    expect(result.current.entry?.snapshotId).toBe(1);
    expect(result.current.previous).toBeNull();
    expect(result.current.startMs).toBe(T0);
  });

  it('never renders a new entry beside a stale previous (Appendix A concerns 1 and 2)', () => {
    const order = [entry(1), entry(2), entry(3)];
    const seen: Array<{ entry: number | null; previous: number | null; startMs: number }> = [];
    function Probe() {
      const dwell: PreviewDwell = useSoloPreview(order, DWELL);
      seen.push({
        entry: dwell.entry?.snapshotId ?? null,
        previous: dwell.previous?.snapshotId ?? null,
        startMs: dwell.startMs,
      });
      return null;
    }
    render(createElement(Probe));
    act(() => { vi.advanceTimersByTime(DWELL * 1000); });
    act(() => { vi.advanceTimersByTime(DWELL * 1000); });

    // Every recorded render is a coherent pair: entry N is only ever shown
    // beside entry N-1, and the dwell start matches the frame it belongs to.
    const pairs = seen.map((s) => `${s.previous}->${s.entry}@${s.startMs}`);
    expect(pairs.every((p) => (
      p === `null->1@${T0}`
      || p === `1->2@${T0 + DWELL * 1000}`
      || p === `2->3@${T0 + 2 * DWELL * 1000}`
    ))).toBe(true);
    // and all three dwells were actually reached, in order.
    expect([...new Set(pairs)]).toEqual([
      `null->1@${T0}`,
      `1->2@${T0 + DWELL * 1000}`,
      `2->3@${T0 + 2 * DWELL * 1000}`,
    ]);
  });

  it('wraps at the end of the order', () => {
    const order = [entry(1), entry(2), entry(3)];
    const { result } = renderHook(() => useSoloPreview(order, DWELL));
    act(() => { vi.advanceTimersByTime(order.length * DWELL * 1000); });
    expect(result.current.entry?.snapshotId).toBe(1);
    expect(result.current.previous?.snapshotId).toBe(3);
    expect(result.current.index).toBe(0);
  });

  it('restarts at index 0 when the server advanced (order[0] changed), keeping the showing frame as previous', () => {
    const first = [entry(1), entry(2), entry(3)];
    const second = [entry(2), entry(3), entry(4)];
    const { result, rerender } = renderHook(
      (p: { order: EntryView[] }) => useSoloPreview(p.order, DWELL),
      { initialProps: { order: first } },
    );
    act(() => { vi.advanceTimersByTime(DWELL * 1000); }); // showing 2, previous 1
    expect(result.current.entry?.snapshotId).toBe(2);
    act(() => { vi.setSystemTime(new Date(T0 + DWELL * 1000 + 1_500)); });
    rerender({ order: second });
    expect(result.current.index).toBe(0);
    expect(result.current.entry?.snapshotId).toBe(2);
    expect(result.current.previous?.snapshotId).toBe(2);
    expect(result.current.startMs).toBe(T0 + DWELL * 1000 + 1_500);
  });

  it('an empty order gives an empty dwell, and filling it starts the clock', () => {
    const { result, rerender } = renderHook(
      (p: { order: EntryView[] }) => useSoloPreview(p.order, DWELL),
      { initialProps: { order: [] as EntryView[] } },
    );
    expect(result.current.entry).toBeNull();
    expect(result.current.previous).toBeNull();
    expect(result.current.index).toBe(0);
    act(() => { vi.advanceTimersByTime(DWELL * 1000 * 2); });
    expect(result.current.entry).toBeNull();
    expect(result.current.index).toBe(0);

    act(() => { vi.setSystemTime(new Date(T0 + 20_000)); });
    rerender({ order: [entry(5), entry(6)] });
    expect(result.current.entry?.snapshotId).toBe(5);
    expect(result.current.index).toBe(0);
    expect(result.current.startMs).toBe(T0 + 20_000);
  });

  it('clamps to the first frame on the next tick when the order shrinks under the index', () => {
    const long = [entry(1), entry(2), entry(3)];
    const short = [entry(1), entry(2)];
    const { result, rerender } = renderHook(
      (p: { order: EntryView[] }) => useSoloPreview(p.order, DWELL),
      { initialProps: { order: long } },
    );
    act(() => { vi.advanceTimersByTime(2 * DWELL * 1000); }); // index 2
    expect(result.current.index).toBe(2);
    rerender({ order: short }); // head is unchanged, so no restart
    expect(result.current.index).toBe(2);
    act(() => { vi.advanceTimersByTime(250); });
    expect(result.current.index).toBe(0);
    expect(result.current.entry?.snapshotId).toBe(1);
    expect(result.current.previous?.snapshotId).toBe(3);
  });

  it('catches up in one jump after a long pause, instead of stepping through every dwell', () => {
    const order = [entry(1), entry(2), entry(3), entry(4)];
    const { result } = renderHook(() => useSoloPreview(order, DWELL));
    act(() => {
      // A backgrounded tab suspends the interval entirely rather than firing
      // it late; the wall clock jumps and only the NEXT tick sees the gap.
      vi.setSystemTime(new Date(T0 + 3.5 * DWELL * 1000));
      vi.advanceTimersByTime(250);
    });
    expect(result.current.index).toBe(3);
    expect(result.current.startMs).toBe(T0 + 3 * DWELL * 1000);
    expect(result.current.previous?.snapshotId).toBe(order[0].snapshotId);
    expect(result.current.entry?.snapshotId).toBe(order[3].snapshotId);
  });

  it('takes a new dwell on the next tick without restarting the frame that is showing', () => {
    const order = [entry(1), entry(2), entry(3)];
    const { result, rerender } = renderHook(
      (p: { dwellS: number }) => useSoloPreview(order, p.dwellS),
      { initialProps: { dwellS: DWELL } },
    );
    act(() => { vi.advanceTimersByTime(4_000); });
    rerender({ dwellS: 5 }); // 4 s in, the new dwell is 5 s: 1 s left, no restart
    expect(result.current.entry?.snapshotId).toBe(1);
    expect(result.current.startMs).toBe(T0);
    act(() => { vi.advanceTimersByTime(1_000); });
    expect(result.current.entry?.snapshotId).toBe(2);
    expect(result.current.startMs).toBe(T0 + 5_000);
  });

  // A solo2 dwell is only as long as ITS OWN frame's run. Once a run has more
  // frames than the step floor allows, the budget stretches the dwell past the
  // dial (plan.dwellS), so one shared period cannot find the boundary.
  const stretched = (e: EntryView) => (e.snapshotId === 2 ? 20 : DWELL);

  it('gives every frame its own dwell, so a stretched run is not cut short at the dial', () => {
    const order = [entry(1), entry(2), entry(3)];
    const { result } = renderHook(() => useSoloPreview(order, stretched));
    act(() => { vi.advanceTimersByTime(DWELL * 1000); });
    expect(result.current.entry?.snapshotId).toBe(2);
    // The dial's 8 s comes and goes twice over; frame 2 holds, because its run is 20 s.
    act(() => { vi.advanceTimersByTime(DWELL * 1000); });
    expect(result.current.entry?.snapshotId).toBe(2);
    act(() => { vi.advanceTimersByTime(12_000); }); // 20 s into frame 2, at last
    expect(result.current.entry?.snapshotId).toBe(3);
    expect(result.current.startMs).toBe(T0 + (DWELL + 20) * 1000);
  });

  it('catches up over mixed dwells in one jump, counting each frame by its own length', () => {
    const order = [entry(1), entry(2), entry(3), entry(4)]; // 8 + 20 + 8 + 8 = 44 s a lap
    const { result } = renderHook(() => useSoloPreview(order, stretched));
    act(() => {
      // A lap, then frame 1's 8 s and frame 2's 20 s, and a second into frame 3.
      vi.setSystemTime(new Date(T0 + 44_000 + 28_000 + 1_000));
      vi.advanceTimersByTime(250);
    });
    expect(result.current.index).toBe(2);
    expect(result.current.startMs).toBe(T0 + 44_000 + 28_000);
    expect(result.current.previous?.snapshotId).toBe(1);
  });
});
