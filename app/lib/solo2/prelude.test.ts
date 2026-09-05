import { describe, it, expect } from 'vitest';
import { preludeFor, preludePlan } from './prelude';

const f = (snapshotId: number, webcamId: number, capturedAt: number) => ({ snapshotId, webcamId, capturedAt });

describe('preludeFor', () => {
  const pool = [f(1, 7, 100), f(2, 7, 200), f(3, 9, 250), f(4, 7, 300), f(5, 7, 400), f(6, 7, 500)];
  it('same camera, earlier captures, in capture order, the last max', () => {
    expect(preludeFor(f(5, 7, 400), pool, 2).map((e) => e.snapshotId)).toEqual([2, 4]);
    expect(preludeFor(f(5, 7, 400), pool, 10).map((e) => e.snapshotId)).toEqual([1, 2, 4]);
  });
  it('never includes later frames, other cameras, or itself', () => {
    expect(preludeFor(f(4, 7, 300), pool, 10).map((e) => e.snapshotId)).toEqual([1, 2]);
  });
  it('a camera alone has no prelude; max 0 asks for none', () => {
    expect(preludeFor(f(3, 9, 250), pool, 3)).toEqual([]);
    expect(preludeFor(f(6, 7, 500), pool, 0)).toEqual([]);
  });
});

describe('preludeFor after a moment', () => {
  const pool = [f(1, 7, 100), f(2, 7, 200), f(4, 7, 300), f(5, 7, 400)];
  it('keeps only captures after `afterMs`, so a prelude continues from the frame on glass', () => {
    expect(preludeFor(f(5, 7, 400), pool, 10, 200).map((e) => e.snapshotId)).toEqual([4]);
    expect(preludeFor(f(5, 7, 400), pool, 10, 300)).toEqual([]);
  });
});

describe('preludePlan', () => {
  const dials = { dwellS: 20, prelude: true, preludeFrames: 3, preludeStepS: 1.5, leadS: 4 };
  const pool = [f(1, 7, 100), f(2, 7, 200), f(3, 7, 300), f(4, 7, 400), f(5, 7, 500), f(9, 8, 450)];
  it('returns the frames the plan actually shows, newest kept when the budget clamps', () => {
    // 6 s dwell: 3×1.5 + 4 > 6 − 3 → frames drop oldest-first to 0, then the lead shortens.
    const r = preludePlan(f(5, 7, 500), pool, { ...dials, dwellS: 8 });
    expect(r.plan.preludeFrames).toBe(0);
    expect(r.frames).toEqual([]);
    const full = preludePlan(f(5, 7, 500), pool, dials);
    expect(full.frames.map((e) => e.snapshotId)).toEqual([2, 3, 4]);
    expect(full.plan).toMatchObject({ preludeFrames: 3, holdS: 11.5 });
  });
  it('with the dial off there is no prelude and the plan says so', () => {
    const r = preludePlan(f(5, 7, 500), pool, { ...dials, prelude: false });
    expect(r.frames).toEqual([]);
    expect(r.plan.preludeFrames).toBe(0);
  });
  it('continues from a same-camera previous frame and ignores another camera\'s', () => {
    expect(preludePlan(f(5, 7, 500), pool, dials, f(3, 7, 300)).frames.map((e) => e.snapshotId)).toEqual([4]);
    expect(preludePlan(f(5, 7, 500), pool, dials, f(9, 8, 450)).frames.map((e) => e.snapshotId)).toEqual([2, 3, 4]);
  });
});
