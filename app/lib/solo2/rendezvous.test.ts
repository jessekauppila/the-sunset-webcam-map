import { describe, it, expect } from 'vitest';
import { fitNext, peakOf, thinClimb, windowAround, type MySide } from './rendezvous';
import type { RunEntry } from './run';

const f = (id: number, cam: number, at: number, q: number | null, bin: 'sunset' | 'non_sunset' = q == null ? 'non_sunset' : 'sunset'): RunEntry => ({
  snapshotId: id, webcamId: cam, bin, quality: q, detection: 0.8, isNew: false, tally: 0, enteredAt: id, lastShownAt: null, capturedAt: at,
});
/** A night of camera 7: five grey frames, a climb of four, the peak at id 10, three after. */
const night = [
  f(1, 7, 100, null), f(2, 7, 200, null), f(3, 7, 300, null), f(4, 7, 400, null), f(5, 7, 500, null),
  f(6, 7, 600, 0.4), f(7, 7, 700, 0.5), f(8, 7, 800, 0.6), f(9, 7, 900, 0.8),
  f(10, 7, 1000, 0.95),
  f(11, 7, 1100, 0.7), f(12, 7, 1200, 0.5), f(13, 7, 1300, null),
];
const ids = (xs: RunEntry[]) => xs.map((x) => x.snapshotId);
const D = { beatS: 4, changeBeats: 1, transition: 'dip' as const, cameraRun: true, rendezvous: true, rendezvousRank: 0.6, runFramesSunset: 8, runFramesOther: 3, runShape: 'flat' as const };
const T0 = Date.UTC(2026, 8, 15, 2, 0, 0);
const beat = (n: number) => n * 4_000;

describe('peakOf', () => {
  it('is the best-rated sunset frame; null when the series has none', () => {
    expect(peakOf(night)!.snapshotId).toBe(10);
    expect(peakOf(night.filter((x) => x.bin !== 'sunset'))).toBeNull();
  });
  it('breaks a quality tie by capture time, not array position', () => {
    // id 2 was captured after id 1, but is listed first in the array.
    const tied = [f(2, 7, 200, 0.9), f(1, 7, 100, 0.9)];
    expect(peakOf(tied)!.snapshotId).toBe(1);
  });
});

describe('thinClimb', () => {
  const climb = night.slice(0, 9); // ids 1..9
  it('keeps everything when before ≥ P', () => {
    expect(ids(thinClimb(climb, 9).kept)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(thinClimb(climb, 12).dropped).toEqual([]);
  });
  it('keeps the frame nearest the peak and spreads the rest evenly', () => {
    expect(ids(thinClimb(climb, 3).kept)).toEqual([1, 5, 9]);
    expect(ids(thinClimb(climb, 1).kept)).toEqual([9]);
    expect(ids(thinClimb(climb, 0).kept)).toEqual([]);
    expect(ids(thinClimb(climb, 4).kept)).toEqual([1, 4, 6, 9]); // round(8 − j·8/3): 8, 5.33→5, 2.67→3, 0
    expect(ids(thinClimb(climb, 3).dropped)).toEqual([2, 3, 4, 6, 7, 8]);
  });
});

describe('windowAround', () => {
  const peak = night[9];
  it('by default the climb comes first and the cap\'s remainder plays after the peak', () => {
    const w = windowAround(night, peak, 8);
    expect(ids(w.frames)).toEqual([3, 4, 5, 6, 7, 8, 9, 10]); // before = min(9, 7) = 7 (newest 7 of the climb), after = 0
    expect(w.dropped).toEqual([]);
    const wide = windowAround(night, peak, 16);
    expect(ids(wide.frames)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]); // the whole night
  });
  it('with an explicit before, thins the climb and hands the rest to after', () => {
    const w = windowAround(night, peak, 8, 3);
    expect(ids(w.frames)).toEqual([1, 5, 9, 10, 11, 12, 13]); // 3 climb + peak + min(3, 8 − 1 − 3 = 4) after
    expect(ids(w.dropped)).toEqual([2, 3, 4, 6, 7, 8]);
    expect(ids(windowAround(night, peak, 8, 0).frames)).toEqual([10, 11, 12, 13]);
  });
  it('the peak always plays; before is clamped to the climb and the cap', () => {
    expect(ids(windowAround(night, peak, 1).frames)).toEqual([10]);
    expect(ids(windowAround(night, peak, 4, 99).frames)).toEqual([1, 5, 9, 10]);
  });
});

