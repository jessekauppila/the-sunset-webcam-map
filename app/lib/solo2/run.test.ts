import { describe, it, expect } from 'vitest';
import { budgetS, cameraGroups, planDialsFor, poolEntries, qualityRank, representative, runOf, type RunEntry, capFor } from './run';

const f = (id: number, cam: number, capturedAt: number, extra: Partial<RunEntry> = {}): RunEntry => ({
  snapshotId: id, webcamId: cam, bin: 'sunset', quality: 0.5, detection: 0.8, isNew: false, tally: 0, enteredAt: id,
  lastShownAt: null, capturedAt, ...extra,
});

describe('cameraGroups', () => {
  it('groups by camera, oldest first, id breaking a tie', () => {
    const g = cameraGroups([f(3, 7, 300), f(1, 7, 100), f(5, 9, 50), f(2, 7, 100)]);
    expect([...g.keys()]).toEqual([7, 9]);
    expect(g.get(7)!.map((e) => e.snapshotId)).toEqual([1, 2, 3]);
  });
  it('falls back to enteredAt when a frame has no capture time', () => {
    const g = cameraGroups([{ ...f(3, 7, 0), capturedAt: undefined, enteredAt: 30 }, { ...f(1, 7, 0), capturedAt: undefined, enteredAt: 10 }]);
    expect(g.get(7)!.map((e) => e.snapshotId)).toEqual([1, 3]);
  });
});

describe('representative', () => {
  it('is the newest frame with the best bin and scores, the most showings, the latest showing, new if any is', () => {
    const r = representative([
      f(1, 7, 100, { bin: 'non_sunset', quality: null, detection: 0.4, tally: 2, lastShownAt: 500, isNew: false }),
      f(2, 7, 200, { bin: 'sunset', quality: 0.9, detection: 0.7, tally: 1, lastShownAt: 900, isNew: true }),
      f(3, 7, 300, { bin: 'non_sunset', quality: null, detection: 0.3, tally: 0, lastShownAt: null, isNew: false }),
    ]);
    expect(r).toMatchObject({ snapshotId: 3, webcamId: 7, enteredAt: 3, capturedAt: 300,
      bin: 'sunset', quality: 0.9, detection: 0.7, tally: 2, lastShownAt: 900, isNew: true });
  });
  it('a camera never shown stays never shown; a lone frame is itself', () => {
    expect(representative([f(1, 7, 100), f(2, 7, 200)]).lastShownAt).toBeNull();
    expect(representative([f(4, 8, 100, { quality: 0.3, tally: 3 })])).toEqual(f(4, 8, 100, { quality: 0.3, tally: 3 }));
  });
});

describe('poolEntries / runOf', () => {
  const entries = [f(1, 7, 100, { quality: 0.6 }), f(2, 7, 200, { quality: 0.9 }), f(3, 7, 300, { quality: 0.7 }), f(4, 9, 150)];
  it('with the dial on, one entry per camera; off, every frame', () => {
    expect(poolEntries(entries, true).map((e) => [e.snapshotId, e.quality])).toEqual([[3, 0.9], [4, 0.5]]);
    expect(poolEntries(entries, false)).toBe(entries);
  });
  it('the run is the camera oldest to newest with the entry last; nothing newer than the entry', () => {
    expect(runOf(entries[2], entries, true).map((e) => e.snapshotId)).toEqual([1, 2, 3]);
    expect(runOf(entries[1], entries, true).map((e) => e.snapshotId)).toEqual([1, 2]);
    expect(runOf(entries[3], entries, true).map((e) => e.snapshotId)).toEqual([4]);
  });
  it('with the dial off the run is the entry alone', () => {
    expect(runOf(entries[2], entries, false)).toEqual([entries[2]]);
  });
});

describe('the per-bin frame cap (dwell-budget spec §4)', () => {
  const cam = (id: number, at: number) => ({
    snapshotId: id, webcamId: 7, bin: 'sunset' as const, quality: 0.9, detection: 0.9,
    isNew: false, tally: 0, enteredAt: at, capturedAt: at,
  });
  const twelve = Array.from({ length: 12 }, (_, i) => cam(i + 1, (i + 1) * 1000));
  const chosen = twelve[11];

  it('plays the NEWEST n, and still oldest to newest, so the sun goes down', () => {
    const run = runOf(chosen, twelve, true, 8);
    expect(run).toHaveLength(8);
    // Frames 5..12: the window sits against the chosen frame, and the order
    // inside it is unchanged. Taking the oldest 8 would play 1..8 and then cut
    // to 12, skipping the middle of the descent.
    expect(run.map((e) => e.snapshotId)).toEqual([5, 6, 7, 8, 9, 10, 11, 12]);
    expect(run[run.length - 1].snapshotId).toBe(chosen.snapshotId);
  });

  it('a cap of 1 is the chosen frame alone; an uncapped run is every earlier frame', () => {
    expect(runOf(chosen, twelve, true, 1).map((e) => e.snapshotId)).toEqual([12]);
    expect(runOf(chosen, twelve, true, 0).map((e) => e.snapshotId)).toEqual([12]);
    expect(runOf(chosen, twelve, true)).toHaveLength(12);
  });

  it('a cap larger than the camera has is not padded', () => {
    expect(runOf(twelve[2], twelve, true, 8).map((e) => e.snapshotId)).toEqual([1, 2, 3]);
  });

  it('capFor gives sunsets the longer run', () => {
    const d = { runFramesSunset: 8, runFramesOther: 3 };
    expect(capFor({ bin: 'sunset' }, d)).toBe(8);
    expect(capFor({ bin: 'non_sunset' }, d)).toBe(3);
  });
});

