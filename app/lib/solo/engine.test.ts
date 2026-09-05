import { describe, it, expect } from 'vitest';
import { next, project, isEligible, isResting, choosePool, afterShowing } from './engine';
import { boundaryMs } from './schedule';
import type { BinEntry, SoloDials, ScreenState, Feed } from './types';
import { dialsFrom, SOLO_SETTINGS_SCHEMA } from './settingsSchema';
import { schemaDefaults } from '@/app/lib/settings/schema';

const D: SoloDials = {
  ...dialsFrom(schemaDefaults(SOLO_SETTINGS_SCHEMA)),
  qualityFloor: 0.55, detectionFloor: 0.3, sunsetFloor: 6, mix: 2,
  rest: 4, promoteNew: true, zoneGrace: 2,
  dwellS: 20, offsetS: 10, fadeS: 0,
  showPlace: true, showScores: false, showRank: false, showTally: false,
};
const S0: ScreenState = { lastSnapshotId: null, sunsetStreak: 0 };
const FEED: Feed = 'sunrise';

function sun(id: number, q: number, extra: Partial<BinEntry> = {}): BinEntry {
  return { snapshotId: id, webcamId: 1000 + id, bin: 'sunset', quality: q, detection: 0.9,
    isNew: false, tally: 0, enteredAt: id, lastShownAt: null, ...extra };
}
function non(id: number, det: number, extra: Partial<BinEntry> = {}): BinEntry {
  return { snapshotId: id, webcamId: 2000 + id, bin: 'non_sunset', quality: null, detection: det,
    isNew: false, tally: 0, enteredAt: id, lastShownAt: null, ...extra };
}
/** N1..N8 with descending detection so their order is deterministic. */
const eightNon = () => [1, 2, 3, 4, 5, 6, 7, 8].map((i) => non(100 + i, 0.6 - i * 0.02));
/** S1..S5 by descending quality. */
const fiveSun = () => [1, 2, 3, 4, 5].map((i) => sun(i, 0.95 - i * 0.02));
const nx = (entries: BinEntry[], d: SoloDials = D, s: ScreenState = S0, slot = 0) => next(entries, d, s, slot, FEED);
const seq = (entries: BinEntry[], d: SoloDials, n = 12) =>
  project(entries, d, S0, n, 0, FEED).map((e) => (e.bin === 'sunset' ? `S${e.snapshotId}` : `N${e.snapshotId - 100}`));
const bins = (entries: BinEntry[], d: SoloDials, n: number) => project(entries, d, S0, n, 0, FEED).map((e) => e.bin);
/** A frame that went on glass at `slot`. */
const shownAt = (slot: number) => ({ tally: 1, lastShownAt: boundaryMs(slot, FEED, D.dwellS, D.offsetS) });

describe('spec §4 worked cases (floor 6, mix 2, rest 4)', () => {
  it('one sunset, eight non-sunsets: the sunset returns every fifth draw', () => {
    expect(seq([sun(1, 0.97), ...eightNon()], D)).toEqual(
      ['S1', 'N1', 'N2', 'N3', 'N4', 'S1', 'N5', 'N6', 'N7', 'N8', 'S1', 'N1']);
  });
  it('rest 0: the sunset alternates with the non-sunsets (rule 4 is the only spacing)', () => {
    expect(seq([sun(1, 0.97), ...eightNon()], { ...D, rest: 0 })).toEqual(
      ['S1', 'N1', 'S1', 'N2', 'S1', 'N3', 'S1', 'N4', 'S1', 'N5', 'S1', 'N6']);
  });
  it('five sunsets, eight non-sunsets: two sunsets per non-sunset, least shown first', () => {
    expect(seq([...fiveSun(), ...eightNon()], D)).toEqual(
      ['S1', 'S2', 'N1', 'S3', 'S4', 'N2', 'S5', 'S1', 'N3', 'S2', 'S3', 'N4']);
  });
  it('two sunsets, eight non-sunsets: both sunsets, then non-sunsets while they rest', () => {
    expect(seq([sun(1, 0.9), sun(2, 0.8), ...eightNon()], D)).toEqual(
      ['S1', 'S2', 'N1', 'N2', 'N3', 'S1', 'S2', 'N4', 'N5', 'N6', 'S1', 'S2']);
  });
  it('the bin size of the non-sunsets does not change the sunset share', () => {
    const many = Array.from({ length: 35 }, (_, i) => non(200 + i, 0.6 - i * 0.005));
    const out = bins([...fiveSun(), ...many], D, 30);
    expect(out.filter((b) => b === 'sunset').length).toBe(20);
  });
});

