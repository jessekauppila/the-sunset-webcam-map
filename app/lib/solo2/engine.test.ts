import { describe, it, expect } from 'vitest';
import { schemaDefaults } from '@/app/lib/settings/schema';
import { project } from '@/app/lib/solo/engine';
import type { BinEntry, ScreenState } from '@/app/lib/solo/types';
import { beatOf, next2, project2, roleAt, shown2, dwellMs2 } from './engine';
import { fitPlan } from './plan';
import { SOLO2_SETTINGS_SCHEMA, dialsFrom2 } from './settingsSchema';
/**
 * A plausible wall-clock stamp for a draw, for fixtures that need one. The
 * grid this used to come from is gone (dwell-budget spec §5): a slot is an
 * ordinal now, so nothing derives a time from one in production either.
 */
const atMs = (slot: number) => slot * D.dwellS * 1000;

import type { Solo2Dials } from './types';

// The spread swings each draw's budget by rank; these tests are about the
// budget rule itself, so they pin it to the dial.
const D: Solo2Dials = { ...dialsFrom2(schemaDefaults(SOLO2_SETTINGS_SCHEMA)), dwellBoost: 0, dwellTrim: 0 };
const S0: ScreenState = { lastSnapshotId: null, sunsetStreak: 0 };

function sun(id: number, q: number, extra: Partial<BinEntry> = {}): BinEntry {
  return { snapshotId: id, webcamId: 1000 + id, bin: 'sunset', quality: q, detection: 0.9,
    isNew: false, tally: 0, enteredAt: id, lastShownAt: null, ...extra };
}
function non(id: number, det: number, extra: Partial<BinEntry> = {}): BinEntry {
  return { snapshotId: id, webcamId: 2000 + id, bin: 'non_sunset', quality: null, detection: det,
    isNew: false, tally: 0, enteredAt: id, lastShownAt: null, ...extra };
}
const eightNon = () => [1, 2, 3, 4, 5, 6, 7, 8].map((i) => non(100 + i, 0.6 - i * 0.02));
/** S1..S21 by descending quality, all eligible. */
const twentyOne = () => Array.from({ length: 21 }, (_, i) => sun(i + 1, 0.99 - i * 0.02));
const labels = (out: BinEntry[]) => out.map((e) => (e.bin === 'sunset' ? `S${e.snapshotId}` : `N${e.snapshotId - 100}`));

describe('beatOf / roleAt', () => {
  it('valleys 0: every slot is a peak', () => {
    for (const s of [-3, 0, 1, 2, 7]) expect(roleAt(s, 'sunrise', D)).toBe('peak');
  });
  it('valleys 1, together: even slots peak on both screens', () => {
    const d = { ...D, valleys: 1 };
    expect([0, 1, 2, 3].map((s) => roleAt(s, 'sunrise', d))).toEqual(['peak', 'valley', 'peak', 'valley']);
    expect([0, 1, 2, 3].map((s) => roleAt(s, 'sunset', d))).toEqual(['peak', 'valley', 'peak', 'valley']);
  });
  it('valleys 1, alternate: the sunset screen peaks on the opposite beat', () => {
    const d = { ...D, valleys: 1, screens: 'alternate' as const };
    expect([0, 1, 2, 3].map((s) => roleAt(s, 'sunset', d))).toEqual(['valley', 'peak', 'valley', 'peak']);
    expect([0, 1, 2, 3].map((s) => roleAt(s, 'sunrise', d))).toEqual(['peak', 'valley', 'peak', 'valley']);
  });
  it('negative slots wrap into the bar', () => {
    const d = { ...D, valleys: 2 };
    expect([-3, -2, -1, 0, 1, 2].map((s) => beatOf(s, 'sunrise', d))).toEqual([0, 1, 2, 0, 1, 2]);
  });
});

describe('valleys 0 is solo', () => {
  it('reproduces the thin-night fixtures for every rest', () => {
    for (const rest of [0, 4, 8]) {
      const d = { ...D, rest };
      const entries = [sun(1, 0.97), ...eightNon()];
      expect(labels(project2(entries, d, S0, 12, 5, 'sunset'))).toEqual(labels(project(entries, d, S0, 12, 5, 'sunset')));
    }
  });
  it('reproduces solo on a full sunset bin', () => {
    expect(labels(project2(twentyOne(), D, S0, 8, 0, 'sunrise'))).toEqual(labels(project(twentyOne(), D, S0, 8, 0, 'sunrise')));
  });
  it('reproduces solo on the 2026-09-05 shape: five sunsets, thirty-five non-sunsets', () => {
    const many = Array.from({ length: 35 }, (_, i) => non(200 + i, 0.6 - i * 0.005));
    const five = [1, 2, 3, 4, 5].map((i) => sun(i, 0.95 - i * 0.02));
    expect(labels(project2([...five, ...many], D, S0, 12, 0, 'sunrise'))).toEqual(labels(project([...five, ...many], D, S0, 12, 0, 'sunrise')));
  });
});

