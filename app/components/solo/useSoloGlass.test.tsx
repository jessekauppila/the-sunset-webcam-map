import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { RETRY_MS, STATE_REFRESH_MS, useSoloGlass } from './useSoloGlass';
import { dialsFrom, SOLO_SETTINGS_SCHEMA } from '@/app/lib/solo/settingsSchema';
import { schemaDefaults } from '@/app/lib/settings/schema';

const D = dialsFrom(schemaDefaults(SOLO_SETTINGS_SCHEMA));
const entry = (id: number) => ({
  snapshotId: id, webcamId: 1, bin: 'sunset', quality: 0.9, detection: 0.9, isNew: false,
  tally: 0, enteredAt: 0, imageUrl: `u${id}`, title: `t${id}`, city: '', region: '', country: '', eligible: true, rank: 1,
});
const NOW = 1_000_000_000_000;
const DWELL_MS = D.dwellS * 1000;
/**
 * A server state view. `n` is which draw it is: the slot is a counter, and
 * the dwell's end is an instant the SERVER publishes, so the hook waits for
 * that rather than computing a boundary from the clock (spec §5.1).
 */
const state = (currentId: number | null, nextIds: number[], n = 0) => ({
  feed: 'sunrise', dials: D,
  current: currentId
    ? { entry: entry(currentId), shownSince: NOW + n * DWELL_MS, slot: n, endsAtMs: NOW + (n + 1) * DWELL_MS }
    : null,
  next: nextIds.map(entry), bins: { sunset: [], nonSunset: [] },
  schedule: { slot: n, nextBoundaryMs: NOW + (n + 1) * DWELL_MS },
  lastPull: { admitted: { sunset: 0, nonSunset: 0 } }, entries: [], zone: { minDeg: -24, maxDeg: -2 },
});

let calls: { url: string; body?: unknown }[];
const fetchMock = vi.fn();
// Testing Library's waitFor polls with setTimeout, which the fake clock
// freezes; flushing the fake clock by a few ms settles the fetch chain instead.
const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(5); });
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

