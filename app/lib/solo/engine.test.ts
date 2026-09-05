import { describe, it, expect } from 'vitest';
import { next, project, isEligible, tierOf, afterShowing } from './engine';
import type { BinEntry, SoloDials, ScreenState } from './types';

const D: SoloDials = {
  qualityFloor: 0.55, detectionFloor: 0.3, sunsetFloor: 6, mix: 2,
  repeatAllowance: 1, promoteNew: true, zoneGrace: 2,
  dwellS: 20, offsetS: 10, fadeS: 0,
  showPlace: true, showScores: false, showRank: false, showTally: false,
};
const S0: ScreenState = { lastSnapshotId: null, sunsetStreak: 0 };

function sun(id: number, q: number, extra: Partial<BinEntry> = {}): BinEntry {
  return { snapshotId: id, webcamId: 1000 + id, bin: 'sunset', quality: q, detection: 0.9,
    isNew: false, tally: 0, enteredAt: id, ...extra };
}
function non(id: number, det: number, extra: Partial<BinEntry> = {}): BinEntry {
  return { snapshotId: id, webcamId: 2000 + id, bin: 'non_sunset', quality: null, detection: det,
    isNew: false, tally: 0, enteredAt: id, ...extra };
}
/** N1..N8 with descending detection so their order is deterministic. */
const eightNon = () => [1, 2, 3, 4, 5, 6, 7, 8].map((i) => non(100 + i, 0.6 - i * 0.02));
const seq = (entries: BinEntry[], d: SoloDials, n = 12) =>
  project(entries, d, S0, n).map((e) => (e.bin === 'sunset' ? 'S' : `N${e.snapshotId - 100}`));

describe('thin night: one sunset, eight non-sunsets (spec §4 worked case)', () => {
  it('allowance 1 (default): S N1 S N2 … N8 S N1', () => {
    expect(seq([sun(1, 0.97), ...eightNon()], D)).toEqual(
      ['S', 'N1', 'S', 'N2', 'N3', 'N4', 'N5', 'N6', 'N7', 'N8', 'S', 'N1']);
  });
  it('allowance 0: strict variety, sunset every 9th slot', () => {
    expect(seq([sun(1, 0.97), ...eightNon()], { ...D, repeatAllowance: 0 })).toEqual(
      ['S', 'N1', 'N2', 'N3', 'N4', 'N5', 'N6', 'N7', 'N8', 'S', 'N1', 'N2']);
  });
  it('allowance 2: alternates, then variety', () => {
    expect(seq([sun(1, 0.97), ...eightNon()], { ...D, repeatAllowance: 2 })).toEqual(
      ['S', 'N1', 'S', 'N2', 'S', 'N3', 'N4', 'N5', 'N6', 'N7', 'N8', 'S']);
  });
});

describe('rule 2: sunset floor and mix', () => {
  it('sunsets only while the tier holds at least sunsetFloor sunsets', () => {
    const sunsets = [1, 2, 3, 4, 5, 6, 7].map((i) => sun(i, 0.9 - i * 0.01));
    // allowance 0 so shown sunsets leave tier 0: 7 ≥ 6 → S, 6 ≥ 6 → S, 5 < 6 → mix (streak 2) → N.
    const out = project([...sunsets, ...eightNon()], { ...D, repeatAllowance: 0 }, S0, 3).map((e) => e.bin);
    expect(out).toEqual(['sunset', 'sunset', 'non_sunset']);
  });
  it('below the floor, mix=2 gives two sunsets then a non-sunset', () => {
    const entries = [sun(1, 0.9), sun(2, 0.8), sun(3, 0.7), ...eightNon()];
    const out = project(entries, D, S0, 4).map((e) => e.bin);
    expect(out).toEqual(['sunset', 'sunset', 'non_sunset', 'sunset']);
  });
  it('sunsetFloor 0: sunsets only within the tier; rule 1 still lets unshown non-sunsets in once the allowance is spent', () => {
    const entries = [sun(1, 0.9), sun(2, 0.8), ...eightNon()];
    const out = project(entries, { ...D, sunsetFloor: 0 }, S0, 6).map((e) => e.bin);
    expect(out).toEqual(['sunset', 'sunset', 'sunset', 'sunset', 'non_sunset', 'non_sunset']);
  });
  it('detection floor 1.0 is the way to never show a non-sunset', () => {
    const entries = [sun(1, 0.9), sun(2, 0.8), ...eightNon()];
    const out = project(entries, { ...D, detectionFloor: 1 }, S0, 6).map((e) => e.bin);
    expect(out).toEqual(['sunset', 'sunset', 'sunset', 'sunset', 'sunset', 'sunset']);
  });
  it('an empty sunset bin draws non-sunsets', () => {
    expect(next(eightNon(), D, S0)?.snapshotId).toBe(101);
  });
});