describe('rhythm', () => {
  it('valleys 1: peaks best-first, valleys worst-first, alternating', () => {
    const d = { ...D, valleys: 1 };
    expect(labels(project2(twentyOne(), d, S0, 6, 0, 'sunrise'))).toEqual(['S1', 'S21', 'S2', 'S20', 'S3', 'S19']);
  });
  it('valleys 2: one peak then two valleys', () => {
    const d = { ...D, valleys: 2 };
    expect(labels(project2(twentyOne(), d, S0, 6, 0, 'sunrise'))).toEqual(['S1', 'S21', 'S20', 'S2', 'S19', 'S18']);
  });
  it('starting mid-bar starts on that beat', () => {
    const d = { ...D, valleys: 1 };
    expect(labels(project2(twentyOne(), d, S0, 3, 1, 'sunrise'))).toEqual(['S21', 'S1', 'S20']);
  });
  it('alternate: at the same slot one screen peaks and the other dips', () => {
    const d = { ...D, valleys: 1, screens: 'alternate' as const };
    expect(labels(project2(twentyOne(), d, S0, 2, 0, 'sunrise'))).toEqual(['S1', 'S21']);
    expect(labels(project2(twentyOne(), d, S0, 2, 0, 'sunset'))).toEqual(['S21', 'S1']);
  });
  it('a valley prefers an unshown frame over a lower-scored one already shown', () => {
    const d = { ...D, valleys: 1 };
    // Frame 3 was on glass long ago (rested); rule 3 puts never-shown before it.
    const entries = [sun(1, 0.95), sun(2, 0.6), sun(3, 0.58, { tally: 1, lastShownAt: atMs(-20) })];
    expect(next2(entries, d, S0, 1, 'sunrise')?.snapshotId).toBe(2);
  });
  it('a peak prefers the frame longest since shown over a better one shown more recently', () => {
    const d = { ...D, valleys: 1 };
    const older = sun(1, 0.6, { tally: 9, lastShownAt: atMs(-20) });
    const newer = sun(2, 0.95, { tally: 1, lastShownAt: atMs(-10) });
    // slot 0 is a peak
    expect(next2([older, newer], d, S0, 0, 'sunrise')?.snapshotId).toBe(1);
  });
  it('rule 4 holds on a valley: never the frame on glass', () => {
    const d = { ...D, valleys: 1 };
    const entries = [sun(1, 0.95), sun(2, 0.6)];
    expect(next2(entries, d, { lastSnapshotId: 2, sunsetStreak: 1 }, 1, 'sunrise')?.snapshotId).toBe(1);
  });
  it('non-sunsets still arrive through mix; they are the deepest valleys', () => {
    const d = { ...D, valleys: 1 };
    const entries = [sun(1, 0.9), sun(2, 0.8), sun(3, 0.7), ...eightNon()];
    // rule 2: three sunsets < floor 6 → mix 2 → S S N …; the beat only orders within the pool.
    expect(project2(entries, d, S0, 3, 0, 'sunset').map((e) => e.bin)).toEqual(['sunset', 'sunset', 'non_sunset']);
    // slot 2 is a peak: the highest-detection non-sunset; slot 1 was a valley: the lowest eligible sunset.
    expect(labels(project2(entries, d, S0, 3, 0, 'sunset'))).toEqual(['S1', 'S3', 'N1']);
  });
  it('the promote-new bonus counts against a valley too', () => {
    const d = { ...D, valleys: 1 };
    const entries = [sun(1, 0.95), sun(2, 0.6), sun(3, 0.55, { isNew: true })];
    // 0.55 + 0.10 = 0.65 > 0.60, so frame 2 is now the lowest.
    expect(next2(entries, d, S0, 1, 'sunrise')?.snapshotId).toBe(2);
  });
  it('a resting frame is out of both the peak and the valley', () => {
    const d = { ...D, valleys: 1 };
    const shown = { tally: 1, lastShownAt: atMs(0) };
    const entries = [sun(1, 0.95, shown), sun(2, 0.6), sun(3, 0.58, shown)];
    // slot 1 is a valley: the lowest score among the rested is frame 2, the only one.
    expect(next2(entries, d, S0, 1, 'sunrise')?.snapshotId).toBe(2);
    // slot 2 is a peak: frame 2 is on glass, 1 and 3 still rest → rest waived → best is 1.
    expect(next2(entries, d, { lastSnapshotId: 2, sunsetStreak: 1 }, 2, 'sunrise')?.snapshotId).toBe(1);
  });
});

