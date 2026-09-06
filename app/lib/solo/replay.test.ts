import { describe, it, expect } from 'vitest';
import {
  poolAt, isNewAtEntry, seedFromDraws, initialState, replay, actualStrip, summarize, compare,
  type ReplayEntry, type DrawLike,
} from './replay';
import { boundaryMs } from './schedule';
import { SOLO_VERSIONS } from './versions';
import { dialsFrom, SOLO_SETTINGS_SCHEMA } from './settingsSchema';
import { dialsFrom2, SOLO2_SETTINGS_SCHEMA } from '@/app/lib/solo2/settingsSchema';
import { schemaDefaults } from '@/app/lib/settings/schema';
import type { Feed, SoloDials } from './types';

const FEED: Feed = 'sunrise';
const D: SoloDials = { ...dialsFrom(schemaDefaults(SOLO_SETTINGS_SCHEMA)), dwellS: 20, offsetS: 10 };
const T0 = 1_000_000_000_000; // a slot boundary for dwell 20 on the sunrise grid
const at = (slot: number, d: SoloDials = D) => boundaryMs(slot, FEED, d.dwellS, d.offsetS);
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

  it('parity: reproduces project() slot for slot from an empty history', () => {
    const picks = solo.project(entries, D, { lastSnapshotId: null, sunsetStreak: 0 }, 12, SLOT0, FEED);
    const strip = replay({ feed: FEED, version: solo, dials: D, entries, priorDraws: [], fromMs: at(SLOT0), toMs: at(SLOT0 + 11) });
    expect(ids(strip)).toEqual(picks.map((p) => p.snapshotId));
    expect(strip.frames.map((f) => f.slot)).toEqual(picks.map((_, i) => SLOT0 + i));
    expect(strip.grid).toEqual({ dwellS: 20, offsetS: 10 });
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

  it('a different dwell puts frames on the new grid', () => {
    const d = { ...D, dwellS: 10 };
    const strip = replay({ feed: FEED, version: solo, dials: d, entries, priorDraws: [], fromMs: at(SLOT0), toMs: at(SLOT0 + 1) - 1 });
    expect(strip.frames).toHaveLength(2); // 20 s of glass at a 10 s dwell
    expect(strip.frames.map((f) => f.shownAt)).toEqual([at(SLOT0), at(SLOT0) + 10_000]);
    expect(strip.grid.dwellS).toBe(10);
  });

  it('solo2 marks every frame of the camera run shown, and the strip carries them', () => {
    const d2 = { ...dialsFrom2(schemaDefaults(SOLO2_SETTINGS_SCHEMA)), dwellS: 20, offsetS: 10, cameraRun: true };
    const rows = [
      sun(1, 0.9, { webcamId: 7, capturedAt: 100 }), sun(3, 0.7, { webcamId: 7, capturedAt: 300 }),
      sun(2, 0.8, { webcamId: 8, capturedAt: 150 }),
    ];
    const strip = replay({ feed: FEED, version: SOLO_VERSIONS.solo2, dials: d2, entries: rows, priorDraws: [], fromMs: at(SLOT0), toMs: at(SLOT0 + 1) });
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
  const grid = { dwellS: 20, offsetS: 10 };
  const actual = actualStrip(FEED, draws, grid, at(10), at(13));

  it('the fact strip flags repeats and keeps the grid', () => {
    expect(actual.version).toBe('actual');
    expect(actual.frames.map((f) => f.repeat)).toEqual([false, false, true, false]);
    expect(actual.frames[0].shownSnapshotIds).toEqual([1]);
  });
  it('summarize counts what the strip showed', () => {
    const s = summarize(actual);
    expect(s).toMatchObject({ draws: 4, blanks: 0, distinctFrames: 3, distinctCameras: 3, repeats: 1, nonSunsetShare: 0.25, minQuality: 0.05 });
    expect(s.meanQuality).toBeCloseTo((0.95 + 0.05 + 0.95) / 3);
    expect(s.qualityHistogram).toEqual([1, 0, 0, 0, 0, 0, 0, 0, 0, 2]);
    expect(s.perCamera[0]).toEqual({ webcamId: 1001, title: 'cam1', draws: 2 });
  });
  it('compare counts shared slots that drew the same frame, and refuses another grid', () => {
    const other = { ...actual, frames: actual.frames.map((f) => (f.slot === 11 ? { ...f, snapshotId: 1 } : f)) };
    expect(compare(actual, other)).toEqual({ slots: 4, same: 3 });
    expect(compare(actual, { ...other, grid: { dwellS: 10, offsetS: 10 } })).toBeNull();
  });
});
