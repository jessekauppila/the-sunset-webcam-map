// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const listActiveEntries = vi.fn();
const getScreenState = vi.fn();
const commitAdvance = vi.fn();
const getLiveSettingsCached = vi.fn();
vi.mock('server-only', () => ({}));
vi.mock('@/app/lib/db', () => ({ sql: vi.fn() }));
vi.mock('@/app/lib/solo/store', () => ({
  listActiveEntries: (...a: unknown[]) => listActiveEntries(...a),
  getScreenState: (...a: unknown[]) => getScreenState(...a),
  commitAdvance: (...a: unknown[]) => commitAdvance(...a),
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
  getLiveSettingsCached.mockResolvedValue({ namespaces: { shared: { panelPreset: 'ktc-l' }, solo2: { valleys: 0 } }, revision: 1 });
  listActiveEntries.mockResolvedValue([entry(1, 100), entry(2, 200), entry(3, 300), entry(9, 250, 8, 0.8)]);
  getScreenState.mockResolvedValue(null);
  commitAdvance.mockResolvedValue(true);
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
    expect(commitAdvance).toHaveBeenCalledWith('sunset', 13, expect.anything(), expect.any(Number), expect.any(Array), 'solo2', expect.any(Number), expect.any(Number));
    expect(body.slot).toBe(13);
    expect(body.current.shownSince).toBe(NOW); // on the tick
  });
  it('draws slot 0 when there is no row', async () => {
    const body = await (await get('?feed=sunset')).json();
    expect(commitAdvance).toHaveBeenCalledWith('sunset', 0, expect.anything(), expect.any(Number), expect.any(Array), 'solo2', expect.any(Number), expect.any(Number));
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
});
