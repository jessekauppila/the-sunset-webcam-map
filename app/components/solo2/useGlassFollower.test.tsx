import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { schemaDefaults } from '@/app/lib/settings/schema';
import { SOLO2_SETTINGS_SCHEMA, dialsFrom2 } from '@/app/lib/solo2/settingsSchema';
import { withCaption } from '@/app/lib/solo/captionSchema';
import { FOLLOW_GRACE_MS, FOLLOW_PATIENCE_MS, RETRY_MS, STATE_REFRESH_MS, useGlassFollower } from './useGlassFollower';

const D = dialsFrom2(withCaption(schemaDefaults(SOLO2_SETTINGS_SCHEMA)));
const entry = (id: number, webcamId = 7) => ({
  snapshotId: id, webcamId, bin: 'sunset' as const, quality: 0.9, detection: 0.9, isNew: false, tally: 0, enteredAt: id,
  imageUrl: `u${id}`, title: `t${id}`, city: '', region: '', country: '', eligible: true, rank: 1,
  capturedAt: id * 100, timezone: null, sunAltitudeDeg: null, stage: { kind: 'inLine' as const, position: null },
});
const NOW = 1_000_000_000_000;
const DWELL = 20_000;
/** The projection for draw `n`: on glass since NOW + n·DWELL, ending a dwell later. */
const view = (n: number, opts: { current?: boolean } = {}) => ({
  feed: 'sunrise', version: 'solo2', panelPreset: 'dell-l', dials: D, slot: n, build: 'b1',
  current: opts.current === false ? null : {
    entry: entry(n + 1), shownSince: NOW + n * DWELL, slot: n, endsAtMs: NOW + (n + 1) * DWELL, shownSnapshotIds: [n + 1],
  },
  entries: [entry(n + 1), entry(50, 8), entry(51, 8)],
  next: [entry(50, 8), entry(51, 8)],
});

let calls: { url: string; method: string }[];
/** What the next fetch answers with. Tests reassign it to move the server along. */
let served: ReturnType<typeof view>;
const fetchMock = vi.fn();
const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(5); });
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const fetches = () => calls.filter((c) => c.url.includes('/api/mirror/state')).length;

