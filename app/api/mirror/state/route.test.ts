// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const listActiveEntries = vi.fn();
const getScreenState = vi.fn();
const commitAdvance = vi.fn();
const getLiveSettingsCached = vi.fn();
const growDwell = vi.fn();
vi.mock('server-only', () => ({}));
vi.mock('@/app/lib/db', () => ({ sql: vi.fn() }));
vi.mock('@/app/lib/solo/store', () => ({
  listActiveEntries: (...a: unknown[]) => listActiveEntries(...a),
  getScreenState: (...a: unknown[]) => getScreenState(...a),
  commitAdvance: (...a: unknown[]) => commitAdvance(...a),
  growDwell: (...a: unknown[]) => growDwell(...a),
}));
vi.mock('@/app/lib/settings/liveSettings', () => ({ getLiveSettingsCached: () => getLiveSettingsCached() }));

import { GET } from './route';

const get = (qs: string) => GET(new NextRequest(`http://t/api/mirror/state${qs}`));
const entry = (id: number, capturedAt: number, webcamId = 7, quality = 0.9) => ({
  feed: 'sunset', snapshotId: id, webcamId, bin: 'sunset', quality, detection: 0.9, isNew: false, tally: 0, enteredAt: id,
  firstShownAt: null, lastShownAt: null, imageUrl: `u${id}`, title: `t${id}`, city: '', region: '', country: '', lat: 0, lng: 0,
  capturedAt, timezone: null, sunAltitudeDeg: null,
});
const NOW = Date.UTC(2026, 8, 15, 17, 30, 0);
const row = (slot: number, shownSince: number, dwellMs: number, currentSnapshotId = 3) => ({
  feed: 'sunset', currentSnapshotId, shownSince, slot, sunsetStreak: 1, dwellMs, shownSnapshotIds: [1, 3],
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
  // activeVersion is explicit because the registry default is v1, and only the
  // live version's engine draws: without it every advance below is skipped.
  getLiveSettingsCached.mockResolvedValue({ namespaces: { shared: { activeVersion: 'solo2', panelPreset: 'ktc-l' }, solo2: { valleys: 0 } }, revision: 1 });
  listActiveEntries.mockResolvedValue([entry(1, 100), entry(2, 200), entry(3, 300), entry(9, 250, 8, 0.8)]);
  getScreenState.mockResolvedValue(null);
  commitAdvance.mockResolvedValue(true);
  growDwell.mockResolvedValue(true);
});
afterEach(() => vi.useRealTimers());