describe('the camera run', () => {
  // Camera 7: frames 1 (older, 0.6), 2 (newer, 0.9). Camera 9: frame 3 (0.8). Camera 11: frame 4 (0.7).
  const cam = (id: number, webcamId: number, q: number, capturedAt: number, extra: Partial<BinEntry> = {}) =>
    ({ ...sun(id, q, { webcamId, ...extra }), capturedAt });
  const entries = () => [cam(1, 7, 0.6, 100), cam(2, 7, 0.9, 200), cam(3, 9, 0.8, 150), cam(4, 11, 0.7, 120)];
  it('a camera is one item: its newest frame is drawn, ranked by its best score', () => {
    expect(next2(entries(), D, S0, 0, 'sunrise')?.snapshotId).toBe(2);
    // After camera 7, camera 9 (0.8) then 11 (0.7); camera 7's older frame never gets its own turn.
    expect(project2(entries(), { ...D, rest: 0 }, S0, 4, 0, 'sunrise').map((e) => e.snapshotId)).toEqual([2, 3, 4, 2]);
  });
  it('every frame of the run counts as shown, so the camera rests as one', () => {
    const working = entries();
    const out = project2(working, { ...D, rest: 2 }, S0, 3, 0, 'sunrise');
    expect(out.map((e) => e.snapshotId)).toEqual([2, 3, 4]);
    expect(working.every((e) => e.tally === 0)).toBe(true); // inputs untouched
    expect(shown2(working, working[1], D).map((e) => e.snapshotId)).toEqual([1, 2]);
  });
  it('a camera shown recently is not "never shown" because a new frame arrived', () => {
    const es = [cam(1, 7, 0.9, 100, { tally: 1, lastShownAt: atMs(0) }), cam(2, 7, 0.95, 200), cam(3, 9, 0.5, 150)];
    // Slot 1: camera 7 rests (shown at slot 0, rest 4), camera 9 is drawn although it scores lower.
    expect(next2(es, D, { lastSnapshotId: 1, sunsetStreak: 1 }, 1, 'sunrise')?.snapshotId).toBe(3);
  });
  it('with the dial off every frame is its own item, as before', () => {
    const d = { ...D, cameraRun: false, rest: 0 };
    expect(project2(entries(), d, S0, 4, 0, 'sunrise').map((e) => e.snapshotId)).toEqual([2, 3, 4, 1]);
    expect(shown2(entries(), entries()[1], d).map((e) => e.snapshotId)).toEqual([2]);
  });
});

describe('dwellMs2: the budget rule over the frames actually played', () => {
  // The spread swings the budget by rank; this suite is about the rule, so it pins the dial.
  const D2 = { ...dialsFrom2(schemaDefaults(SOLO2_SETTINGS_SCHEMA)), cameraRun: true, dwellBoost: 0, dwellTrim: 0 };
  // The camera change's own segment at the default fades (dwell-budget spec
  // §3.3): every dwell is this much longer than the frames' budget.
  const ARRIVAL = 1_500;
  const frame = (id: number, cam: number, at: number, bin: 'sunset' | 'non_sunset' = 'sunset') => ({
    snapshotId: id, webcamId: cam, bin, quality: bin === 'sunset' ? 0.9 : null, detection: 0.9,
    isNew: false, tally: 0, enteredAt: at, capturedAt: at,
  });

  it('a lone frame holds the whole dwell', () => {
    const one = [frame(1, 7, 1000)];
    expect(dwellMs2(one, one[0], D2)).toBe(D2.dwellS * 1000 + ARRIVAL);
  });

  it('below the threshold the dwell does not move however many frames play', () => {
    const five = Array.from({ length: 5 }, (_, i) => frame(i + 1, 7, (i + 1) * 1000));
    expect(dwellMs2(five, five[4], D2)).toBe(D2.dwellS * 1000 + ARRIVAL);
  });

  it('above it the dwell stretches, and the sunset cap sets the ceiling', () => {
    const twelve = Array.from({ length: 12 }, (_, i) => frame(i + 1, 7, (i + 1) * 1000));
    // 12 frames capped to 8, each held at the 4 s floor: 32 s, not 48.
    expect(dwellMs2(twelve, twelve[11], D2)).toBe(32_000 + ARRIVAL);
  });

  it('a non-sunset can never stretch the dwell at the default cap (spec §4.1)', () => {
    // The cap of 3 sits below the threshold of 5, so the budget is merely
    // divided more finely: this dial buys pictures, never screen time.
    const twelve = Array.from({ length: 12 }, (_, i) => frame(i + 1, 7, (i + 1) * 1000, 'non_sunset'));
    expect(dwellMs2(twelve, twelve[11], D2)).toBe(D2.dwellS * 1000 + ARRIVAL);
    expect(shown2(twelve, twelve[11], D2)).toHaveLength(3);
  });

  it('raising the non-sunset cap past the threshold breaks that guarantee', () => {
    // Recorded because it is the invariant's failure mode, not a nicety.
    const twelve = Array.from({ length: 12 }, (_, i) => frame(i + 1, 7, (i + 1) * 1000, 'non_sunset'));
    expect(dwellMs2(twelve, twelve[11], { ...D2, runFramesOther: 8 })).toBe(32_000 + ARRIVAL);
  });

  it('agrees with what shown2 puts on glass, always', () => {
    const twelve = Array.from({ length: 12 }, (_, i) => frame(i + 1, 7, (i + 1) * 1000));
    for (const cap of [1, 3, 5, 8, 12]) {
      const d = { ...D2, runFramesSunset: cap };
      const played = shown2(twelve, twelve[11], d).length;
      expect(dwellMs2(twelve, twelve[11], d)).toBe(fitPlan(d, played).dwellS * 1000);
    }
  });
});