describe('fitNext', () => {
  const pool = [...night, f(20, 8, 1000, 0.3), f(21, 8, 1100, 0.35)]; // camera 8 is the weaker sunset
  const mine = (over: Partial<MySide<RunEntry>> = {}): MySide<RunEntry> =>
    ({ t0Ms: T0, queue: [night[12]], entries: pool, role: 'peak', ending: null, ...over });

  it('not eligible → plain, with the default window and no peak pinned', () => {
    for (const m of [
      mine({ role: 'valley' }),
      mine({ queue: [f(30, 9, 500, null)], entries: [...pool, f(30, 9, 500, null)] }), // no peak
    ]) {
      const dec = fitNext(m, { peakAtMs: null }, D);
      expect(dec.kind).toBe('plain');
      expect(dec.peakAtMs).toBeNull();
    }
    expect(fitNext(mine(), { peakAtMs: null }, { ...D, rendezvous: false }).kind).toBe('plain');
  });

  it('a weak sunset is still eligible: rank gates nothing (scheduler spec §3)', () => {
    // Camera 8 is the weakest sunset present — qualityRank 0 — and used to be
    // excluded by rendezvousRank 0.6. Participation no longer looks at rank.
    const dec = fitNext(mine({ queue: [pool[13]] }), { peakAtMs: null }, D);
    expect(dec.kind).toBe('pin');
  });

  it('every drawing decision names the camera it chose', () => {
    // The advance commits this to the screen row and stamps these frames shown,
    // so a decision that drew something other than the queue's head has to say
    // so rather than let the caller assume it knows.
    const dec = fitNext(mine(), { peakAtMs: null }, D);
    expect(dec.kind).toBe('pin');
    if (dec.kind === 'grow') return;
    expect(dec.pick.webcamId).toBe(7);
  });

  it('eligible with nothing to meet → pin at the full climb', () => {
    const dec = fitNext(mine(), { peakAtMs: null }, D);
    expect(dec.kind).toBe('pin');
    if (dec.kind !== 'pin') return;
    expect(ids(dec.frames)).toEqual([3, 4, 5, 6, 7, 8, 9, 10]);
    expect(dec.peakAtMs).toBe(T0 + beat(1 + 7)); // change + 7 climb frames
  });

  it('eligible with a reachable partner peak → fit: the climb thinned so the peak lands on that tick', () => {
    const T = T0 + beat(1 + 3);
    const dec = fitNext(mine(), { peakAtMs: T }, D);
    expect(dec.kind).toBe('fit');
    if (dec.kind !== 'fit') return;
    expect(ids(dec.frames)).toEqual([1, 5, 9, 10, 11, 12, 13]);
    expect(ids(dec.dropped)).toEqual([2, 3, 4, 6, 7, 8]);
    expect(dec.peakAtMs).toBe(T);
    // avail 0: the peak is the first frame after the change
    const first = fitNext(mine(), { peakAtMs: T0 + beat(1) }, D);
    expect(first.kind).toBe('fit');
    if (first.kind === 'fit') expect(ids(first.frames)).toEqual([10, 11, 12, 13]);
  });

  it('a partner peak already passed, or inside the change beat → no fit, too soon', () => {
    for (const T of [T0 - beat(1), T0, T0 + 2_000]) {
      const dec = fitNext(mine(), { peakAtMs: T }, D);
      expect(dec.kind).toBe('nofit');
      if (dec.kind === 'nofit') { expect(dec.why).toBe('too soon'); expect(ids(dec.frames)).toEqual([3, 4, 5, 6, 7, 8, 9, 10]); }
    }
  });

  it('a partner peak beyond the climb → grow the ending run by the difference, from its own series', () => {
    const T = T0 + beat(1 + 9); // needs 9 before the peak; the cap allows 7
    const ending = [f(40, 9, 100, null), f(41, 9, 200, null), f(42, 9, 300, 0.5), f(43, 9, 400, null), f(44, 9, 500, null), f(45, 9, 600, null)];
    const dec = fitNext(mine({ entries: [...pool, ...ending], ending: { webcamId: 9, lastShownId: 42 } }), { peakAtMs: T }, D);
    expect(dec.kind).toBe('grow');
    if (dec.kind === 'grow') expect(ids(dec.add)).toEqual([43, 44]);
  });

  it('… or no fit, nothing to add, when the ending camera has no more frames', () => {
    const T = T0 + beat(1 + 9);
    const ending = [f(40, 9, 100, null), f(41, 9, 200, 0.5)];
    const dec = fitNext(mine({ entries: [...pool, ...ending], ending: { webcamId: 9, lastShownId: 41 } }), { peakAtMs: T }, D);
    expect(dec.kind).toBe('nofit');
    if (dec.kind === 'nofit') expect(dec.why).toBe('nothing to add');
    expect(fitNext(mine({ ending: null }), { peakAtMs: T }, D).kind).toBe('nofit');
  });

  it('the cap applies to a fit: after takes what is left', () => {
    const dec = fitNext(mine(), { peakAtMs: T0 + beat(1 + 6) }, { ...D, runFramesSunset: 8 });
    if (dec.kind !== 'fit') throw new Error(dec.kind);
    expect(dec.frames).toHaveLength(8); // 6 + peak + 1
  });
});