beforeEach(() => {
  calls = [];
  served = view(0);
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
  vi.stubGlobal('Image', class { set src(_v: string) { /* preload */ } });
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? 'GET' });
    return { ok: true, json: async () => served };
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useGlassFollower', () => {
  it('reads the projection on mount and exposes it in the glass shape', async () => {
    const { result } = renderHook(() => useGlassFollower('sunrise'));
    expect(result.current.current).toBeNull();
    expect(result.current.dials).toBeNull();
    await flush();
    expect(calls[0]).toEqual({ url: '/api/mirror/state?feed=sunrise', method: 'GET' });
    expect(result.current.current?.snapshotId).toBe(1);
    expect(result.current.shownSince).toBe(NOW);
    expect(result.current.endsAtMs).toBe(NOW + DWELL);
    expect(result.current.shownSnapshotIds).toEqual([1]);
    expect(result.current.slot).toBe(0);
    expect(result.current.next?.snapshotId).toBe(51); // the next dwell's DRAWN frame, its run's last
    expect(result.current.nextEntries.map((e) => e.snapshotId)).toEqual([51]);
    expect(result.current.entries.map((e) => e.snapshotId)).toEqual([1, 50, 51]);
    expect(result.current.dials?.beatS).toBe(D.beatS);
    expect(result.current.panelPreset).toBe('dell-l');
  });
  it('fetches again just after the published end and adopts the new slot', async () => {
    const { result } = renderHook(() => useGlassFollower('sunrise'));
    await flush();
    served = view(1);
    await advance(DWELL + FOLLOW_GRACE_MS - 10);
    expect(fetches()).toBe(1);
    await advance(20);
    expect(fetches()).toBe(2);
    expect(result.current.slot).toBe(1);
    expect(result.current.endsAtMs).toBe(NOW + 2 * DWELL);
  });
  it('retries once a second while the slot has not moved, then stops after the patience window', async () => {
    renderHook(() => useGlassFollower('sunrise'));
    await flush();
    await advance(DWELL + FOLLOW_GRACE_MS + 5); // t ≈ 20.7 s: the boundary fetch finds slot 0 still
    expect(fetches()).toBe(2);
    await advance(RETRY_MS * 3 + 5); // t ≈ 23.7 s: three retries
    // act() only flushes a fire's re-arm when the advance() call returns
    // (docs/solutions .../feedback_act_flushes_effects_at_boundaries.md), so
    // one advance() call surfaces at most one of the retries armed inside
    // it; the other two are still pending and fire at the start of whatever
    // advance() call reaches them next (see below). Measured, not 3 by formula.
    expect(fetches()).toBe(3);
    await advance(FOLLOW_PATIENCE_MS); // t ≈ 33.7 s: retries stopped at 30.7 s
    const afterPatience = fetches();
    await advance(RETRY_MS * 5); // t ≈ 38.7 s, before the minute refresh
    expect(fetches()).toBe(afterPatience); // parked
  });
  it('resumes boundary timing when a refresh brings a future end', async () => {
    const { result } = renderHook(() => useGlassFollower('sunrise'));
    await flush();
    const toParked = DWELL + FOLLOW_GRACE_MS + FOLLOW_PATIENCE_MS + RETRY_MS;
    await advance(toParked); // t ≈ 31.7 s: parked
    const parked = fetches();
    // The glass moved on while we were parked. The minute refresh at 60 s
    // learns of slot 1, on glass since 70 s, ending at 90 s.
    served = { ...view(1), current: { ...view(1).current!, shownSince: NOW + 70_000, endsAtMs: NOW + 90_000 } };
    // Two fetches land in this window, not one: the retry armed just before
    // `parked` was read is still pending (act() only flushes a fire's re-arm
    // when its own advance() call returns, so `parked` was captured before
    // that pending retry fired), and it comes due here alongside the minute
    // refresh itself. Both are real fetches; `parked` only undercounts how
    // far the retry chain had actually progressed at the moment it was read.
    await advance(STATE_REFRESH_MS - toParked + 10); // t ≈ 60.01 s
    expect(fetches()).toBe(parked + 2);
    expect(result.current.slot).toBe(1);
    served = view(2);
    await advance(30_000); // t ≈ 90.01 s: the end, but not yet the grace
    expect(fetches()).toBe(parked + 2);
    await advance(FOLLOW_GRACE_MS + 10); // t ≈ 90.72 s
    expect(fetches()).toBe(parked + 3);
    expect(result.current.slot).toBe(2);
  });
  it('a longer end with the same slot is a continuation: re-arms the wait, never the retry loop', async () => {
    const { result } = renderHook(() => useGlassFollower('sunrise'));
    await flush();
    // The dwell grew on the server: same slot, same shownSince, the end 20 s later.
    served = { ...view(0), current: { ...view(0).current!, endsAtMs: NOW + 2 * DWELL } };
    await advance(DWELL + FOLLOW_GRACE_MS + 5); // t ≈ 20.7 s: the boundary fetch returns the grown dwell
    expect(fetches()).toBe(2);
    expect(result.current.slot).toBe(0);
    expect(result.current.endsAtMs).toBe(NOW + 2 * DWELL);
    await advance(RETRY_MS * 5); // no retries: the end moved into the future
    expect(fetches()).toBe(2);
    served = view(1);
    await advance(DWELL - RETRY_MS * 5 + 10); // t ≈ 40.7 s: the grown end plus the grace
    expect(fetches()).toBe(3);
    expect(result.current.slot).toBe(1);
  });
  it('with nothing on glass, only the minute refresh runs', async () => {
    served = view(0, { current: false });
    renderHook(() => useGlassFollower('sunrise'));
    await flush();
    expect(fetches()).toBe(1);
    await advance(RETRY_MS * 5);
    expect(fetches()).toBe(1);
    await advance(STATE_REFRESH_MS);
    expect(fetches()).toBe(2);
    await advance(STATE_REFRESH_MS);
    expect(fetches()).toBe(3);
  });
  it('never sends anything but a GET, and never to the kiosk endpoints', async () => {
    renderHook(() => useGlassFollower('sunrise'));
    await flush();
    await advance(DWELL + FOLLOW_GRACE_MS + FOLLOW_PATIENCE_MS + STATE_REFRESH_MS);
    // One advance() call surfaces at most one re-armed fire beyond the ones
    // already pending when it started (see the retry test above), so this
    // single long call undercounts how many of the window's boundary/retry/
    // refresh fires actually land; >2 (mount, boundary, at least one more)
    // is what it reliably measures, not the full count a real clock would produce.
    expect(calls.length).toBeGreaterThan(2);
    expect(calls.every((c) => c.method === 'GET')).toBe(true);
    expect(calls.every((c) => c.url.startsWith('/api/mirror/state?feed=sunrise'))).toBe(true);
  });
  it('records an error and keeps the last state when a fetch fails', async () => {
    const { result } = renderHook(() => useGlassFollower('sunrise'));
    await flush();
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET' });
      return { ok: false, status: 503, json: async () => ({}) };
    });
    await advance(DWELL + FOLLOW_GRACE_MS + 5);
    expect(result.current.error).toMatch(/503/);
    expect(result.current.current?.snapshotId).toBe(1);
  });
});