describe('rule 3: within a bin', () => {
  it('sunsets by quality, non-sunsets by detection', () => {
    expect(next([sun(1, 0.7), sun(2, 0.9)], D, S0)?.snapshotId).toBe(2);
    expect(next([non(1, 0.4), non(2, 0.5)], D, S0)?.snapshotId).toBe(2);
  });
  it('promoteNew adds 0.10 and only while isNew', () => {
    const entries = [sun(1, 0.9), sun(2, 0.85, { isNew: true })];
    expect(next(entries, D, S0)?.snapshotId).toBe(2);
    expect(next(entries, { ...D, promoteNew: false }, S0)?.snapshotId).toBe(1);
    const [first, second] = project(entries, D, S0, 2);
    expect(first.snapshotId).toBe(2);
    expect(second.snapshotId).toBe(1);
  });
  it('ties break by lower tally, then earlier enteredAt', () => {
    expect(next([sun(1, 0.9, { tally: 1 }), sun(2, 0.9, { tally: 0, enteredAt: 5 })], { ...D, repeatAllowance: 5 }, S0)?.snapshotId).toBe(2);
    expect(next([sun(1, 0.9, { enteredAt: 9 }), sun(2, 0.9, { enteredAt: 3 })], D, S0)?.snapshotId).toBe(2);
  });
});

describe('rule 4: never twice in a row', () => {
  it('skips the frame on glass', () => {
    expect(next([sun(1, 0.9), sun(2, 0.6)], D, { lastSnapshotId: 1, sunsetStreak: 1 })?.snapshotId).toBe(2);
  });
  it('repeats when it is the only eligible frame', () => {
    expect(next([sun(1, 0.9)], D, { lastSnapshotId: 1, sunsetStreak: 1 })?.snapshotId).toBe(1);
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
    expect(next([sun(1, 0.1), non(2, 0.1)], D, S0)).toBeNull();
  });
});

describe('tiers and state', () => {
  it('tierOf subtracts the allowance for sunsets only, floored at 0', () => {
    expect(tierOf(sun(1, 0.9, { tally: 0 }), D)).toBe(0);
    expect(tierOf(sun(1, 0.9, { tally: 3 }), D)).toBe(2);
    expect(tierOf(non(1, 0.5, { tally: 3 }), D)).toBe(3);
  });
  it('afterShowing tracks the streak and the frame on glass', () => {
    expect(afterShowing(sun(1, 0.9), S0)).toEqual({ lastSnapshotId: 1, sunsetStreak: 1 });
    expect(afterShowing(non(2, 0.5), { lastSnapshotId: 1, sunsetStreak: 2 })).toEqual({ lastSnapshotId: 2, sunsetStreak: 0 });
  });
  it('project does not mutate its inputs', () => {
    const entries = [sun(1, 0.9), non(2, 0.5)];
    project(entries, D, S0, 5);
    expect(entries[0].tally).toBe(0);
  });
});