beforeEach(() => {
  calls = [];
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
  vi.stubGlobal('Image', class {
    onload: null | (() => void) = null;
    onerror: null | (() => void) = null;
    set src(_v: string) { this.onload?.(); }
  });
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url.includes('/advance')) return { ok: true, json: async () => ({ advanced: true, ...state(2, [3], 1) }) };
    return { ok: true, json: async () => state(1, [2]) };
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useSoloGlass', () => {
  it('shows the server current, preloads next, and advances at the boundary with the slot', async () => {
    const { result } = renderHook(() => useSoloGlass({ feed: 'sunrise', dials: D, drive: true, dozing: false }));
    await flush();
    expect(result.current.current?.snapshotId).toBe(1);
    expect(result.current.next?.snapshotId).toBe(2);
    await advance(20_000);
    expect(result.current.current?.snapshotId).toBe(2);
    const adv = calls.find((c) => c.url.includes('/advance'));
    // The counter after the one on glass, not a clock reading.
    expect(adv?.body).toEqual({ feed: 'sunrise', slot: 1, version: 'solo' });
    expect(calls[0].url).toContain('version=solo');
  });
  it('names its version in the state URL and the advance body, and surfaces the entries', async () => {
    const { result } = renderHook(() => useSoloGlass({ feed: 'sunrise', dials: D, drive: true, dozing: false, version: 'solo2' }));
    await flush();
    expect(calls[0].url).toContain('version=solo2');
    expect(result.current.entries).toEqual([]);
    expect(result.current.nextEntries.map((e) => e.snapshotId)).toEqual([2]);
    await advance(20_000);
    expect(calls.find((c) => c.url.includes('/advance'))?.body).toMatchObject({ version: 'solo2' });
  });
  it('does not advance while dozing or when it only follows', async () => {
    const { result, rerender } = renderHook(
      (p: { drive: boolean; dozing: boolean }) => useSoloGlass({ feed: 'sunrise', dials: D, ...p }),
      { initialProps: { drive: false, dozing: false } },
    );
    await flush();
    expect(result.current.current?.snapshotId).toBe(1);
    await advance(20_000);
    expect(calls.some((c) => c.url.includes('/advance'))).toBe(false);
    rerender({ drive: true, dozing: true });
    await advance(20_000);
    expect(calls.some((c) => c.url.includes('/advance'))).toBe(false);
  });
  it('keeps the frame up and records the error when advance fails', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.includes('/advance')
        ? { ok: false, status: 500, json: async () => ({}) }
        : { ok: true, json: async () => state(1, [2]) });
    const { result } = renderHook(() => useSoloGlass({ feed: 'sunrise', dials: D, drive: true, dozing: false }));
    await flush();
    expect(result.current.current?.snapshotId).toBe(1);
    await advance(20_000);
    expect(result.current.error).toMatch(/500/);
    expect(result.current.current?.snapshotId).toBe(1);
  });
  // The 2026-09-06 sunrise wedge: the frame on glass aged out of the pool,
  // so `current` came back null while the screen row kept its slot. The tab
  // fell back to slot 1, the server rejected it (400: not near 89437690), and
  // the hook never tried again. The screen sat dark for 50 minutes with a
  // full queue.
  it('recovers the screen slot when nothing is on glass, rather than posting slot 1', async () => {
    const SLOT = 89437689;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, body });
      if (url.includes('/advance')) {
        return body.slot === SLOT + 1
          ? { ok: true, json: async () => ({ advanced: true, ...state(2, [3], SLOT + 1) }) }
          : { ok: false, status: 400, json: async () => ({ error: `slot ${body.slot} is not near ${SLOT + 1}` }) };
      }
      return { ok: true, json: async () => state(null, [2], SLOT) };
    });
    const { result } = renderHook(() => useSoloGlass({ feed: 'sunrise', dials: D, drive: true, dozing: false }));
    await flush();
    expect(result.current.current).toBeNull();
    // Nothing is on glass, so there is no dwell to wait out: it advances now.
    await advance(1_000);
    const posted = calls.filter((c) => c.url.includes('/advance')).map((c) => (c.body as { slot: number }).slot);
    expect(posted).toEqual([SLOT + 1]);
    expect(result.current.current?.snapshotId).toBe(2);
    expect(result.current.error).toBeNull();
  });
  it('retries a rejected advance at the next tick instead of latching on the slot', async () => {
    let attempts = 0;
    // A server: once the advance lands, the state reflects it.
    let served = state(1, [2]);
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.includes('/advance')) {
        attempts += 1;
        if (attempts === 1) return { ok: false, status: 500, json: async () => ({}) };
        served = state(2, [3], 1);
        return { ok: true, json: async () => ({ advanced: true, ...served }) };
      }
      return { ok: true, json: async () => served };
    });
    const { result } = renderHook(() => useSoloGlass({ feed: 'sunrise', dials: D, drive: true, dozing: false }));
    await flush();
    await advance(DWELL_MS + 100);
    expect(result.current.error).toMatch(/500/);
    expect(result.current.current?.snapshotId).toBe(1);
    await advance(STATE_REFRESH_MS);
    expect(calls.filter((c) => c.url.includes('/advance')).map((c) => c.body)).toEqual([
      { feed: 'sunrise', slot: 1, version: 'solo' },
      { feed: 'sunrise', slot: 1, version: 'solo' },
    ]);
    expect(result.current.current?.snapshotId).toBe(2);
    expect(result.current.error).toBeNull();
  });
  it('paces retries while the advance keeps failing, and never spins', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return url.includes('/advance')
        ? { ok: false, status: 500, json: async () => ({}) }
        : { ok: true, json: async () => state(1, [2]) };
    });
    renderHook(() => useSoloGlass({ feed: 'sunrise', dials: D, drive: true, dozing: false }));
    await flush();
    await advance(DWELL_MS + 100);
    expect(calls.filter((c) => c.url.includes('/advance'))).toHaveLength(1);
    // act() flushes a fire's re-arm only when it returns, so walk the clock
    // in steps; every step is a chance to fire, and the pace bounds the count.
    const steps = 12;
    for (let i = 0; i < steps; i += 1) await advance(RETRY_MS / 2);
    const posts = calls.filter((c) => c.url.includes('/advance')).length;
    expect(posts).toBeGreaterThanOrEqual(3);
    expect(posts).toBeLessThanOrEqual(1 + steps / 2 + 1);
  });
  it('waits for the next state refresh when the server had nothing to show', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      // The server accepted the slot but drew nothing: the screen stays where it was.
      return url.includes('/advance')
        ? { ok: true, json: async () => ({ advanced: false, ...state(1, [], 0) }) }
        : { ok: true, json: async () => state(1, [], 0) };
    });
    renderHook(() => useSoloGlass({ feed: 'sunrise', dials: D, drive: true, dozing: false }));
    await flush();
    await advance(DWELL_MS + 100);
    expect(calls.filter((c) => c.url.includes('/advance'))).toHaveLength(1);
    await advance(STATE_REFRESH_MS / 2);
    expect(calls.filter((c) => c.url.includes('/advance'))).toHaveLength(1);
    await advance(STATE_REFRESH_MS);
    expect(calls.filter((c) => c.url.includes('/advance'))).toHaveLength(2);
  });
});
