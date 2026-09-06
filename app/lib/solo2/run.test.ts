import { describe, it, expect } from 'vitest';
import { cameraGroups, poolEntries, representative, runOf, type RunEntry } from './run';

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
