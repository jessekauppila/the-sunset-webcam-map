import { describe, it, expect } from 'vitest';
import { schemaDefaults } from '@/app/lib/settings/schema';
import { SOLO2_SETTINGS_SCHEMA, dialsFrom2 } from '@/app/lib/solo2/settingsSchema';
import type { RunEntry } from '@/app/lib/solo2/run';
import { layoutQueueLane, crossings } from './queueLane';

const D = { ...dialsFrom2(schemaDefaults(SOLO2_SETTINGS_SCHEMA)), cameraRun: true, rendezvous: true };
const T0 = Date.UTC(2026, 8, 16, 2, 0, 0);
const beat = (n: number) => n * D.beatS * 1000;

const f = (id: number, cam: number, at: number, q: number | null): RunEntry => ({
  snapshotId: id, webcamId: cam, bin: q == null ? 'non_sunset' : 'sunset', quality: q, detection: 0.8,
  isNew: false, tally: 0, enteredAt: id, lastShownAt: null, capturedAt: at,
});

/** Three cameras: 7 with a climb of three to its peak, 8 with one, 9 grey. */
const cam7 = [f(1, 7, 100, 0.3), f(2, 7, 200, 0.5), f(3, 7, 300, 0.7), f(4, 7, 400, 0.95)];
const cam8 = [f(10, 8, 100, 0.2), f(11, 8, 200, 0.4)];
const cam9 = [f(20, 9, 100, null), f(21, 9, 200, null)];
const entries = [...cam7, ...cam8, ...cam9];

const base = {
  queue: [cam7[3], cam8[1], cam9[1]],
  entries,
  dials: D,
  outstandingMs: null as number | null,
  t0Ms: T0,
  chosenId: null as number | null,
  blockX: new Map<number, number>(),
  framePx: 20,
  gapPx: 4,
};

describe('layoutQueueLane (scheduler spec §6)', () => {
  it('lays items out in queue order, each as wide as its frame count', () => {
    const lane = layoutQueueLane(base);
    expect(lane.items.map((i) => i.position)).toEqual([1, 2, 3]);
    expect(lane.items.map((i) => i.entry.webcamId)).toEqual([7, 8, 9]);
    expect(lane.items[0].x).toBe(0);
    expect(lane.items[0].width).toBe(cam7.length * 20);
    expect(lane.items[1].x).toBe(lane.items[0].width + 4);
    expect(lane.width).toBe(lane.items[2].x + lane.items[2].width);
  });

  it('a camera is one box holding its whole series, in capture order', () => {
    const lane = layoutQueueLane(base);
    expect(lane.items[0].frames.map((e) => e.snapshotId)).toEqual([1, 2, 3, 4]);
  });

  it('marks which frames the draw would actually play, so the rest can draw dim', () => {
    const lane = layoutQueueLane(base);
    // Every frame of a four-frame camera fits the sunset cap, so all play.
    expect(lane.items[0].frames.every((e) => lane.items[0].playedIds.has(e.snapshotId))).toBe(true);
  });

  it('marks the camera the draw took, and only that one', () => {
    const lane = layoutQueueLane({ ...base, chosenId: cam9[1].snapshotId });
    expect(lane.items.filter((i) => i.took).map((i) => i.position)).toEqual([3]);
  });

  it('with no landing outstanding, nothing reaches', () => {
    const lane = layoutQueueLane(base);
    expect(lane.items.some((i) => i.reaches)).toBe(false);
  });

  it('a camera reaches when its climb can put its peak on the tick; a grey one never does', () => {
    // One change beat, then one beat of climb: camera 8's single climb frame
    // reaches it, camera 7's three-frame climb reaches it too (it thins), and
    // camera 9 has no peak at all.
    const lane = layoutQueueLane({ ...base, outstandingMs: T0 + beat(1 + 1) });
    expect(lane.items[0].reaches).toBe(true);
    expect(lane.items[1].reaches).toBe(true);
    expect(lane.items[2].reaches).toBe(false);
  });

  it('a landing further out than a climb is out of reach', () => {
    const lane = layoutQueueLane({ ...base, outstandingMs: T0 + beat(1 + 3) });
    expect(lane.items[0].reaches).toBe(true);  // climb of three
    expect(lane.items[1].reaches).toBe(false); // climb of one
  });

  it('links a camera to where it reached the glass, and skips one that has not played', () => {
    const lane = layoutQueueLane({ ...base, blockX: new Map([[7, 300], [9, 80]]) });
    expect(lane.links).toHaveLength(2);
    expect(lane.links[0]).toMatchObject({ toX: 300 });
    expect(lane.links[1]).toMatchObject({ toX: 80 });
  });
});

describe('crossings', () => {
  it('is zero when the queue is taken in turn', () => {
    expect(crossings([
      { fromX: 0, toX: 0, took: false },
      { fromX: 10, toX: 10, took: false },
    ])).toBe(0);
  });

  it('counts a camera pulled out of turn', () => {
    // The 2nd camera reached the glass before the 1st did.
    expect(crossings([
      { fromX: 0, toX: 50, took: false },
      { fromX: 20, toX: 10, took: true },
    ])).toBe(1);
  });

  it('counts every crossing pair, not just neighbours', () => {
    // Three cameras played in exactly reverse order: three crossings.
    expect(crossings([
      { fromX: 0, toX: 100, took: false },
      { fromX: 50, toX: 50, took: false },
      { fromX: 100, toX: 0, took: true },
    ])).toBe(3);
  });
});
