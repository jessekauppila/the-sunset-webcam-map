import { describe, it, expect } from 'vitest';
import {
  poolAt, isNewAtEntry, seedFromDraws, initialState, replay, replayPair, actualStrip, summarize, compare,
  type ReplayEntry, type DrawLike,
} from './replay';
import { SOLO_VERSIONS } from './versions';
import { dialsFrom, SOLO_SETTINGS_SCHEMA } from './settingsSchema';
import { dialsFrom2, SOLO2_SETTINGS_SCHEMA } from '@/app/lib/solo2/settingsSchema';
import { schemaDefaults } from '@/app/lib/settings/schema';
import type { Feed, SoloDials } from './types';

const FEED: Feed = 'sunrise';
const D: SoloDials = { ...dialsFrom(schemaDefaults(SOLO_SETTINGS_SCHEMA)), dwellS: 20, offsetS: 10 };
const T0 = 1_000_000_000_000; // a slot boundary for dwell 20 on the sunrise grid
/** A plausible wall-clock stamp for a draw; the grid it came from is gone (spec §5). */
const at = (slot: number, d: SoloDials = D) => slot * d.dwellS * 1000;
const SLOT0 = T0 / 20_000;

function sun(id: number, q: number, extra: Partial<ReplayEntry> = {}): ReplayEntry {
  return { snapshotId: id, webcamId: 1000 + id, bin: 'sunset', quality: q, detection: 0.9,
    isNew: false, tally: 0, enteredAt: T0 - 3_600_000 + id, lastShownAt: null, removedAt: null, title: `cam${id}`, ...extra };
}
function non(id: number, det: number, extra: Partial<ReplayEntry> = {}): ReplayEntry {
  return { snapshotId: id, webcamId: 2000 + id, bin: 'non_sunset', quality: null, detection: det,
    isNew: false, tally: 0, enteredAt: T0 - 3_600_000 + id, lastShownAt: null, removedAt: null, ...extra };
}
/** Turn `project`'s picks into draw-log rows on the solo grid. */
const drawsOf = (picks: { snapshotId: number; bin: 'sunset' | 'non_sunset' }[], firstSlot: number): DrawLike[] =>
  picks.map((p, i) => ({ slot: firstSlot + i, shownAt: at(firstSlot + i), snapshotId: p.snapshotId, bin: p.bin }));
const ids = (s: { frames: { snapshotId: number | null }[] }) => s.frames.map((f) => f.snapshotId);

describe('poolAt', () => {
  it('includes a row entered at t and excludes one removed at t', () => {
    const a = sun(1, 0.9, { enteredAt: 500, removedAt: null });
    const b = sun(2, 0.9, { enteredAt: 100, removedAt: 500 });
    const c = sun(3, 0.9, { enteredAt: 600, removedAt: null });
    expect(poolAt([a, b, c], 500).map((e) => e.snapshotId)).toEqual([1]);
    expect(poolAt([a, b, c], 499).map((e) => e.snapshotId)).toEqual([2]);
  });
});

describe('isNewAtEntry', () => {
  it('is true only when an older frame of the same camera was in the bin at arrival', () => {
    const older = sun(1, 0.9, { webcamId: 7, enteredAt: 100, removedAt: null });
    const newer = sun(2, 0.9, { webcamId: 7, enteredAt: 200 });
    const gone = sun(3, 0.9, { webcamId: 8, enteredAt: 100, removedAt: 150 });
    const late = sun(4, 0.9, { webcamId: 8, enteredAt: 200 });
    expect(isNewAtEntry(newer, [older, newer])).toBe(true);
    expect(isNewAtEntry(older, [older, newer])).toBe(false);
    expect(isNewAtEntry(late, [gone, late])).toBe(false);
  });
});