describe('rule 1: choose the bin', () => {
  it('sunsets only while at least sunsetFloor sunsets are rested', () => {
    const eight = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => sun(i, 0.9 - i * 0.01));
    // 8, 7, 6 rested → S S S; then 5 < 6 with a streak of 3 → N; S1 is back at slot 5, so 5 rested → mix → S S N.
    expect(bins([...eight, ...eightNon()], D, 7)).toEqual([
      'sunset', 'sunset', 'sunset', 'non_sunset', 'sunset', 'sunset', 'non_sunset']);
  });
  it('twenty sunsets: a rich night is sunsets only', () => {
    const twenty = Array.from({ length: 20 }, (_, i) => sun(i + 1, 0.99 - i * 0.02));
    expect(new Set(bins([...twenty, ...eightNon()], D, 12))).toEqual(new Set(['sunset']));
  });
  it('sunsetFloor 0: sunsets whenever any sunset is rested', () => {
    expect(bins([...fiveSun(), ...eightNon()], { ...D, sunsetFloor: 0 }, 12).every((b) => b === 'sunset')).toBe(true);
    expect(seq([sun(1, 0.9), sun(2, 0.8), ...eightNon()], { ...D, sunsetFloor: 0 })).toEqual(
      ['S1', 'S2', 'N1', 'N2', 'N3', 'S1', 'S2', 'N4', 'N5', 'N6', 'S1', 'S2']);
  });
  it('mix 1 alternates the bins below the floor', () => {
    expect(bins([...fiveSun(), ...eightNon()], { ...D, mix: 1 }, 4)).toEqual(
      ['sunset', 'non_sunset', 'sunset', 'non_sunset']);
  });
  it('detection floor 1.0 is the way to never show a non-sunset', () => {
    expect(bins([sun(1, 0.9), sun(2, 0.8), ...eightNon()], { ...D, detectionFloor: 1 }, 6))
      .toEqual(['sunset', 'sunset', 'sunset', 'sunset', 'sunset', 'sunset']);
  });
  it('an empty sunset bin draws non-sunsets', () => {
    expect(nx(eightNon())?.snapshotId).toBe(101);
  });
  it('the streak counts against the pool: after mix sunsets, a non-sunset', () => {
    const entries = [...fiveSun(), ...eightNon()];
    expect(choosePool(entries, D, { lastSnapshotId: 2, sunsetStreak: 2 }, 2, FEED).every((e) => e.bin === 'non_sunset')).toBe(true);
    expect(choosePool(entries, D, { lastSnapshotId: 1, sunsetStreak: 1 }, 1, FEED).every((e) => e.bin === 'sunset')).toBe(true);
  });
});

describe('rule 2: rest', () => {
  it('a frame shown at slot 0 rests through slot 4 and is back at slot 5', () => {
    const e = sun(1, 0.9, shownAt(0));
    expect([1, 2, 3, 4].map((slot) => isResting(e, D, slot, FEED))).toEqual([true, true, true, true]);
    expect(isResting(e, D, 5, FEED)).toBe(false);
  });
  it('a frame never shown is never resting; rest 0 rests only in its own slot', () => {
    expect(isResting(sun(1, 0.9), D, 3, FEED)).toBe(false);
    expect(isResting(sun(1, 0.9, { lastShownAt: undefined }), D, 3, FEED)).toBe(false);
    const e = sun(1, 0.9, shownAt(2));
    expect(isResting(e, { ...D, rest: 0 }, 2, FEED)).toBe(true);
    expect(isResting(e, { ...D, rest: 0 }, 3, FEED)).toBe(false);
  });
  it('non-sunsets rest too', () => {
    // 101 is the best but rested, 102 is on glass, so 103 draws.
    const entries = [non(101, 0.6, shownAt(0)), non(102, 0.5, shownAt(1)), non(103, 0.4)];
    expect(nx(entries, D, { lastSnapshotId: 102, sunsetStreak: 0 }, 2)?.snapshotId).toBe(103);
  });
  it('when every eligible frame is resting, rest is waived and rule 4 alone applies', () => {
    expect(seq([sun(1, 0.9), sun(2, 0.8)], D, 4)).toEqual(['S1', 'S2', 'S1', 'S2']);
  });
  it('rest is measured in slots of the current dwell', () => {
    const e = sun(1, 0.9, { tally: 1, lastShownAt: boundaryMs(0, FEED, 60, D.offsetS) });
    // Shown at t=0 with a 60 s dwell: slot 3 of a 60 s dwell is 180 s later, still resting; slot 5 is not.
    expect(isResting(e, { ...D, dwellS: 60 }, 3, FEED)).toBe(true);
    expect(isResting(e, { ...D, dwellS: 60 }, 5, FEED)).toBe(false);
  });
});

