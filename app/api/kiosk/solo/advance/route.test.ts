// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const listActiveEntries = vi.fn();
const getScreenState = vi.fn();
const commitAdvance = vi.fn();
const countAdmittedSince = vi.fn();
const getLiveSettingsCached = vi.fn();
vi.mock('server-only', () => ({}));
// sweepGeometry's module pulls in the Neon client; the route only uses its pure half.
vi.mock('@/app/lib/db', () => ({ sql: vi.fn() }));
vi.mock('@/app/lib/runtimeFlags', () => ({ isFlagEnabled: async () => false, SWEEP_FORCE_DAY_RING: 'x' }));
vi.mock('@/app/lib/solo/store', () => ({
  listActiveEntries: (...a: unknown[]) => listActiveEntries(...a),
  getScreenState: (...a: unknown[]) => getScreenState(...a),
  commitAdvance: (...a: unknown[]) => commitAdvance(...a),
  countAdmittedSince: (...a: unknown[]) => countAdmittedSince(...a),
}));
vi.mock('@/app/lib/settings/liveSettings', () => ({ getLiveSettingsCached: () => getLiveSettingsCached() }));

import { POST } from './route';

const entry = (id: number, q: number, tally = 0) => ({
  feed: 'sunset', snapshotId: id, webcamId: 100 + id, bin: 'sunset', quality: q, detection: 0.9,
  isNew: false, tally, enteredAt: id, firstShownAt: null, lastShownAt: null,
  imageUrl: `u${id}`, title: '', city: '', region: '', country: '', lat: 0, lng: 0,
});
const post = (body: unknown) =>
  POST(new Request('http://t/api/kiosk/solo/advance', { method: 'POST', body: JSON.stringify(body) }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(1_000_000_000_000)); // slot 50_000_000 for dwell 20 / sunrise
  getLiveSettingsCached.mockResolvedValue({ namespaces: {}, revision: 1 });
  listActiveEntries.mockResolvedValue([entry(1, 0.9), entry(2, 0.8)]);
  getScreenState.mockResolvedValue(null);
  commitAdvance.mockResolvedValue(true);
  countAdmittedSince.mockResolvedValue({ sunset: 0, nonSunset: 0 });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('POST /api/kiosk/solo/advance', () => {
  it('rejects bad bodies', async () => {
    expect((await post({})).status).toBe(400);
    expect((await post({ feed: 'sunrise', slot: 'x' })).status).toBe(400);
  });
  it('rejects a slot far from the server clock', async () => {
    expect((await post({ feed: 'sunrise', slot: 1 })).status).toBe(400);
  });
  it('advances to the engine pick and commits it with the new streak', async () => {
    const res = await post({ feed: 'sunrise', slot: 50_000_000 });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.advanced).toBe(true);
    expect(body.current.entry.snapshotId).toBe(1);
    expect(body.current.entry.tally).toBe(1);
    expect(commitAdvance).toHaveBeenCalledWith('sunrise', 50_000_000, expect.objectContaining({ snapshotId: 1 }), 1);
  });
  it('is a no-op for a slot already committed', async () => {
    getScreenState.mockResolvedValue({ feed: 'sunrise', currentSnapshotId: 1, shownSince: 1, slot: 50_000_000, sunsetStreak: 1 });
    const res = await post({ feed: 'sunrise', slot: 50_000_000 });
    expect((await res.json()).advanced).toBe(false);
    expect(commitAdvance).not.toHaveBeenCalled();
  });
  it('reports advanced:false when nothing is eligible', async () => {
    listActiveEntries.mockResolvedValue([entry(1, 0.1)]);
    const res = await post({ feed: 'sunrise', slot: 50_000_000 });
    expect((await res.json()).advanced).toBe(false);
    expect(commitAdvance).not.toHaveBeenCalled();
  });
});