describe('seedFromDraws and initialState', () => {
  it('rebuilds tally, last shown and isNew from the draws, not the rows', () => {
    const rows = [sun(1, 0.9, { tally: 99, lastShownAt: 5, webcamId: 7, enteredAt: 100 }), sun(2, 0.8, { webcamId: 7, enteredAt: 200 })];
    const draws: DrawLike[] = [
      { slot: 1, shownAt: 1000, snapshotId: 1 },
      { slot: 2, shownAt: 2000, snapshotId: 2, shownSnapshotIds: [1, 2] },
    ];
    const seeded = seedFromDraws(rows, draws);
    expect(seeded[0]).toMatchObject({ tally: 2, lastShownAt: 2000, isNew: false });
    expect(seeded[1]).toMatchObject({ tally: 1, lastShownAt: 2000, isNew: false });
    expect(rows[0].tally).toBe(99); // input untouched
    // Never drawn and arrived beside an older frame of its camera: still new.
    expect(seedFromDraws(rows, [])[1].isNew).toBe(true);
    expect(seedFromDraws(rows, [])[0].isNew).toBe(false);
  });
  it('a row shown before the log began is seeded from its own record, exactly when that record predates the window', () => {
    const start = 10_000;
    const exact = sun(1, 0.9, { tally: 5, firstShownAt: 1_000, lastShownAt: 8_000 });
    const bound = sun(2, 0.9, { tally: 5, firstShownAt: 1_000, lastShownAt: 12_000 }); // shown again inside the window: only the first showing is known to predate it
    const fresh = sun(3, 0.9, { tally: 0, firstShownAt: null, lastShownAt: null });
    const logged = sun(4, 0.9, { tally: 5, firstShownAt: 1_000, lastShownAt: 9_000 });
    const out = seedFromDraws([exact, bound, fresh, logged], [{ slot: 1, shownAt: 9_500, snapshotId: 4 }], start);
    expect(out[0]).toMatchObject({ tally: 5, lastShownAt: 8_000, isNew: false });
    expect(out[1]).toMatchObject({ tally: 5, lastShownAt: 1_000, isNew: false });
    expect(out[2]).toMatchObject({ tally: 0, lastShownAt: null });
    expect(out[3]).toMatchObject({ tally: 1, lastShownAt: 9_500 }); // the log wins over the row
    // Without a window start the rows are not consulted: everything unlogged is unshown.
    expect(seedFromDraws([exact], [])[0]).toMatchObject({ tally: 0, lastShownAt: null });
  });
  it('the screen remembers the last frame and the trailing sunset run', () => {
    const rows = [sun(1, 0.9), non(2, 0.5)];
    const draws: DrawLike[] = [
      { slot: 1, shownAt: 1, snapshotId: 2 }, // bin looked up from the rows
      { slot: 2, shownAt: 2, snapshotId: 1, bin: 'sunset' },
      { slot: 3, shownAt: 3, snapshotId: 1, bin: 'sunset' },
    ];
    expect(initialState(draws, rows)).toEqual({ lastSnapshotId: 1, sunsetStreak: 2 });
    expect(initialState([], rows)).toEqual({ lastSnapshotId: null, sunsetStreak: 0 });
  });
});

