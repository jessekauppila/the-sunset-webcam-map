import { describe, it, expect } from 'vitest';
import { arrivalS, exitS } from '@/app/lib/solo2/plan';
import { schemaDefaults } from '@/app/lib/settings/schema';
import { project } from './engine';
import { SOLO_VERSIONS, resolveSoloVersion } from './versions';
import type { BinEntry } from './types';

const sun = (id: number, q: number): BinEntry => ({
  snapshotId: id, webcamId: 1000 + id, bin: 'sunset', quality: q, detection: 0.9, isNew: false, tally: 0, enteredAt: id,
});
const S0 = { lastSnapshotId: null, sunsetStreak: 0 };

describe('resolveSoloVersion', () => {
  it('nothing is solo, names resolve, anything else is null', () => {
    expect(resolveSoloVersion(null)?.name).toBe('solo');
    expect(resolveSoloVersion(undefined)?.name).toBe('solo');
    expect(resolveSoloVersion('')?.name).toBe('solo');
    expect(resolveSoloVersion('solo2')?.name).toBe('solo2');
    expect(resolveSoloVersion('v4')).toBeNull();
    expect(resolveSoloVersion('toString')).toBeNull();
  });
});

describe('descriptors', () => {
  const entries = [sun(1, 0.9), sun(2, 0.8), sun(3, 0.7)];
  it('solo ignores the slot and matches its engine; every draw is a peak', () => {
    const v = SOLO_VERSIONS.solo;
    const d = v.dialsFrom(schemaDefaults(v.schema));
    expect(v.project(entries, d, S0, 3, 17, 'sunset')).toEqual(project(entries, d, S0, 3));
    expect(v.roleAt(1, 'sunset', d)).toBe('peak');
    expect(v.namespace).toBe('solo');
  });
  it('every version answers dwellMs purely, from the same three arguments as shown', () => {
    // The point of the interface (dwell-budget spec §5.2): nothing outside the
    // engine works a dwell's length out for itself. Today both versions return
    // the dial; step 3 changes solo2's function alone and every surface that
    // renders toward a dwell end follows without knowing about versions.
    for (const v of Object.values(SOLO_VERSIONS)) {
      // solo2's spread swings the budget by rank; pinned so the dwell is the dial here.
      const d = { ...v.dialsFrom(schemaDefaults(v.schema)), dwellBoost: 0, dwellTrim: 0 };
      // solo2's dwell carries the camera change's own segments outside the
      // frames' budget (dwell-budget spec §3.3): the rise in front and the
      // burn behind. solo's dials have no fades, so both are 0.
      const expected = (d.dwellS + arrivalS(d) + exitS(d)) * 1000;
      expect(v.dwellMs(entries, entries[0], d)).toBe(expected);
      // Pure: same answer for a different pick, and no mutation of the input.
      expect(v.dwellMs(entries, entries[2], d)).toBe(expected);
      expect(entries.map((e) => e.tally)).toEqual([0, 0, 0]);
    }
  });
  it('dwellMs follows the dial, not a hard-coded 20 s', () => {
    const v = SOLO_VERSIONS.solo;
    const d = { ...v.dialsFrom(schemaDefaults(v.schema)), dwellS: 47 };
    expect(v.dwellMs(entries, entries[0], d)).toBe(47_000);
  });
  it('solo2 reads its own namespace and follows the beat', () => {
    const v = SOLO_VERSIONS.solo2;
    const d = { ...v.dialsFrom(schemaDefaults(v.schema)), valleys: 1 };
    expect(v.namespace).toBe('solo2');
    expect(v.roleAt(1, 'sunrise', d)).toBe('valley');
    expect(v.project(entries, d, S0, 3, 0, 'sunrise').map((e) => e.snapshotId)).toEqual([1, 3, 2]);
  });
});