describe('rule 3: within a bin', () => {
  it('least shown first', () => {
    expect(nx([sun(1, 0.9, { tally: 1 }), sun(2, 0.6)])?.snapshotId).toBe(2);
    expect(nx([non(1, 0.5, { tally: 2 }), non(2, 0.4, { tally: 1 })])?.snapshotId).toBe(2);
  });
  it('then sunsets by quality, non-sunsets by detection', () => {
    expect(nx([sun(1, 0.7), sun(2, 0.9)])?.snapshotId).toBe(2);
    expect(nx([non(1, 0.4), non(2, 0.5)])?.snapshotId).toBe(2);
  });
  it('promoteNew adds 0.10 and only while isNew', () => {
    const entries = [sun(1, 0.9), sun(2, 0.85, { isNew: true })];
    expect(nx(entries)?.snapshotId).toBe(2);
    expect(nx(entries, { ...D, promoteNew: false })?.snapshotId).toBe(1);
    const [first, second] = project(entries, D, S0, 2, 0, FEED);
    expect(first.snapshotId).toBe(2);
    expect(second.snapshotId).toBe(1);
  });
  it('remaining ties break by earlier enteredAt', () => {
    expect(nx([sun(1, 0.9, { enteredAt: 9 }), sun(2, 0.9, { enteredAt: 3 })])?.snapshotId).toBe(2);
  });
});

describe('rule 4: never twice in a row', () => {
  it('skips the frame on glass', () => {
    expect(nx([sun(1, 0.9), sun(2, 0.6)], D, { lastSnapshotId: 1, sunsetStreak: 1 })?.snapshotId).toBe(2);
  });
  it('repeats when it is the only eligible frame', () => {
    expect(nx([sun(1, 0.9)], D, { lastSnapshotId: 1, sunsetStreak: 1 })?.snapshotId).toBe(1);
  });
});

describe('rule 5: floors', () => {
  it('a sunset below qualityFloor is ineligible; a non-sunset below detectionFloor is ineligible', () => {
    expect(isEligible(sun(1, 0.5), D)).toBe(false);
    expect(isEligible(sun(1, 0.55), D)).toBe(true);
    expect(isEligible(non(1, 0.29), D)).toBe(false);
    expect(isEligible(non(1, 0.3), D)).toBe(true);
  });
  it('returns null when nothing is eligible', () => {
    expect(nx([sun(1, 0.1), non(2, 0.1)])).toBeNull();
  });
});

describe('state and projection', () => {
  it('afterShowing tracks the streak and the frame on glass', () => {
    expect(afterShowing(sun(1, 0.9), S0)).toEqual({ lastSnapshotId: 1, sunsetStreak: 1 });
    expect(afterShowing(non(2, 0.5), { lastSnapshotId: 1, sunsetStreak: 2 })).toEqual({ lastSnapshotId: 2, sunsetStreak: 0 });
  });
  it('project does not mutate its inputs', () => {
    const entries = [sun(1, 0.9), non(2, 0.5)];
    project(entries, D, S0, 5, 0, FEED);
    expect(entries[0].tally).toBe(0);
    expect(entries[0].lastShownAt).toBeNull();
  });
  it('project honours the live lastShownAt of the entries it starts from', () => {
    // S1 went on glass at slot 3; projecting from slot 4 it must rest until slot 8.
    const entries = [sun(1, 0.9, shownAt(3)), sun(2, 0.8), ...eightNon()];
    const out = project(entries, D, { lastSnapshotId: 1, sunsetStreak: 1 }, 5, 4, FEED)
      .map((e) => (e.bin === 'sunset' ? `S${e.snapshotId}` : 'N'));
    expect(out).toEqual(['S2', 'N', 'N', 'N', 'S1']);
  });
});