describe('replay', () => {
  const entries = [sun(1, 0.97), sun(2, 0.6), sun(3, 0.4), ...[1, 2, 3, 4, 5, 6, 7, 8].map((i) => non(100 + i, 0.6 - i * 0.02))];
  const solo = SOLO_VERSIONS.solo;

  it('parity: reproduces project() draw for draw from an empty history', () => {
    const picks = solo.project(entries, D, { lastSnapshotId: null, sunsetStreak: 0 }, 12, SLOT0, FEED);
    const strip = replay({ feed: FEED, version: solo, dials: D, entries, priorDraws: [], fromMs: at(SLOT0), toMs: at(SLOT0 + 11) });
    expect(ids(strip)).toEqual(picks.map((p) => p.snapshotId));
    // The counter starts at 0 with no prior draws: a slot is an ordinal now,
    // not a clock reading, so it no longer derives from fromMs. Rest compares
    // differences, so the picks are unchanged by the origin moving.
    expect(strip.frames.map((f) => f.slot)).toEqual(picks.map((_, i) => i));
    expect(strip.schedule).toEqual({ dwellS: 20 });
    // solo's dwell is the dial, so the clock lands exactly where the grid did.
    expect(strip.frames.map((f) => f.shownAt)).toEqual(picks.map((_, i) => at(SLOT0) + i * 20_000));
    expect(strip.frames.every((f) => f.dwellMs === 20_000)).toBe(true);
  });

  it('the counter continues the recorded sequence rather than restarting', () => {
    const picks = solo.project(entries, D, { lastSnapshotId: null, sunsetStreak: 0 }, 12, SLOT0, FEED);
    const prior = drawsOf(picks.slice(0, 5), 400);
    const strip = replay({ feed: FEED, version: solo, dials: D, entries, priorDraws: prior, fromMs: at(SLOT0 + 5), toMs: at(SLOT0 + 7) });
    expect(strip.frames.map((f) => f.slot)).toEqual([405, 406, 407]);
  });

  it('solo2 stretches the clock by each draw\u2019s own budget, not by the dial', () => {
    const d2 = { ...dialsFrom2(schemaDefaults(SOLO2_SETTINGS_SCHEMA)), dwellS: 20, offsetS: 10, cameraRun: true, dwellBoost: 0, dwellTrim: 0 };
    // One camera with eight frames: past n* the budget floor stretches the dwell.
    const many = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => sun(i, 0.9 - i * 0.01, { webcamId: 7, capturedAt: i }));
    const strip = replay({ feed: FEED, version: SOLO_VERSIONS.solo2, dials: d2, entries: many, priorDraws: [], fromMs: at(SLOT0), toMs: at(SLOT0) + 1 });
    const first = strip.frames[0];
    expect(first.dwellMs).toBe(SOLO_VERSIONS.solo2.dwellMs(many, many.find((e) => e.snapshotId === first.snapshotId)!, d2));
    // Whatever the budget says, the strip's clock advanced by exactly it.
    expect(first.dwellMs).toBeGreaterThanOrEqual(20_000);
  });

  it('solo2 starts its clock on the nearest tick; solo starts where it is asked', () => {
    const d2 = { ...dialsFrom2(schemaDefaults(SOLO2_SETTINGS_SCHEMA)), dwellS: 20, offsetS: 10, cameraRun: true, dwellBoost: 0, dwellTrim: 0 };
    // 1.3 s past a tick: the dwell belongs to the tick the kiosk fired on, and
    // every landing is measured in whole beats from there (beat spec §2.6).
    const off = at(SLOT0) + 1_300;
    const many = [1, 2, 3].map((i) => sun(i, 0.9 - i * 0.01, { webcamId: 7, capturedAt: i }));
    const beat2 = replay({ feed: FEED, version: SOLO_VERSIONS.solo2, dials: d2, entries: many, priorDraws: [], fromMs: off, toMs: off });
    expect(beat2.frames[0].shownAt).toBe(at(SLOT0)); // the nearest tick, 1.3 s back
    expect(beat2.frames[0].shownAt % (d2.beatS * 1000)).toBe(0);
    expect(beat2.fromMs).toBe(off); // the window asked for is still the window reported
    // solo has no beat, so its clock starts exactly where the caller put it.
    const flat = replay({ feed: FEED, version: solo, dials: D, entries, priorDraws: [], fromMs: off, toMs: off });
    expect(flat.frames[0].shownAt).toBe(off);
  });

  it('parity: seeded from the first five draws, reproduces draws six to twelve', () => {
    const picks = solo.project(entries, D, { lastSnapshotId: null, sunsetStreak: 0 }, 12, SLOT0, FEED);
    const prior = drawsOf(picks.slice(0, 5), SLOT0);
    const strip = replay({ feed: FEED, version: solo, dials: D, entries, priorDraws: prior, fromMs: at(SLOT0 + 5), toMs: at(SLOT0 + 11) });
    expect(ids(strip)).toEqual(picks.slice(5).map((p) => p.snapshotId));
  });

  it('a frame is only drawn while it is in the bin', () => {
    const rows = [sun(1, 0.97, { removedAt: at(SLOT0 + 2) }), sun(2, 0.6), sun(3, 0.4, { enteredAt: at(SLOT0 + 3) })];
    const strip = replay({ feed: FEED, version: solo, dials: { ...D, rest: 0 }, entries: rows, priorDraws: [], fromMs: at(SLOT0), toMs: at(SLOT0 + 4) });
    // Slot 0: best (1). Slot 1: not 1 (on glass), so 2. Slot 2: 1 has left, 3 has not arrived, 2 is on glass and the only one: it repeats.
    // Slot 3: 3 arrives, never shown, wins. Slot 4: 2 (longest since shown).
    expect(ids(strip)).toEqual([1, 2, 2, 3, 2]);
    expect(strip.frames.map((f) => f.repeat)).toEqual([false, false, true, false, true]);
  });

  it('a higher rating floor changes the picks; a blank when nothing is eligible', () => {
    const rows = [sun(1, 0.3), sun(2, 0.2)];
    const low = replay({ feed: FEED, version: solo, dials: D, entries: rows, priorDraws: [], fromMs: at(SLOT0), toMs: at(SLOT0 + 1) });
    expect(ids(low)).toEqual([1, 2]);
    const high = replay({ feed: FEED, version: solo, dials: { ...D, ratingFloor: 3 }, entries: rows, priorDraws: [], fromMs: at(SLOT0), toMs: at(SLOT0 + 1) });
    expect(ids(high)).toEqual([null, null]);
    expect(summarize(high)).toMatchObject({ draws: 0, blanks: 2 });
  });

  it('a different dwell walks the clock at the new rate', () => {
    const d = { ...D, dwellS: 10 };
    const strip = replay({ feed: FEED, version: solo, dials: d, entries, priorDraws: [], fromMs: at(SLOT0), toMs: at(SLOT0) + 19_999 });
    expect(strip.frames).toHaveLength(2); // 20 s of glass at a 10 s dwell
    expect(strip.frames.map((f) => f.shownAt)).toEqual([at(SLOT0), at(SLOT0) + 10_000]);
    expect(strip.schedule.dwellS).toBe(10);
    expect(strip.frames.every((f) => f.dwellMs === 10_000)).toBe(true);
  });

  it('solo2 marks every frame of the camera run shown, and the strip carries them', () => {
    const d2 = { ...dialsFrom2(schemaDefaults(SOLO2_SETTINGS_SCHEMA)), dwellS: 20, offsetS: 10, cameraRun: true, dwellBoost: 0, dwellTrim: 0 };
    const rows = [
      sun(1, 0.9, { webcamId: 7, capturedAt: 100 }), sun(3, 0.7, { webcamId: 7, capturedAt: 300 }),
      sun(2, 0.8, { webcamId: 8, capturedAt: 150 }),
    ];
    // A solo2 dwell is the 20 s budget plus the camera change's two segments —
    // a 1.5 s rise in front and a 0.75 s burn behind (dwell-budget spec §3.3)
    // — so the window reaches past one of them.
    const strip = replay({ feed: FEED, version: SOLO_VERSIONS.solo2, dials: d2, entries: rows, priorDraws: [], fromMs: at(SLOT0), toMs: at(SLOT0) + 22_250 });
    expect(strip.frames[0]).toMatchObject({ snapshotId: 3, shownSnapshotIds: [1, 3] });
    expect(strip.frames[1].snapshotId).toBe(2);
  });
});

