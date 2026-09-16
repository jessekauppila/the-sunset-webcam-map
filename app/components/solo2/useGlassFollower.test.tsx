import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { schemaDefaults } from '@/app/lib/settings/schema';
import { SOLO2_SETTINGS_SCHEMA, dialsFrom2 } from '@/app/lib/solo2/settingsSchema';
import { withCaption } from '@/app/lib/solo/captionSchema';
import { FOLLOW_GRACE_MS, RETRY_MS, STATE_REFRESH_MS, useGlassFollower } from './useGlassFollower';

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
    // act() only flushes a fire's re-arm when its own advance() call
    // returns (app/components/solo/useSoloGlass.test.tsx:169-175 hits the
    // same thing), so each retry needs its own advance() to land within it.
    for (let i = 0; i < 3; i += 1) await advance(RETRY_MS); // t ≈ 21.7, 22.7, 23.7 s: three retries
    expect(fetches()).toBe(5);
    // The patience window is 10 s from the 20.7 s boundary miss: seven more
    // retries land at 24.7 .. 30.7 s, then the tenth's re-arm check finds
    // the window exceeded and declines to schedule an eleventh.
    for (let i = 0; i < 7; i += 1) await advance(RETRY_MS);
    const afterPatience = fetches();
    expect(afterPatience).toBe(12); // boundary miss + 10 retries, genuinely parked at 30.7 s
    await advance(RETRY_MS * 5); // t ≈ 35.7 s, well past the window and before the minute refresh
    expect(fetches()).toBe(afterPatience); // parked
  });
  it('an empty glass does not strand a stale patience clock for the next dwell', async () => {
    // Enter retry mode immediately: the served end is already long past.
    served = { ...view(0), current: { ...view(0).current!, endsAtMs: NOW - 10_000 } };
    renderHook(() => useGlassFollower('sunrise'));
    await flush(); // t ≈ 5 ms: the mount fetch finds it already past due; waitingSinceMs is set here
    served = view(0, { current: false }); // the next read finds nothing on glass
    await advance(RETRY_MS); // t ≈ 1.0 s: the pending retry fires and finds nothing
    // More than ten seconds pass with nothing on glass; only the minute
    // refresh is scheduled. Change what it will find before it fires: the
    // same slot, already past due again.
    served = { ...view(0), current: { ...view(0).current!, endsAtMs: NOW } };
    await advance(STATE_REFRESH_MS - RETRY_MS + 5); // t ≈ 60.0 s: the minute refresh finds the miss
    const afterMiss = fetches();
    // A stale waitingSinceMs (left over from the very first miss, above)
    // would read as ten seconds overdue already and park on this miss with
    // zero retries; a cleared one gets a fresh patience window and retries.
    for (let i = 0; i < 3; i += 1) await advance(RETRY_MS);
    expect(fetches()).toBeGreaterThanOrEqual(afterMiss + 2);
  });
  it('resumes boundary timing when a refresh brings a future end', async () => {
    const { result } = renderHook(() => useGlassFollower('sunrise'));
    await flush();
    await advance(DWELL + FOLLOW_GRACE_MS + 5); // t ≈ 20.7 s: the boundary fetch finds slot 0 still
    // Stepped advances all the way to the patience cutoff, so `parked` is
    // captured once the hook has genuinely stopped retrying, not mid-chain
    // (see the retry test above for why a single lumped advance would lie).
    for (let i = 0; i < 10; i += 1) await advance(RETRY_MS); // t ≈ 21.7 .. 30.7 s: ten retries, then parked
    const parked = fetches();
    expect(parked).toBe(12); // boundary miss + 10 retries
    // The glass moved on while we were parked. The minute refresh at 60 s
    // learns of slot 1, on glass since 70 s, ending at 90 s.
    served = { ...view(1), current: { ...view(1).current!, shownSince: NOW + 70_000, endsAtMs: NOW + 90_000 } };
    await advance(STATE_REFRESH_MS - (DWELL + FOLLOW_GRACE_MS + 5 + RETRY_MS * 10) + 10); // t ≈ 60.01 s
    expect(fetches()).toBe(parked + 1);
    expect(result.current.slot).toBe(1);
    served = view(2);
    await advance(30_000); // t ≈ 90.01 s: the end, but not yet the grace
    expect(fetches()).toBe(parked + 1);
    await advance(FOLLOW_GRACE_MS + 10); // t ≈ 90.72 s
    expect(fetches()).toBe(parked + 2);
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
    await advance(DWELL + FOLLOW_GRACE_MS + 5); // t ≈ 20.7 s: the boundary fetch finds slot 0 still
    // Stepped advances so the window genuinely contains the retries (see
    // the retry test above for why one lumped advance would not).
    for (let i = 0; i < 10; i += 1) await advance(RETRY_MS); // t ≈ 21.7 .. 30.7 s: ten retries, then parked
    await advance(STATE_REFRESH_MS - (DWELL + FOLLOW_GRACE_MS + 5 + RETRY_MS * 10) + 10); // t ≈ 60.01 s: the minute refresh
    expect(calls.length).toBeGreaterThan(3);
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
