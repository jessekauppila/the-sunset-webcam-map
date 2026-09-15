import { describe, it, expect } from 'vitest';
import { budgetBeats, cameraGroups, planDialsFor, poolEntries, qualityRank, representative, runOf, standsFor, type RunEntry, capFor } from './run';

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

describe('budgetBeats: the still, swung by rank and rounded to whole beats', () => {
  const D = { dwellBeats: 3, dwellBoost: 25, dwellTrim: 25, runFramesSunset: 8, runFramesOther: 3, runShape: 'rank' as const };
  const s = (id: number, cam: number, q: number) => f(id, cam, id * 100, { quality: q });
  it('with no spread every draw is the still', () => {
    const d = { ...D, dwellBoost: 0, dwellTrim: 0 };
    expect(budgetBeats(s(1, 7, 0.9), d, [s(1, 7, 0.9), s(2, 8, 0.2)])).toBe(3);
    expect(budgetBeats(f(3, 9, 300, { bin: 'non_sunset', quality: null }), d, [])).toBe(3);
  });
  it('the best sunset present holds the boost, the weakest and every non-sunset the trim, rounded', () => {
    const pool = [s(1, 7, 0.9), s(2, 8, 0.5), s(3, 9, 0.2), f(4, 10, 400, { bin: 'non_sunset', quality: null })];
    expect(budgetBeats(pool[0], D, pool)).toBe(4);   // 3 × 1.25 = 3.75 → 4
    expect(budgetBeats(pool[1], D, pool)).toBe(3);   // rank 0.5: 3 × 1.0
    expect(budgetBeats(pool[2], D, pool)).toBe(2);   // 3 × 0.75 = 2.25 → 2
    expect(budgetBeats(pool[3], D, pool)).toBe(2);
  });
  it('never below one beat', () => {
    expect(budgetBeats(f(4, 10, 400, { bin: 'non_sunset', quality: null }), { ...D, dwellBeats: 1, dwellTrim: 50 }, [])).toBe(1);
  });
  it('planDialsFor swaps the still for the budget and touches nothing else', () => {
    const pool = [s(1, 7, 0.9), s(2, 8, 0.2)];
    const out = planDialsFor(pool[0], { ...D, beatS: 4, leadS: 0, changeBeats: 1 }, pool);
    expect(out.dwellBeats).toBe(4);
    expect(out.beatS).toBe(4);
    expect(out.runFramesSunset).toBe(8);
  });
});

describe('the run is sized by the camera, not by the drawn frame', () => {
  // 2026-09-08: `next2` chooses a camera by its representative — the best
  // frame's bin — then returns the raw newest frame, and everything downstream
  // read the bin off THAT. One snapshot the detection head called non-sunset
  // dropped the camera from up to 16 frames to 5, and its budget with it.
  // Measured that day: 30 of 38 non-sunset draws were of cameras still holding
  // sunset frames; Stromness had 13 of 23 and ran five.
  const d = { runFramesSunset: 16, runFramesOther: 5, runShape: 'rank' as const, dwellBeats: 13, dwellBoost: 25, dwellTrim: 25 };
  // Camera 7's best frame is a strong sunset; its NEWEST frame is not a sunset.
  const camera7 = [
    f(1, 7, 100, { bin: 'sunset', quality: 0.9 }),
    f(2, 7, 200, { bin: 'sunset', quality: 0.8 }),
    f(3, 7, 300, { bin: 'non_sunset', quality: null, detection: 0.4 }),
  ];
  const rival = f(9, 8, 300, { bin: 'sunset', quality: 0.1 });
  const pool = [...camera7, rival];
  const newest = camera7[2];

  it('caps by the camera, so the newest frame\'s bin cannot shrink the run', () => {
    // The camera stands top of two sunsets: the whole sunset cap, not the 5 its
    // own newest frame would have asked for.
    expect(capFor(newest, d, pool, true)).toBe(16);
  });

  it('budgets by the camera too, so the dwell and the cap agree about what it is', () => {
    // Rank 1: the dial plus the boost, not the dial less the trim.
    // 13 × (1 - 0.25 + (0.25 + 0.25) × 1) = 13 × 1.25 = 16.25 → 16.
    expect(budgetBeats(newest, d, pool, true)).toBe(16);
  });

  it('still sizes a camera whose frames are all non-sunset by the non-sunset dial', () => {
    const grey = [f(4, 6, 100, { bin: 'non_sunset', quality: null }), f(5, 6, 200, { bin: 'non_sunset', quality: null })];
    expect(capFor(grey[1], d, [...grey, ...pool], true)).toBe(5);
    // rank 0: 13 × (1 - 0.25) = 13 × 0.75 = 9.75 → 10.
    expect(budgetBeats(grey[1], d, [...grey, ...pool], true)).toBe(10);
  });

  it('with the camera run off, a frame is sized as itself: there is no camera to stand for it', () => {
    expect(capFor(newest, d, pool, false)).toBe(5);
  });

  it('standsFor falls back to the entry when there is no camera or nothing to group', () => {
    expect(standsFor(newest, pool, true)).toMatchObject({ webcamId: 7, bin: 'sunset', quality: 0.9 });
    expect(standsFor(newest, undefined, true)).toBe(newest);
    expect(standsFor(newest, pool, false)).toBe(newest);
    expect(standsFor({ bin: 'sunset' }, pool, true)).toEqual({ bin: 'sunset' });
  });
});