describe('actualStrip, summarize, compare', () => {
  const rows = [sun(1, 0.95), sun(2, 0.05), non(103, 0.5)];
  const draws = [
    { ...rows[0], slot: 10, shownAt: at(10) },
    { ...rows[1], slot: 11, shownAt: at(11) },
    { ...rows[0], slot: 12, shownAt: at(12) },
    { ...rows[2], slot: 13, shownAt: at(13) },
  ];
  const schedule = { dwellS: 20 };
  const actual = actualStrip(FEED, draws, schedule, at(10), at(13));

  it('the fact strip flags repeats, keeps its schedule, and MEASURES each block', () => {
    expect(actual.version).toBe('actual');
    expect(actual.frames.map((f) => f.repeat)).toEqual([false, false, true, false]);
    expect(actual.frames[0].shownSnapshotIds).toEqual([1]);
    expect(actual.schedule).toEqual({ dwellS: 20 });
    // Measured from the next draw, never computed from a dwell rule. The last
    // block has nothing after it, so its length is null rather than a guess.
    expect(actual.frames.map((f) => f.dwellMs)).toEqual([20_000, 20_000, 20_000, null]);
  });
  it('summarize counts what the strip showed', () => {
    const s = summarize(actual);
    expect(s).toMatchObject({ draws: 4, blanks: 0, distinctFrames: 3, distinctCameras: 3, repeats: 1, nonSunsetShare: 0.25, minQuality: 0.05 });
    expect(s.meanQuality).toBeCloseTo((0.95 + 0.05 + 0.95) / 3);
    expect(s.qualityHistogram).toEqual([1, 0, 0, 0, 0, 0, 0, 0, 0, 2]);
    expect(s.perCamera[0]).toEqual({ webcamId: 1001, title: 'cam1', draws: 2 });
  });
  it('compare counts shared draws that drew the same frame, and refuses another screen', () => {
    const other = { ...actual, frames: actual.frames.map((f) => (f.slot === 11 ? { ...f, snapshotId: 1 } : f)) };
    expect(compare(actual, other)).toEqual({ slots: 4, same: 3, inOrder: 3 });
    // A differing dwell no longer refuses: a slot is an ordinal, so the nth
    // draw of one strip is comparable with the nth of the other.
    expect(compare(actual, { ...other, schedule: { dwellS: 10 } })).toEqual({ slots: 4, same: 3, inOrder: 3 });
    // Two screens keep independent counters, so their slots mean nothing to each other.
    expect(compare(actual, { ...other, feed: 'sunset' as const })).toBeNull();
    // The glass missed slot 11: every later draw sits one slot early. Slot-for-slot says 1; the order says 3 of 4 survive.
    const shifted = { ...actual, frames: [actual.frames[0], { ...actual.frames[2], slot: 11 }, { ...actual.frames[3], slot: 12 }] };
    expect(compare(actual, shifted)).toEqual({ slots: 3, same: 1, inOrder: 3 });
  });
});

