import { describe, it, expect } from 'vitest';
import { schemaDefaults } from '@/app/lib/settings/schema';
import { project2 } from '@/app/lib/solo2/engine';
import { SOLO2_SETTINGS_SCHEMA, dialsFrom2 } from '@/app/lib/solo2/settingsSchema';
import type { Solo2Dials } from '@/app/lib/solo2/types';
import { S0, labAt, labelOf, seedPool } from './lab';

const D: Solo2Dials = { ...dialsFrom2(schemaDefaults(SOLO2_SETTINGS_SCHEMA)), cameraRun: false };

describe('the textbook pool', () => {
  it('is eight sunsets by rating and four non-sunsets by detection, one camera each', () => {
    const pool = seedPool();
    expect(pool.map(labelOf)).toEqual(['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'N1', 'N2', 'N3', 'N4']);
    expect(new Set(pool.map((e) => e.webcamId)).size).toBe(12);
  });
});

describe('labAt', () => {
  it('draw 1 has no history and the sieve picks the best sunset', () => {
    const f = labAt(seedPool(), D, 'sunrise', 1);
    expect(f.history).toEqual([]);
    expect(labelOf(f.trace.pick!)).toBe('S1');
    expect(f.upcoming.get(1)).toBe(1);
  });

  it('the history is what project2 draws, and the sieve at slot n is draw n', () => {
    const seed = seedPool();
    const draws = project2(seed, D, S0, 6, 1, 'sunrise').map(labelOf);
    const f = labAt(seed, D, 'sunrise', 6);
    expect(f.history).toEqual(draws.slice(0, 5));
    expect(labelOf(f.trace.pick!)).toBe(draws[5]);
  });

  it('stepping back is rebuilding from the seed: the same slot always reads the same', () => {
    const seed = seedPool();
    const a = labAt(seed, D, 'sunset', 4);
    const b = labAt(seed, D, 'sunset', 4);
    expect(a.trace.pick!.snapshotId).toBe(b.trace.pick!.snapshotId);
    expect(seed.every((e) => e.tally === 0)).toBe(true); // the seed itself is never touched
  });
});
