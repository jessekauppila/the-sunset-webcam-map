import { describe, it, expect } from 'vitest';
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
  it('solo2 reads its own namespace and follows the beat', () => {
    const v = SOLO_VERSIONS.solo2;
    const d = { ...v.dialsFrom(schemaDefaults(v.schema)), valleys: 1 };
    expect(v.namespace).toBe('solo2');
    expect(v.roleAt(1, 'sunrise', d)).toBe('valley');
    expect(v.project(entries, d, S0, 3, 0, 'sunrise').map((e) => e.snapshotId)).toEqual([1, 3, 2]);
  });
});