describe('replayPair (rendezvous spec §5)', () => {
  // The defaults the beat runs on: beat 4 s, dwell floor 3 beats, one change
  // beat, sunset cap 8, rank shaping. The spread is off, so every draw's
  // budget is the floor and a lone frame is 4 beats (1 change + 1 + 2 rest).
  const D2 = { ...dialsFrom2(schemaDefaults(SOLO2_SETTINGS_SCHEMA)), rendezvous: true, dwellBoost: 0, dwellTrim: 0 };
  const beat = (n: number) => n * 4_000;
  /** One frame of a camera's night. A null quality is a non-sunset. */
  const shot = (id: number, cam: number, capturedAt: number, quality: number | null, enteredAt = T0 - 60_000): ReplayEntry => ({
    snapshotId: id, webcamId: cam, bin: quality == null ? 'non_sunset' : 'sunset', quality, detection: 0.8,
    isNew: false, tally: 0, enteredAt, lastShownAt: null, removedAt: null, capturedAt, title: `cam${cam}`,
  });
  const opts = (feed: Feed, entries: ReplayEntry[], fromMs: number, toMs: number, dials = D2) =>
    ({ feed, version: SOLO_VERSIONS.solo2, dials, entries, priorDraws: [] as DrawLike[], fromMs, toMs });

  it('the sunset screen pins and the sunrise screen fits to its landing', () => {
    // sunset, t0 = T0 (a tick): camera 7 is [s1 s2 s3 s4 | s5 peak | s6]. A
    // lone sunset ranks 1, so the cap is 8 and the whole night plays: the
    // peak is frames[4] and lands at T0 + (1 change + 4) beats = T0 + 20 s.
    const sunsetNight = [
      shot(1, 7, 100, 0.3), shot(2, 7, 200, 0.4), shot(3, 7, 300, 0.5),
      shot(4, 7, 400, 0.6), shot(5, 7, 500, 0.9), shot(6, 7, 600, 0.5),
    ];
    // sunrise, t0 = T0 + 4 s: camera 17 is [r1..r5 | r6 peak | r7].
    // avail = (20 − 4)/4 − 1 change = 3 beats of climb, and the climb is 5
    // long, so 3 ≤ 5 fits: thinClimb(5, 3) keeps r1, r3, r5 and drops r2, r4.
    // The peak is frames[3] and lands at T0 + 4 + (1 + 3)×4 = T0 + 20 s.
    const sunriseNight = [
      shot(11, 17, 100, 0.2), shot(12, 17, 200, 0.3), shot(13, 17, 300, 0.4), shot(14, 17, 400, 0.5),
      shot(15, 17, 500, 0.6), shot(16, 17, 600, 0.95), shot(17, 17, 700, 0.7),
    ];
    const pair = replayPair({
      sunrise: opts('sunrise', sunriseNight, T0 + beat(1), T0 + beat(1)),
      sunset: opts('sunset', sunsetNight, T0, T0 + beat(1)),
    });
    expect(pair.rendezvous).toEqual({
      made: 1, missed: 0, dropped: 2, grown: 0,
      landings: [{ atMs: T0 + beat(5), sunriseSlot: 0, sunsetSlot: 0 }],
    });
    expect(pair.sunset.frames).toHaveLength(1);
    expect(pair.sunset.frames[0]).toMatchObject({
      snapshotId: 6, shownSnapshotIds: [1, 2, 3, 4, 5, 6], peakAtMs: T0 + beat(5), rendezvous: false,
      dropped: 0, grown: 0, dwellMs: beat(7), // 1 change + 6 frames + 0 rest
    });
    expect(pair.sunrise.frames).toHaveLength(1);
    expect(pair.sunrise.frames[0]).toMatchObject({
      snapshotId: 17, shownSnapshotIds: [11, 13, 15, 16, 17], peakAtMs: T0 + beat(5), rendezvous: true,
      dropped: 2, grown: 0, shownAt: T0 + beat(1), dwellMs: beat(6), // 1 change + 5 frames + 0 rest
    });
    // The landing is one instant, and both screens name it.
    expect(pair.sunrise.frames[0].peakAtMs).toBe(pair.sunset.frames[0].peakAtMs);
  });

  it('a climb too short to reach grows the dwell that is ending, and the next draw fits', () => {
    // sunrise draw 0, t0 = T0: only camera 9 is in the bin (three grey
    // frames), so the run is the non-sunset cap of 3 and the block is
    // 1 + 3 + 0 = 4 beats = 16 s. No peak, so nothing pins.
    const grey = [shot(21, 9, 100, null), shot(22, 9, 200, null), shot(23, 9, 300, null)];
    // Two more frames of camera 9, and camera 19's night, arrive during it.
    const later = T0 + beat(2);
    const arrivals = [shot(24, 9, 400, null, later), shot(25, 9, 500, null, later)];
    const sunriseNight = [
      shot(31, 19, 100, 0.4, later), shot(32, 19, 200, 0.95, later),
      shot(33, 19, 300, 0.5, later), shot(34, 19, 400, 0.45, later),
    ];
    // sunset draw 0, t0 = T0 + 4 s: camera 8 is six climb frames then its
    // peak, so the whole run is 7 frames and the peak is last: it pins
    // T0 + 4 + (1 + 6)×4 = T0 + 32 s, and its block runs 8 beats.
    const sunsetNight = [
      shot(41, 8, 100, 0.3), shot(42, 8, 200, 0.35), shot(43, 8, 300, 0.4),
      shot(44, 8, 400, 0.45), shot(45, 8, 500, 0.5), shot(46, 8, 600, 0.55), shot(47, 8, 700, 0.9),
    ];
    const pair = replayPair({
      sunrise: opts('sunrise', [...grey, ...arrivals, ...sunriseNight], T0, T0 + beat(6)),
      sunset: opts('sunset', sunsetNight, T0 + beat(1), T0 + beat(6)),
    });
    // At T0 + 16 s the sunrise screen wants camera 19, whose peak is one
    // frame in, but the landing is 3 beats of climb away: avail
    // (32 − 16)/4 − 1 = 3 against a climb of 1, so it needs 2 more beats
    // before it starts. Camera 9's night has exactly two frames left, so the
    // block that is ending plays them: +2 ids, +8 s, and the clock moves to
    // T0 + 24 s. There avail = (32 − 24)/4 − 1 = 1 = the climb, and it fits.
    expect(pair.rendezvous).toEqual({
      made: 1, missed: 0, dropped: 0, grown: 2,
      landings: [{ atMs: T0 + beat(8), sunriseSlot: 1, sunsetSlot: 0 }],
    });
    expect(pair.sunrise.frames).toHaveLength(2);
    expect(pair.sunrise.frames[0]).toMatchObject({
      slot: 0, snapshotId: 23, shownSnapshotIds: [21, 22, 23, 24, 25],
      dwellMs: beat(4) + beat(2), grown: 2, rendezvous: false, peakAtMs: null,
    });
    expect(pair.sunrise.frames[1]).toMatchObject({
      slot: 1, shownAt: T0 + beat(6), snapshotId: 34, shownSnapshotIds: [31, 32, 33, 34],
      peakAtMs: T0 + beat(8), rendezvous: true, dropped: 0, grown: 0,
    });
    expect(pair.sunset.frames[0]).toMatchObject({ snapshotId: 47, peakAtMs: T0 + beat(8), rendezvous: false });
  });

  it('off the dial: no counts, and each strip is exactly its own single-feed replay', () => {
    const off = { ...D2, rendezvous: false };
    const sunriseNight = [shot(51, 27, 100, 0.4), shot(52, 27, 200, 0.95), shot(53, 27, 300, 0.5)];
    const sunsetNight = [shot(61, 28, 100, 0.3), shot(62, 28, 200, 0.9)];
    // Off-tick starts on purpose: both paths snap to the same grid, so the
    // equality holds for a window that begins wherever the caller says.
    const a = () => opts('sunrise', sunriseNight, T0 + 1_300, T0 + beat(12), off);
    const b = () => opts('sunset', sunsetNight, T0 + beat(1) + 1_300, T0 + beat(12), off);
    const pair = replayPair({ sunrise: a(), sunset: b() });
    expect(pair.rendezvous).toEqual({ made: 0, missed: 0, dropped: 0, grown: 0, landings: [] });
    expect(pair.sunrise).toEqual(replay(a()));
    expect(pair.sunset).toEqual(replay(b()));
    expect(pair.sunrise.frames.every((f) => f.peakAtMs === null && !f.rendezvous)).toBe(true);
  });
});
