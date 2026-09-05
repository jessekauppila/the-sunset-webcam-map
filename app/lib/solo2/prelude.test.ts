import { describe, it, expect } from 'vitest';
import { preludeFor } from './prelude';

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
