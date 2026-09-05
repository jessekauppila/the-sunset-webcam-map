import { describe, it, expect } from 'vitest';
import { schemaDefaults } from '@/app/lib/settings/schema';
import { project } from '@/app/lib/solo/engine';
import type { BinEntry, ScreenState } from '@/app/lib/solo/types';
import { boundaryMs } from '@/app/lib/solo/schedule';
import { beatOf, next2, project2, roleAt } from './engine';
import { SOLO2_SETTINGS_SCHEMA, dialsFrom2 } from './settingsSchema';
import type { Solo2Dials } from './types';

const D: Solo2Dials = dialsFrom2(schemaDefaults(SOLO2_SETTINGS_SCHEMA));
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
    // Frame 3 has been shown once (never resting: no lastShownAt); rule 3 puts tally before score.
    const entries = [sun(1, 0.95), sun(2, 0.6), sun(3, 0.58, { tally: 1 })];
    expect(next2(entries, d, S0, 1, 'sunrise')?.snapshotId).toBe(2);
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
    const shown = { tally: 1, lastShownAt: boundaryMs(0, 'sunrise', D.dwellS, D.offsetS) };
    const entries = [sun(1, 0.95, shown), sun(2, 0.6), sun(3, 0.58, shown)];
    // slot 1 is a valley: the lowest score among the rested is frame 2, the only one.
    expect(next2(entries, d, S0, 1, 'sunrise')?.snapshotId).toBe(2);
    // slot 2 is a peak: frame 2 is on glass, 1 and 3 still rest → rest waived → best is 1.
    expect(next2(entries, d, { lastSnapshotId: 2, sunsetStreak: 1 }, 2, 'sunrise')?.snapshotId).toBe(1);
  });
});
