// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const listActiveEntries = vi.fn();
const getScreenState = vi.fn();
const commitAdvance = vi.fn();
const countAdmittedSince = vi.fn();
const getLiveSettingsCached = vi.fn();
const getSweptZone = vi.fn();
vi.mock('server-only', () => ({}));
// sweepGeometry's module pulls in the Neon client; the route only uses its pure half.
vi.mock('@/app/lib/db', () => ({ sql: vi.fn() }));
vi.mock('@/app/lib/runtimeFlags', () => ({ isFlagEnabled: async () => false, SWEEP_FORCE_DAY_RING: 'x' }));
vi.mock('@/app/lib/solo/store', () => ({
  listActiveEntries: (...a: unknown[]) => listActiveEntries(...a),
  getScreenState: (...a: unknown[]) => getScreenState(...a),
  commitAdvance: (...a: unknown[]) => commitAdvance(...a),
  countAdmittedSince: (...a: unknown[]) => countAdmittedSince(...a),
  getSweptZone: (...a: unknown[]) => getSweptZone(...a),
}));
vi.mock('@/app/lib/settings/liveSettings', () => ({ getLiveSettingsCached: () => getLiveSettingsCached() }));

import { POST } from './route';

const entry = (id: number, q: number, tally = 0) => ({
  feed: 'sunset', snapshotId: id, webcamId: 100 + id, bin: 'sunset', quality: q, detection: 0.9,
  isNew: false, tally, enteredAt: id, firstShownAt: null, lastShownAt: null,
  imageUrl: `u${id}`, title: '', city: '', region: '', country: '', lat: 0, lng: 0,
  capturedAt: 0, timezone: null, sunAltitudeDeg: null,
});
const post = (body: unknown) =>
  POST(new Request('http://t/api/kiosk/solo/advance', { method: 'POST', body: JSON.stringify(body) }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(1_000_000_000_000));
  getLiveSettingsCached.mockResolvedValue({ namespaces: {}, revision: 1 });
  listActiveEntries.mockResolvedValue([entry(1, 0.9), entry(2, 0.8)]);
  getScreenState.mockResolvedValue(null);
  commitAdvance.mockResolvedValue(true);
  countAdmittedSince.mockResolvedValue({ sunset: 0, nonSunset: 0 });
  getSweptZone.mockResolvedValue(null);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('POST /api/kiosk/solo/advance', () => {
  it('echoes the zone the cron last aged entries against, falling back to the guaranteed rings', async () => {
    expect((await (await post({ feed: 'sunrise', slot: 0 })).json()).zone)
      .toEqual({ minDeg: -16, maxDeg: 6 });
    getSweptZone.mockResolvedValue({ minDeg: -31.75, maxDeg: 21.75 });
    expect((await (await post({ feed: 'sunrise', slot: 0 })).json()).zone)
      .toEqual({ minDeg: -31.75, maxDeg: 21.75 });
  });
  it('rejects bad bodies', async () => {
    expect((await post({})).status).toBe(400);
    expect((await post({ feed: 'sunrise', slot: 'x' })).status).toBe(400);
  });
  it('rejects a slot that is not the next counter value', async () => {
    // A slot is a counter now, not a clock reading (spec §5, step 3), so the
    // only slot this accepts is the one after what is stored. With no screen
    // row that is 0; one behind is tolerated as the idempotent race.
    expect((await post({ feed: 'sunrise', slot: 500 })).status).toBe(400);
    // The old clock-derived slot for this frozen time. It used to be the only
    // accepted value; now it means nothing.
    expect((await post({ feed: 'sunrise', slot: 50_000_000 })).status).toBe(400);
    expect((await post({ feed: 'sunrise', slot: 0 })).status).toBe(200);
  });
  it('the accepted slot follows the stored one, not the wall clock', async () => {
    getScreenState.mockResolvedValue({ feed: 'sunrise', currentSnapshotId: 2, shownSince: 1, slot: 41, sunsetStreak: 0 });
    expect((await post({ feed: 'sunrise', slot: 42 })).status).toBe(200);
    expect(commitAdvance).toHaveBeenCalledWith('sunrise', 42, expect.objectContaining({ snapshotId: 1 }), 1,
      [expect.objectContaining({ snapshotId: 1 })], 'solo');
    // Moving the clock a long way does not move the accepted slot.
    vi.setSystemTime(new Date(1_000_500_000_000));
    expect((await post({ feed: 'sunrise', slot: 42 })).status).toBe(200);
  });
  it('advances to the engine pick and commits it with the new streak', async () => {
    const res = await post({ feed: 'sunrise', slot: 0 });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.advanced).toBe(true);
    expect(body.current.entry.snapshotId).toBe(1);
    expect(body.current.entry.tally).toBe(1);
    expect(commitAdvance).toHaveBeenCalledWith('sunrise', 0, expect.objectContaining({ snapshotId: 1 }), 1,
      [expect.objectContaining({ snapshotId: 1 })], 'solo');
  });
  it('version=solo2 marks every frame of the camera run shown, and the pick is the newest', async () => {
    // Camera 101 has frames 1 (older) and 3 (newer); camera 102 has frame 2.
    listActiveEntries.mockResolvedValue([
      { ...entry(1, 0.9), capturedAt: 100 }, { ...entry(2, 0.8), capturedAt: 150 }, { ...entry(3, 0.7), webcamId: 101, capturedAt: 300 },
    ]);
    const res = await post({ feed: 'sunrise', slot: 0, version: 'solo2' });
    const body = await res.json();
    expect(body.current.entry.snapshotId).toBe(3);
    expect(commitAdvance).toHaveBeenLastCalledWith('sunrise', 0, expect.objectContaining({ snapshotId: 3 }), 1,
      [expect.objectContaining({ snapshotId: 1 }), expect.objectContaining({ snapshotId: 3 })], 'solo2');
    const tallies = Object.fromEntries(body.entries.map((e: { snapshotId: number; tally: number }) => [e.snapshotId, e.tally]));
    expect(tallies).toEqual({ 1: 1, 2: 0, 3: 1 });
  });
  it('version=solo2 with valleys 1 draws the valley on an odd slot', async () => {
    getLiveSettingsCached.mockResolvedValue({ namespaces: { solo2: { valleys: 1 } }, revision: 1 });
    listActiveEntries.mockResolvedValue([entry(1, 0.9), entry(2, 0.8), entry(3, 0.7)]);
    // Beat parity is off the slot counter: slot 1 is beat 1, a valley.
    getScreenState.mockResolvedValue({ feed: 'sunrise', currentSnapshotId: null, shownSince: null, slot: 0, sunsetStreak: 0 });
    const res = await post({ feed: 'sunrise', slot: 1, version: 'solo2' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.current.entry.snapshotId).toBe(3);
    expect(body.nextRoles[0]).toBe('peak');
    expect((await post({ feed: 'sunrise', slot: 1, version: 'nope' })).status).toBe(400);
  });
  it('is a no-op for a slot already committed', async () => {
    getScreenState.mockResolvedValue({ feed: 'sunrise', currentSnapshotId: 1, shownSince: 1, slot: 41, sunsetStreak: 1 });
    const res = await post({ feed: 'sunrise', slot: 41 });
    expect((await res.json()).advanced).toBe(false);
    expect(commitAdvance).not.toHaveBeenCalled();
  });
  it('reports advanced:false when nothing is eligible', async () => {
    // The default rating floor (1) admits every sunset; a floor of 3 puts a 0.1 (rating 1.4) below it.
    getLiveSettingsCached.mockResolvedValue({ namespaces: { solo: { ratingFloor: 3 } }, revision: 1 });
    listActiveEntries.mockResolvedValue([entry(1, 0.1)]);
    const res = await post({ feed: 'sunrise', slot: 0 });
    expect((await res.json()).advanced).toBe(false);
    expect(commitAdvance).not.toHaveBeenCalled();
  });
});
