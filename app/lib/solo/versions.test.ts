import { describe, it, expect } from 'vitest';
import { fitPlan } from '@/app/lib/solo2/plan';
import { schemaDefaults } from '@/app/lib/settings/schema';
import { project } from './engine';
import { SOLO_VERSIONS, resolveSoloVersion } from './versions';
import type { BinEntry } from './types';
import type { Solo2Dials } from '@/app/lib/solo2/types';

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
    for (const v of Object.values(SOLO_VERSIONS)) {
      const d = { ...v.dialsFrom(schemaDefaults(v.schema)), dwellBoost: 0, dwellTrim: 0 };
      // solo: the dial. solo2: whole beats — one beat of change, the frame, and the rest of the still (beat spec §2.2).
      const expected = v.name === 'solo' ? d.dwellS * 1000 : fitPlan(d as Solo2Dials, 1).dwellS * 1000;
      expect(v.dwellMs(entries, entries[0], d)).toBe(expected);
      expect(v.dwellMs(entries, entries[2], d)).toBe(expected);
      expect(entries.map((e) => e.tally)).toEqual([0, 0, 0]);
    }
  });
  it('dwellMs follows the dial, not a hard-coded 20 s', () => {
    const v = SOLO_VERSIONS.solo;
    const d = { ...v.dialsFrom(schemaDefaults(v.schema)), dwellS: 47 };
    expect(v.dwellMs(entries, entries[0], d)).toBe(47_000);
  });
  it('a dwell starts now for solo and on the nearest tick for solo2', () => {
    const t0 = Date.UTC(2026, 8, 14, 17, 30, 0);
    const solo = SOLO_VERSIONS.solo;
    expect(solo.startMs(t0 + 1_234, solo.dialsFrom(schemaDefaults(solo.schema)))).toBe(t0 + 1_234);
    const solo2 = SOLO_VERSIONS.solo2;
    const d2 = solo2.dialsFrom(schemaDefaults(solo2.schema));
    expect(solo2.startMs(t0 + 300, d2)).toBe(t0);
    expect(solo2.startMs(t0 + 3_800, d2)).toBe(t0 + 4_000);
  });
  it('solo2 reads its own namespace and follows the beat', () => {
    const v = SOLO_VERSIONS.solo2;
    const d = { ...v.dialsFrom(schemaDefaults(v.schema)), valleys: 1 };
    expect(v.namespace).toBe('solo2');
    expect(v.roleAt(1, 'sunrise', d)).toBe('valley');
    expect(v.project(entries, d, S0, 3, 0, 'sunrise').map((e) => e.snapshotId)).toEqual([1, 3, 2]);
  });
  it('the rendezvous seam: only solo2 exposes fitNext', () => {
    expect(SOLO_VERSIONS.solo.fitNext).toBeUndefined();
    expect(typeof SOLO_VERSIONS.solo2.fitNext).toBe('function');
  });
  it('the queue seam: only solo2 exposes queue', () => {
    expect(SOLO_VERSIONS.solo.queue).toBeUndefined();
    expect(typeof SOLO_VERSIONS.solo2.queue).toBe('function');
  });
  it('solo2 prices a given run the same way it prices its own, for a lone frame', () => {
    const v = SOLO_VERSIONS.solo2;
    const d = { ...v.dialsFrom(schemaDefaults(v.schema)), dwellBoost: 0, dwellTrim: 0 };
    expect(v.dwellMsFor!(entries, entries[0], d, 1)).toBe(v.dwellMs(entries, entries[0], d));
  });
});
