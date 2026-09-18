// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const listActiveEntries = vi.fn();
const getScreenState = vi.fn();
const commitAdvance = vi.fn();
const growDwell = vi.fn();
const countAdmittedSince = vi.fn();
const getLiveSettingsCached = vi.fn();
const getSweptZone = vi.fn();
vi.mock('server-only', () => ({}));
// sweepGeometry's module pulls in the Neon client; the route only uses its pure half.
vi.mock('@/app/lib/db', () => ({ sql: vi.fn() }));
vi.mock('@/app/lib/runtimeFlags', () => ({ isFlagEnabled: async () => false }));
vi.mock('@/app/lib/solo/store', () => ({
  listActiveEntries: (...a: unknown[]) => listActiveEntries(...a),
  getScreenState: (...a: unknown[]) => getScreenState(...a),
  commitAdvance: (...a: unknown[]) => commitAdvance(...a),
  growDwell: (...a: unknown[]) => growDwell(...a),
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
  growDwell.mockResolvedValue(true);
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
      [expect.objectContaining({ snapshotId: 1 })], 'solo', expect.any(Number), expect.any(Number), null, false);
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
    // Every draw now writes a landing and a rendezvous flag; solo has no
    // rendezvous, so it writes the pair that means "none".
    expect(commitAdvance).toHaveBeenCalledWith('sunrise', 0, expect.objectContaining({ snapshotId: 1 }), 1,
      [expect.objectContaining({ snapshotId: 1 })], 'solo', expect.any(Number), expect.any(Number), null, false);
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
      [expect.objectContaining({ snapshotId: 1 }), expect.objectContaining({ snapshotId: 3 })], 'solo2', expect.any(Number), expect.any(Number), null, false);
    const tallies = Object.fromEntries(body.entries.map((e: { snapshotId: number; tally: number }) => [e.snapshotId, e.tally]));
    expect(tallies).toEqual({ 1: 1, 2: 0, 3: 1 });
  });
  it('pins the engine\'s dwell and its run, and publishes exactly what it pinned', async () => {
    // The one write and the one response must carry the same decision. While
    // the end was recomputed per fetch it drifted away from the draw that made
    // it, and the glass stepped a run the published end had never been sized
    // for (reported 2026-09-08).
    listActiveEntries.mockResolvedValue([
      { ...entry(1, 0.9), capturedAt: 100 }, { ...entry(2, 0.8), capturedAt: 150 }, { ...entry(3, 0.7), webcamId: 101, capturedAt: 300 },
    ]);
    const res = await post({ feed: 'sunrise', slot: 0, version: 'solo2' });
    const body = await res.json();
    const pinnedDwellMs = commitAdvance.mock.calls.at(-1)![6] as number;
    expect(pinnedDwellMs).toBeGreaterThan(0);
    expect(body.current.shownSnapshotIds).toEqual([1, 3]);
    expect(body.current.endsAtMs).toBe(body.current.shownSince + pinnedDwellMs);
    expect(body.schedule.nextBoundaryMs).toBe(body.current.endsAtMs);
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
  describe('the advance starts the dwell on the tick (beat spec §2.6)', () => {
    // A lone sunset in the pool: cameraRun's rank is 1 (the only sunset present
    // ranks best), so at the default dials (dwellBeats 3, dwellBoost/Trim 25,
    // changeBeats 1, beat 4s) the still is round(3 x 1.25) = 4 beats, one frame,
    // so the dwell is 1 change + 1 frame + 3 rest = 5 beats = 20_000 ms.
    beforeEach(() => {
      listActiveEntries.mockResolvedValue([entry(1, 0.9)]);
    });
    it('solo2 starts the dwell on the nearest tick and publishes an end on the grid', async () => {
      const t0 = Date.UTC(2026, 8, 14, 17, 30, 0);
      vi.setSystemTime(new Date(t0 + 300)); // the kiosk fired at the tick; the request landed 300 ms later
      const res = await post({ feed: 'sunset', slot: 0, version: 'solo2' });
      const body = await res.json();
      expect(commitAdvance).toHaveBeenCalledWith('sunset', 0, expect.objectContaining({ snapshotId: 1 }),
        expect.any(Number), expect.any(Array), 'solo2', 20_000, t0, null, false);
      expect(body.current.shownSince).toBe(t0);
      expect(body.current.endsAtMs).toBe(t0 + 20_000);
      expect(body.current.endsAtMs % 4_000).toBe(0);
    });
    it('solo starts now, as before', async () => {
      const t0 = Date.UTC(2026, 8, 14, 17, 30, 0) + 1_234;
      vi.setSystemTime(new Date(t0));
      await post({ feed: 'sunset', slot: 0, version: 'solo' });
      expect(commitAdvance).toHaveBeenLastCalledWith('sunset', 0, expect.anything(), expect.any(Number),
        expect.any(Array), 'solo', expect.any(Number), t0, null, false);
    });
  });
  describe('the guard leaves slack for a clock that is not the server\'s', () => {
    // The guard is half a beat of slack, floored at a second. solo has no
    // beat, so the floor is the whole of its slack: without it a kiosk whose
    // clock runs a few ms fast would have every advance refused and the row
    // would never move at all.
    const T = 1_000_000_000_000;
    const row = (shownSince: number) => ({
      feed: 'sunrise', currentSnapshotId: 2, shownSince, slot: 4, sunsetStreak: 0, dwellMs: 20_000,
    });
    it('solo still draws for an advance landing 500 ms before the stored end', async () => {
      // The dwell ends at T + 500; 500 ms early is inside the 1 s floor.
      getScreenState.mockResolvedValue(row(T - 19_500));
      const body = await (await post({ feed: 'sunrise', slot: 5 })).json();
      expect(body.advanced).toBe(true);
      expect(commitAdvance).toHaveBeenCalled();
    });
    it('… but not for one landing 3 s before it', async () => {
      // The dwell ends at T + 3_000: this is a stale or racing tab, and
      // drawing now would cut the frame on glass short.
      getScreenState.mockResolvedValue(row(T - 17_000));
      const body = await (await post({ feed: 'sunrise', slot: 5 })).json();
      expect(body.advanced).toBe(false);
      expect(body.grown).toBe(false);
      expect(commitAdvance).not.toHaveBeenCalled();
      expect(body.current.endsAtMs).toBe(T + 3_000);
    });
  });
  describe('the rendezvous decides, guards, and keeps going (rendezvous spec §3)', () => {
    // A whole minute is a multiple of the 4 s beat, so this instant is a tick.
    const T0 = Date.UTC(2026, 8, 15, 2, 0, 0);
    const BEAT = 4_000;
    /**
     * One frame of one camera. A null quality is a non-sunset, and its
     * detection (0.1) sits under the 0.3 floor, so those frames are in the
     * pool as history but are never eligible to be drawn or ranked.
     */
    const frame = (id: number, cam: number, at: number, q: number | null) => ({
      ...entry(id, q ?? 0), webcamId: cam, capturedAt: at,
      bin: q == null ? 'non_sunset' : 'sunset', quality: q, detection: q == null ? 0.1 : 0.9,
    });
    /**
     * Camera 7's night: a climb of four, then its peak — which is also its
     * newest frame, so it is the engine's pick. It has a peak, which is all
     * participation asks for; as the only sunset camera present it ranks 1, so
     * the cap is the full runFramesSunset 8 and all five frames fit.
     */
    const night = [frame(1, 7, 100, 0.4), frame(2, 7, 200, 0.5), frame(3, 7, 300, 0.6), frame(4, 7, 400, 0.7), frame(5, 7, 500, 0.95)];
    /** Camera 9: the grey run ending on glass below. 90 and 91 have played; 92 and 93 are what a grow adds. */
    const ending = [frame(90, 9, 10, null), frame(91, 9, 20, null), frame(92, 9, 30, null), frame(93, 9, 40, null)];
    /**
     * The beat rule for camera 7: the still is
     * round(3 × (1 − 0.25 trim + 0.5 × rank 1)) = 4 beats, so n frames cost
     * 1 change + n + max(0, 4 − n) rest beats.
     */
    const dwellFor = (n: number) => (1 + n + Math.max(0, 4 - n)) * BEAT;
    const ids = (xs: number[]) => xs.map((id) => expect.objectContaining({ snapshotId: id }));
    /** The route stamps the frames it shows in place, so every test gets its own copies. */
    const pool = (...xs: ReturnType<typeof frame>[][]) => xs.flat().map((e) => ({ ...e }));
    /** The other screen's row: only its pinned landing matters here. */
    const other = (peakAtMs: number | null) => ({
      feed: 'sunrise', currentSnapshotId: null, shownSince: null, slot: 0, sunsetStreak: 0, peakAtMs, rendezvous: false,
    });
    const screens = (sunset: unknown, sunrise: unknown) =>
      getScreenState.mockImplementation(async (feed: string) => (feed === 'sunset' ? sunset : sunrise));
    const tallyOf = (body: { entries: { snapshotId: number; tally: number }[] }) =>
      Object.fromEntries(body.entries.map((e) => [e.snapshotId, e.tally]));

    beforeEach(() => {
      getLiveSettingsCached.mockResolvedValue({ namespaces: { solo2: { rendezvous: true } }, revision: 1 });
      listActiveEntries.mockResolvedValue(pool(night));
      vi.setSystemTime(new Date(T0));
      screens(null, other(null));
    });

    it('pins its own landing when the other screen has none', async () => {
      // Nothing to meet, so the window is the whole night — climb 4 + the
      // peak, inside the cap of 8 — and the peak is the 5th frame: it lands
      // at T0 + (1 change + 4 climb) × 4 s = T0 + 20 s. 5 frames ≥ the 4-beat
      // still, so the dwell is 1 + 5 + 0 = 6 beats = 24 s.
      const body = await (await post({ feed: 'sunset', slot: 0, version: 'solo2' })).json();
      expect(body.decision).toBe('pin');
      expect(body.advanced).toBe(true);
      expect(body.grown).toBe(false);
      expect(commitAdvance).toHaveBeenCalledWith('sunset', 0, expect.objectContaining({ snapshotId: 5 }), 1,
        ids([1, 2, 3, 4, 5]), 'solo2', dwellFor(5), T0, T0 + 5 * BEAT, false);
      expect(body.current.peakAtMs).toBe(T0 + 5 * BEAT);
      // A pin is not a rendezvous: nobody has met it yet.
      expect(body.current.rendezvous).toBe(false);
    });

    it('reads their landing against the tick it starts on, not the instant the request landed', async () => {
      // The request landed 300 ms before its tick, so the draw still starts at
      // T0. Their landing (T0 − 100) is ahead of the request instant but behind
      // that tick, so it is not something this draw can meet — it pins its own
      // rather than measuring a fit against a landing already gone.
      vi.setSystemTime(new Date(T0 - 300));
      screens(null, other(T0 - 100));
      const body = await (await post({ feed: 'sunset', slot: 0, version: 'solo2' })).json();
      expect(body.decision).toBe('pin');
      expect(body.current.peakAtMs).toBe(T0 + 5 * BEAT);
    });

    it('fits to the other screen\'s landing by thinning its climb', async () => {
      // Their peak is 3 beats out, so after the 1 change beat only 2 beats
      // are free before mine must land: thinClimb([1, 2, 3, 4], 2) keeps the
      // frame nearest the peak and one at the far end — 1 and 4. The run is
      // then 3 frames, one under the 4-beat still, so it rests one beat:
      // 1 + 3 + 1 = 5 beats = 20 s.
      const T = T0 + 3 * BEAT;
      screens(null, other(T));
      const body = await (await post({ feed: 'sunset', slot: 0, version: 'solo2' })).json();
      expect(body.decision).toBe('fit');
      expect(commitAdvance).toHaveBeenCalledWith('sunset', 0, expect.objectContaining({ snapshotId: 5 }), 1,
        ids([1, 4, 5]), 'solo2', dwellFor(3), T0, T, true);
      expect(body.current.peakAtMs).toBe(T);
      expect(body.current.rendezvous).toBe(true);
      // Only the frames that play are stamped shown; 2 and 3 were dropped.
      expect(tallyOf(body)).toMatchObject({ 1: 1, 2: 0, 3: 0, 4: 1, 5: 1 });
    });

    it('keeps the ending run going instead of drawing, when the fit needs more room than the climb has', async () => {
      // Their peak is 7 beats out: 7 − 1 change = 6 beats available, and the
      // climb offers only 4, so 2 more frames have to play first. The run
      // ending on this screen is camera 9's (90 and 91 played), so it grows
      // by its next two frames, 92 and 93, one beat each: 16 s + 8 s = 24 s.
      listActiveEntries.mockResolvedValue(pool(night, ending));
      screens(
        { feed: 'sunset', currentSnapshotId: 91, shownSince: T0 - 16_000, slot: 4, sunsetStreak: 0,
          dwellMs: 16_000, shownSnapshotIds: [90, 91], peakAtMs: null, rendezvous: false },
        other(T0 + 7 * BEAT),
      );
      // The dwell ends exactly now (T0 − 16_000 + 16_000), so the guard opens.
      const body = await (await post({ feed: 'sunset', slot: 5, version: 'solo2' })).json();
      expect(body.decision).toBe('grow');
      expect(body.advanced).toBe(false);
      expect(body.grown).toBe(true);
      expect(growDwell).toHaveBeenCalledWith('sunset', 4, ids([92, 93]), 16_000 + 2 * BEAT);
      expect(commitAdvance).not.toHaveBeenCalled();
      // The row is the same draw, longer: same slot, same start, a 24 s end.
      expect(body.current.endsAtMs).toBe(T0 - 16_000 + 24_000);
      expect(body.current.shownSnapshotIds).toEqual([90, 91, 92, 93]);
      expect(body.schedule.slot).toBe(4);
      expect(tallyOf(body)).toMatchObject({ 92: 1, 93: 1, 5: 0 });
    });

    it('finds the ending camera by the frame that played, not by the drawn frame', async () => {
      // The drawn frame is the camera's newest, and the cap can leave it
      // unplayed; here it has also left the pool. The run that is ending is
      // still camera 9's, and the last frame it PLAYED (91) is what says so,
      // so the grow goes ahead instead of answering "nothing to add".
      listActiveEntries.mockResolvedValue(pool(night, ending));
      screens(
        { feed: 'sunset', currentSnapshotId: 99, shownSince: T0 - 16_000, slot: 4, sunsetStreak: 0,
          dwellMs: 16_000, shownSnapshotIds: [90, 91], peakAtMs: null, rendezvous: false },
        other(T0 + 7 * BEAT),
      );
      const body = await (await post({ feed: 'sunset', slot: 5, version: 'solo2' })).json();
      expect(body.decision).toBe('grow');
      expect(growDwell).toHaveBeenCalledWith('sunset', 4, ids([92, 93]), 16_000 + 2 * BEAT);
    });

    it('a refused grow changes nothing, rather than drawing instead', async () => {
      // growDwell answers false when the row moved under us (another tab drew).
      // Drawing the pick anyway would land it on the wrong tick, so the answer
      // is the row as it stands and the kiosk comes back at its end.
      listActiveEntries.mockResolvedValue(pool(night, ending));
      screens(
        { feed: 'sunset', currentSnapshotId: 91, shownSince: T0 - 16_000, slot: 4, sunsetStreak: 0,
          dwellMs: 16_000, shownSnapshotIds: [90, 91], peakAtMs: null, rendezvous: false },
        other(T0 + 7 * BEAT),
      );
      growDwell.mockResolvedValue(false);
      const body = await (await post({ feed: 'sunset', slot: 5, version: 'solo2' })).json();
      expect(body.decision).toBe('grow');
      expect(body.advanced).toBe(false);
      expect(body.grown).toBe(false);
      expect(commitAdvance).not.toHaveBeenCalled();
      expect(body.current.endsAtMs).toBe(T0 - 16_000 + 16_000);
      expect(body.current.shownSnapshotIds).toEqual([90, 91]);
    });

    it('does not draw over, or grow, a dwell that has not ended', async () => {
      // 4 s into a 20 s dwell: the end is 16 s away, far beyond the half beat
      // of slack. A racing second tab arriving here must change nothing.
      listActiveEntries.mockResolvedValue(pool(night, ending));
      screens(
        { feed: 'sunset', currentSnapshotId: 91, shownSince: T0 - 4_000, slot: 4, sunsetStreak: 0,
          dwellMs: 20_000, shownSnapshotIds: [90, 91], peakAtMs: null, rendezvous: false },
        other(T0 + 7 * BEAT),
      );
      const body = await (await post({ feed: 'sunset', slot: 5, version: 'solo2' })).json();
      expect(body.advanced).toBe(false);
      expect(body.grown).toBe(false);
      expect(body.decision).toBeNull();
      expect(commitAdvance).not.toHaveBeenCalled();
      expect(growDwell).not.toHaveBeenCalled();
      expect(body.current.endsAtMs).toBe(T0 - 4_000 + 20_000);
      expect(body.schedule.slot).toBe(4);
    });

    it('pins nothing when the other screen\'s landing is inside my change beat', async () => {
      // Their landing is half a beat out: ahead of my start, so it is read,
      // but off the grid and inside the 1 change beat, so no number of frames
      // can reach it. The draw falls back to the full window and pins nothing
      // of its own — a landing it could not meet is not one to publish.
      screens(null, other(T0 + BEAT / 2));
      const body = await (await post({ feed: 'sunset', slot: 0, version: 'solo2' })).json();
      expect(body.decision).toBe('nofit · too soon');
      expect(commitAdvance).toHaveBeenCalledWith('sunset', 0, expect.objectContaining({ snapshotId: 5 }), 1,
        ids([1, 2, 3, 4, 5]), 'solo2', dwellFor(5), T0, null, false);
      expect(body.current.peakAtMs).toBeNull();
      expect(body.current.rendezvous).toBe(false);
    });

    it('off the dial, it is the plain draw and nothing is pinned', async () => {
      getLiveSettingsCached.mockResolvedValue({ namespaces: {}, revision: 1 });
      // Their landing is reachable; with the dial off it is simply not read.
      screens(null, other(T0 + 3 * BEAT));
      const body = await (await post({ feed: 'sunset', slot: 0, version: 'solo2' })).json();
      expect(body.decision).toBe('plain');
      expect(body.advanced).toBe(true);
      expect(body.grown).toBe(false);
      expect(commitAdvance).toHaveBeenCalledWith('sunset', 0, expect.objectContaining({ snapshotId: 5 }), 1,
        ids([1, 2, 3, 4, 5]), 'solo2', dwellFor(5), T0, null, false);
      expect(body.current.peakAtMs).toBeNull();
      expect(body.current.rendezvous).toBe(false);
      // The dial being off means the other screen's row is never read.
      expect(getScreenState).not.toHaveBeenCalledWith('sunrise');
    });
  });
});
