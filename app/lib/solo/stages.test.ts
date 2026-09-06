import { describe, it, expect } from 'vitest';
import { assignStages, compareStaged, floorFor, STAGE_ORDER } from './stages';
import { project } from './engine';
import { boundaryMs } from './schedule';
import { dialsFrom, SOLO_SETTINGS_SCHEMA } from './settingsSchema';
import { schemaDefaults } from '@/app/lib/settings/schema';
import type { BinEntry, Feed, ScreenState, SoloDials } from './types';

const D: SoloDials = { ...dialsFrom(schemaDefaults(SOLO_SETTINGS_SCHEMA)), ratingFloor: 3.2, rest: 4 }; // quality 0.55
const FEED: Feed = 'sunrise';
const sun = (id: number, q: number, extra: Partial<BinEntry> = {}): BinEntry => ({
  snapshotId: id, webcamId: 1000 + id, bin: 'sunset', quality: q, detection: 0.9,
  isNew: false, tally: 0, enteredAt: id, lastShownAt: null, ...extra });
const non = (id: number, det: number, extra: Partial<BinEntry> = {}): BinEntry => ({
  snapshotId: id, webcamId: 2000 + id, bin: 'non_sunset', quality: null, detection: det,
  isNew: false, tally: 0, enteredAt: id, lastShownAt: null, ...extra });
const shownAt = (slot: number) => ({ tally: 1, lastShownAt: boundaryMs(slot, FEED, D.dwellS, D.offsetS) });

function stagesOf(entries: BinEntry[], state: ScreenState, firstSlot: number, queueDepth = 2) {
  const eligible = entries.filter((e) => (e.bin === 'sunset' ? (e.quality ?? -1) >= 0.55 : e.detection >= D.detectionFloor)).length;
  const draws = project(entries, D, state, eligible + queueDepth, firstSlot, FEED);
  return assignStages({ entries, dials: D, state, firstSlot, feed: FEED, draws, queueDepth });
}

describe('floorFor', () => {
  it('is the rating floor as a quality for sunsets and the detection floor for non-sunsets', () => {
    expect(floorFor(sun(1, 0.9), D)).toBeCloseTo(0.55);
    expect(floorFor(non(1, 0.9), D)).toBe(D.detectionFloor);
  });
});

describe('assignStages', () => {
  it('marks the frame on glass, the queued ones by position, and the rest in line by later position', () => {
    // Slot 10: frame 1 is on glass, 2..4 never shown. Queue depth 2 → 2 and 3 queued, 4 in line at draw 3.
    const entries = [sun(1, 0.9, shownAt(9)), sun(2, 0.8), sun(3, 0.7), sun(4, 0.6)];
    const s = stagesOf(entries, { lastSnapshotId: 1, sunsetStreak: 1 }, 10);
    expect(s.get(1)).toEqual({ kind: 'onGlass' });
    expect(s.get(2)).toEqual({ kind: 'queued', position: 1 });
    expect(s.get(3)).toEqual({ kind: 'queued', position: 2 });
    expect(s.get(4)).toEqual({ kind: 'inLine', position: 3 });
  });
  it('a frame under its floor is underFloor, with the floor it misses', () => {
    const s = stagesOf([sun(1, 0.9), sun(2, 0.1), non(3, 0.1)], { lastSnapshotId: null, sunsetStreak: 0 }, 0);
    expect(s.get(2)).toEqual({ kind: 'underFloor', floor: expect.closeTo(0.55, 5) });
    expect(s.get(3)).toEqual({ kind: 'underFloor', floor: 0.3 });
  });
  it('a resting frame says how many draws until it is back', () => {
    // Shown at slot 10, rest 4: resting at slots 11–14, back at 15. From slot 11 that is 4 draws; from slot 14, 1.
    const rested = sun(1, 0.9, shownAt(10));
    const others = [sun(2, 0.8), sun(3, 0.7), sun(4, 0.6), sun(5, 0.5)];
    const state = { lastSnapshotId: 2, sunsetStreak: 1 };
    expect(stagesOf([rested, ...others], state, 11).get(1)).toEqual({ kind: 'resting', drawsLeft: 4 });
    expect(stagesOf([rested, ...others], state, 14).get(1)).toEqual({ kind: 'resting', drawsLeft: 1 });
    expect(stagesOf([rested, ...others], state, 15).get(1)?.kind).not.toBe('resting');
  });
  it('an eligible frame the projection never reaches is inLine with a null position', () => {
    // Twelve sunsets with rest 4: at least seven are always rested, above the sunset floor of six, so the projection never draws a non-sunset.
    const sunsets = Array.from({ length: 12 }, (_, i) => sun(i + 1, 0.9 - i * 0.01));
    const s = stagesOf([...sunsets, non(50, 0.5)], { lastSnapshotId: null, sunsetStreak: 0 }, 0);
    expect(s.get(50)).toEqual({ kind: 'inLine', position: null });
  });
  it('a queued frame that repeats in the queue keeps its first position', () => {
    const entries = [sun(1, 0.9), sun(2, 0.8)];
    const s = stagesOf(entries, { lastSnapshotId: null, sunsetStreak: 0 }, 0, 4);
    expect(s.get(1)).toEqual({ kind: 'queued', position: 1 });
    expect(s.get(2)).toEqual({ kind: 'queued', position: 2 });
  });
});

describe('compareStaged', () => {
  it('orders by stage, then draw position, then draws left, then the engine order', () => {
    // Projection from slot 11, queue depth 1. Frames 1 and 6 were on glass at slots 10 and 9: resting 4 and 3 draws.
    const entries = [
      sun(1, 0.9, shownAt(10)),
      sun(2, 0.1),
      sun(3, 0.7), sun(4, 0.8), sun(5, 0.6),
      sun(6, 0.65, shownAt(9)),
    ];
    const s = stagesOf(entries, { lastSnapshotId: null, sunsetStreak: 0 }, 11, 1);
    const sorted = [...entries].sort(compareStaged(s, D)).map((e) => e.snapshotId);
    // queued 4; in line 3 then 5 by position; resting 6 (3 left) before 1 (4 left); under floor 2 last.
    expect(sorted).toEqual([4, 3, 5, 6, 1, 2]);
    expect(STAGE_ORDER.queued).toBeLessThan(STAGE_ORDER.inLine);
  });
});