describe('GET /api/mirror/state', () => {
  it('rejects a bad or missing feed', async () => {
    expect((await get('')).status).toBe(400);
    expect((await get('?feed=noon')).status).toBe(400);
  });
  it('is cacheable at the edge for one second', async () => {
    const res = await get('?feed=sunset');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, s-maxage=1, stale-while-revalidate=4');
  });
  it('carries the live panel preset, the solo2 dials with caption, and the build', async () => {
    const body = await (await get('?feed=sunset')).json();
    expect(body.version).toBe('solo2');
    expect(body.panelPreset).toBe('ktc-l');
    expect(body.dials.beatS).toBeGreaterThan(0);
    expect(body.dials.cameraRun).toBeDefined();
    expect(typeof body.build).toBe('string');
  });
  it('leaves a running dwell alone', async () => {
    getScreenState.mockResolvedValue(row(12, NOW - 4_000, 20_000));
    const body = await (await get('?feed=sunset')).json();
    expect(commitAdvance).not.toHaveBeenCalled();
    expect(body.slot).toBe(12);
    expect(body.current.entry.snapshotId).toBe(3);
    expect(body.current.endsAtMs).toBe(NOW + 16_000);
  });
  it('draws the next slot when the dwell is over, and answers with the new one', async () => {
    getScreenState.mockResolvedValue(row(12, NOW - 30_000, 20_000));
    const body = await (await get('?feed=sunset')).json();
    expect(commitAdvance).toHaveBeenCalledWith('sunset', 13, expect.anything(), expect.any(Number), expect.any(Array), 'solo2', expect.any(Number), expect.any(Number), null, false);
    expect(body.slot).toBe(13);
    expect(body.current.shownSince).toBe(NOW); // on the tick
  });
  it('gets no slack: a dwell ending in 500 ms is left alone, where a kiosk-fired advance would draw', async () => {
    getScreenState.mockResolvedValue(row(12, NOW - 19_500, 20_000));
    const body = await (await get('?feed=sunset')).json();
    expect(commitAdvance).not.toHaveBeenCalled();
    expect(body.slot).toBe(12);
  });
  it('draws slot 0 when there is no row', async () => {
    const body = await (await get('?feed=sunset')).json();
    expect(commitAdvance).toHaveBeenCalledWith('sunset', 0, expect.anything(), expect.any(Number), expect.any(Array), 'solo2', expect.any(Number), expect.any(Number), null, false);
    expect(body.slot).toBe(0);
  });
  it('a reader that loses the race answers with the winner\'s row', async () => {
    getScreenState.mockResolvedValueOnce(row(12, NOW - 30_000, 20_000)).mockResolvedValueOnce(row(13, NOW, 20_000));
    commitAdvance.mockResolvedValue(false);
    const body = await (await get('?feed=sunset')).json();
    expect(getScreenState).toHaveBeenCalledTimes(2);
    expect(body.slot).toBe(13);
  });
  it('sends the run and the next run, not the pool', async () => {
    const big = Array.from({ length: 800 }, (_, i) => entry(1000 + i, i, 200 + (i % 150), 0.5));
    listActiveEntries.mockResolvedValue([entry(1, 100), entry(2, 200), entry(3, 300), ...big]);
    getScreenState.mockResolvedValue(row(12, NOW - 4_000, 20_000));
    const body = await (await get('?feed=sunset')).json();
    // A run is bounded by the frame cap and a camera has about five frames here; the point is "not 800".
    expect(body.entries.length).toBeLessThan(80);
    expect(body).not.toHaveProperty('bins');
    expect(body).not.toHaveProperty('tape');
  });
  it('answers a store failure with a cacheable 503 rather than a bare 500', async () => {
    listActiveEntries.mockRejectedValue(new Error('neon down'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await get('?feed=sunset');
    expect(res.status).toBe(503);
    expect(res.headers.get('cache-control')).toBe('public, s-maxage=1, stale-while-revalidate=4');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
  it('does not draw when the live version is not solo2, even past the end', async () => {
    getLiveSettingsCached.mockResolvedValue({ namespaces: { shared: { activeVersion: 'solo', panelPreset: 'ktc-l' } }, revision: 1 });
    getScreenState.mockResolvedValue(row(12, NOW - 30_000, 20_000));
    const body = await (await get('?feed=sunset')).json();
    expect(commitAdvance).not.toHaveBeenCalled();
    expect(body.slot).toBe(12);
  });
  it('rejects any parameter but feed, so the cache key space stays two URLs', async () => {
    expect((await get('?feed=sunset&r=1')).status).toBe(400);
    expect((await get('?feed=sunset&version=solo')).status).toBe(400);
    expect(commitAdvance).not.toHaveBeenCalled();
  });
  it('with the rendezvous dial on, reads the other screen and commits the fit', async () => {
    getLiveSettingsCached.mockResolvedValue({ namespaces: { shared: { activeVersion: 'solo2', panelPreset: 'ktc-l' }, solo2: { rendezvous: true } }, revision: 1 });
    // Camera 7 climbs to its peak on the newest frame, so there is a climb to
    // thin: the fit can land the peak two beats out rather than report that it
    // has nothing to give.
    listActiveEntries.mockResolvedValue([entry(1, 100, 7, 0.5), entry(2, 200, 7, 0.7), entry(3, 300, 7, 0.95), entry(9, 250, 8, 0.4)]);
    getScreenState.mockImplementation(async (feed: string) => feed === 'sunrise'
      ? { feed: 'sunrise', currentSnapshotId: 9, shownSince: NOW, slot: 3, sunsetStreak: 0, dwellMs: 40_000, shownSnapshotIds: [9], peakAtMs: NOW + 8_000, rendezvous: false }
      : null);
    await get('?feed=sunset');
    expect(getScreenState).toHaveBeenCalledWith('sunrise');
    expect(commitAdvance).toHaveBeenCalledTimes(1);
    const args = commitAdvance.mock.calls[0];
    expect(args[5]).toBe('solo2');
    // The fit landed the other screen's peak: the dial reached drawSlot and the
    // engine, which a plain draw (null, false, and no other-screen read at all)
    // would not show.
    expect(args[8]).toBe(NOW + 8_000);
    expect(args[9]).toBe(true);
  });
});
