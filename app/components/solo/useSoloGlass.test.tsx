import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSoloGlass } from './useSoloGlass';
import { dialsFrom, SOLO_SETTINGS_SCHEMA } from '@/app/lib/solo/settingsSchema';
import { schemaDefaults } from '@/app/lib/settings/schema';

const D = dialsFrom(schemaDefaults(SOLO_SETTINGS_SCHEMA));
const entry = (id: number) => ({
  snapshotId: id, webcamId: 1, bin: 'sunset', quality: 0.9, detection: 0.9, isNew: false,
  tally: 0, enteredAt: 0, imageUrl: `u${id}`, title: `t${id}`, city: '', region: '', country: '', eligible: true, rank: 1,
});
const state = (currentId: number | null, nextIds: number[]) => ({
  feed: 'sunrise', dials: D, current: currentId ? { entry: entry(currentId), shownSince: 0, slot: 0 } : null,
  next: nextIds.map(entry), bins: { sunset: [], nonSunset: [] }, schedule: { slot: 0, nextBoundaryMs: 0 },
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
  vi.setSystemTime(new Date(1_000_000_000_000)); // on a sunrise boundary; next at +20 s
  vi.stubGlobal('Image', class {
    onload: null | (() => void) = null;
    onerror: null | (() => void) = null;
    set src(_v: string) { this.onload?.(); }
  });
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url.includes('/advance')) return { ok: true, json: async () => ({ advanced: true, ...state(2, [3]) }) };
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
    expect(adv?.body).toEqual({ feed: 'sunrise', slot: 50_000_001, version: 'solo' });
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
});