describe('the run by rank: the peak buys screen time, a grey sunset gives it back', () => {
  const d = { runFramesSunset: 16, runFramesOther: 5, runShape: 'rank' as const };
  // Four cameras' best frames: 0.2, 0.4, 0.6, 0.9. Camera 3 also holds a
  // weaker earlier frame, which must not count as a second competitor.
  const pool = [
    f(1, 1, 1000, { quality: 0.2 }),
    f(2, 2, 1000, { quality: 0.4 }),
    f(3, 3, 900, { quality: 0.3 }), f(4, 3, 1000, { quality: 0.6 }),
    f(5, 4, 1000, { quality: 0.9 }),
    f(6, 5, 1000, { bin: 'non_sunset', quality: null, detection: 0.4 }),
  ];

  it('ranks cameras by their best frame, weakest 0 to strongest 1', () => {
    expect(qualityRank(pool[0], pool, true)).toBe(0);
    expect(qualityRank(pool[1], pool, true)).toBeCloseTo(1 / 3);
    expect(qualityRank(pool[2], pool, true)).toBeCloseTo(2 / 3); // the camera's best is 0.6, not this frame's 0.3
    expect(qualityRank(pool[4], pool, true)).toBe(1);
  });

  it('the strongest sunset present plays the whole cap; the weakest no longer than a non-sunset; the rest between', () => {
    expect(capFor(pool[4], d, pool)).toBe(16);
    expect(capFor(pool[0], d, pool)).toBe(5);
    expect(capFor(pool[1], d, pool)).toBe(9);  // 5 + 11 × 1/3
    expect(capFor(pool[3], d, pool)).toBe(12); // 5 + 11 × 2/3
  });

  it('a lone sunset is the best available', () => {
    expect(capFor(pool[0], d, [pool[0], pool[5]])).toBe(16);
  });

  it('a non-sunset is untouched by the shape', () => {
    expect(capFor(pool[5], d, pool)).toBe(5);
  });

  it('flat, or nothing to rank against, is the old cap', () => {
    expect(capFor(pool[0], { ...d, runShape: 'flat' }, pool)).toBe(16);
    expect(capFor(pool[0], d)).toBe(16);
    expect(capFor({ bin: 'sunset' }, { runFramesSunset: 8, runFramesOther: 3 })).toBe(8);
  });

  it('with the camera run off, frames are ranked as themselves', () => {
    // Camera 3's 0.3 frame now competes on its own: below 0.4 and 0.6 and 0.9, above 0.2.
    expect(qualityRank(pool[2], pool, false)).toBeCloseTo(1 / 4);
  });
});

describe('the dwell spread: a grey frame gives back a little time, the best sunset takes a little more', () => {
  const d = { dwellS: 13, dwellSpread: 25, runFramesSunset: 16, runFramesOther: 5, runShape: 'rank' as const };
  const pool = [
    f(1, 1, 1000, { quality: 0.2 }),
    f(2, 2, 1000, { quality: 0.6 }),
    f(3, 3, 1000, { quality: 0.9 }),
    f(4, 4, 1000, { bin: 'non_sunset', quality: null, detection: 0.4 }),
  ];
  it('the dial is the middle: non-sunset and weakest sunset below it, strongest above, by rank between', () => {
    expect(budgetS(pool[3], d, pool)).toBeCloseTo(9.75);
    expect(budgetS(pool[0], d, pool)).toBeCloseTo(9.75);
    expect(budgetS(pool[1], d, pool)).toBeCloseTo(13);
    expect(budgetS(pool[2], d, pool)).toBeCloseTo(16.25);
  });
  it('0 spread is the dial for everyone', () => {
    expect(budgetS(pool[3], { ...d, dwellSpread: 0 }, pool)).toBe(13);
    expect(budgetS(pool[2], { ...d, dwellSpread: 0 }, pool)).toBe(13);
  });
  it('flat shape: every sunset is the strongest, non-sunsets still below', () => {
    expect(budgetS(pool[0], { ...d, runShape: 'flat' }, pool)).toBeCloseTo(16.25);
    expect(budgetS(pool[3], { ...d, runShape: 'flat' }, pool)).toBeCloseTo(9.75);
  });
  it('planDialsFor hands fitPlan the swung budget and nothing else changed', () => {
    const p = planDialsFor(pool[2], { ...d, minStepS: 4 }, pool);
    expect(p.dwellS).toBeCloseTo(16.25);
    expect(p.minStepS).toBe(4);
  });
});
