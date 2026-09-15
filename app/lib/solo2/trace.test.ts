import { describe, it, expect } from 'vitest';
import { schemaDefaults } from '@/app/lib/settings/schema';
import { choosePool } from '@/app/lib/solo/engine';
import type { BinEntry, ScreenState } from '@/app/lib/solo/types';
import { next2, project2 } from './engine';
import { SOLO2_SETTINGS_SCHEMA, dialsFrom2 } from './settingsSchema';
import { traceDraw } from './trace';
import type { Solo2Dials } from './types';

const D: Solo2Dials = { ...dialsFrom2(schemaDefaults(SOLO2_SETTINGS_SCHEMA)), cameraRun: false };
const S0: ScreenState = { lastSnapshotId: null, sunsetStreak: 0 };

function sun(id: number, q: number, extra: Partial<BinEntry> = {}): BinEntry {
  return { snapshotId: id, webcamId: 1000 + id, bin: 'sunset', quality: q, detection: 0.9,
    isNew: false, tally: 0, enteredAt: id, lastShownAt: null, lastShownSlot: null, ...extra };
}
function non(id: number, det: number, extra: Partial<BinEntry> = {}): BinEntry {
  return { snapshotId: id, webcamId: 2000 + id, bin: 'non_sunset', quality: null, detection: det,
    isNew: false, tally: 0, enteredAt: id, lastShownAt: null, lastShownSlot: null, ...extra };
}
const ids = (xs: { snapshotId: number }[]) => xs.map((x) => x.snapshotId);
const step = (t: ReturnType<typeof traceDraw>, rule: number) => t.steps.find((s) => s.rule === rule)!;

describe('traceDraw agrees with the engine', () => {
  it('pick is next2 and the last step is choosePool, over seeded random pools', () => {
    let seed = 7;
    const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    for (let n = 0; n < 200; n++) {
      const entries: BinEntry[] = [];
      const count = 2 + Math.floor(rand() * 10);
      for (let i = 1; i <= count; i++) {
        const shown = rand() < 0.5;
        const slot = shown ? Math.floor(rand() * 8) : null;
        const extra: Partial<BinEntry> = {
          tally: shown ? 1 + Math.floor(rand() * 3) : 0,
          lastShownAt: slot == null ? null : slot * 1000,
          lastShownSlot: slot,
          isNew: rand() < 0.3,
        };
        entries.push(rand() < 0.6 ? sun(i, Math.round(rand() * 100) / 100, extra) : non(i, Math.round(rand() * 100) / 100, extra));
      }
      const d: Solo2Dials = {
        ...D,
        ratingFloor: 1 + rand() * 3,
        detectionFloor: rand() * 0.6,
        sunsetFloor: Math.floor(rand() * 6),
        mix: 1 + Math.floor(rand() * 3),
        rest: Math.floor(rand() * 5),
        valleys: Math.floor(rand() * 3),
        screens: rand() < 0.5 ? 'together' : 'alternate',
        promoteNew: rand() < 0.5,
      };
      const state: ScreenState = {
        lastSnapshotId: rand() < 0.5 ? entries[0].snapshotId : null,
        sunsetStreak: Math.floor(rand() * 4),
      };
      const slot = Math.floor(rand() * 10);
      const feed = rand() < 0.5 ? 'sunrise' : 'sunset';
      const t = traceDraw(entries, d, state, slot, feed);
      const want = next2(entries, d, state, slot, feed);
      expect(t.pick?.snapshotId ?? null).toBe(want?.snapshotId ?? null);
      expect(t.steps[t.steps.length - 1].kept).toEqual(ids(choosePool(entries, d, state, slot)));
      expect([...ids(t.sorted.map((r) => r.entry))].sort()).toEqual([...t.steps[t.steps.length - 1].kept].sort());
    }
  });

  it('stepping with project2 and tracing each slot give the same draws', () => {
    const entries = [sun(1, 0.9), sun(2, 0.8), sun(3, 0.7), non(4, 0.6), non(5, 0.5)];
    const d = { ...D, sunsetFloor: 2, mix: 2, rest: 1 };
    const draws = project2(entries, d, S0, 6, 1, 'sunrise');
    // Walk the same way the lab does: apply each traced pick by hand.
    const working = entries.map((e) => ({ ...e }));
    let s = S0;
    const got: number[] = [];
    for (let i = 0; i < 6; i++) {
      const t = traceDraw(working, d, s, 1 + i, 'sunrise');
      got.push(t.pick!.snapshotId);
      const p = working.find((e) => e.snapshotId === t.pick!.snapshotId)!;
      p.tally += 1; p.isNew = false; p.lastShownAt = i; p.lastShownSlot = 1 + i;
      s = { lastSnapshotId: p.snapshotId, sunsetStreak: p.bin === 'sunset' ? s.sunsetStreak + 1 : 0 };
    }
    expect(got).toEqual(ids(draws));
  });
});

describe('steps and their reasons', () => {
  it('rule 5 drops under-floor frames with the studio’s own miss text', () => {
    const t = traceDraw([sun(1, 0.9), sun(2, 0.2), non(3, 0.1)], { ...D, ratingFloor: 3, detectionFloor: 0.3 }, S0, 1, 'sunrise');
    const s = step(t, 5);
    expect(s.title).toBe('5 · floors');
    expect(s.kept).toEqual([1]);
    expect(s.dropped).toEqual([
      { snapshotId: 2, why: 'rating 1.8 < 3.0' },
      { snapshotId: 3, why: 'sunset 10% < 30%' },
    ]);
  });

  it('rule 4 drops the frame on glass', () => {
    const t = traceDraw([sun(1, 0.9), sun(2, 0.8)], D, { lastSnapshotId: 1, sunsetStreak: 1 }, 1, 'sunrise');
    expect(step(t, 4).dropped).toEqual([{ snapshotId: 1, why: 'on glass' }]);
    expect(step(t, 4).kept).toEqual([2]);
  });

  it('rule 4 waives itself when the frame on glass is the only one eligible', () => {
    const t = traceDraw([sun(1, 0.9)], D, { lastSnapshotId: 1, sunsetStreak: 1 }, 1, 'sunrise');
    expect(step(t, 4).dropped).toEqual([]);
    expect(step(t, 4).note).toBe('only frame on offer · it repeats');
    expect(t.pick?.snapshotId).toBe(1);
  });

  it('rule 2 drops resting frames and says when they are back', () => {
    const d = { ...D, rest: 4 };
    const t = traceDraw([sun(1, 0.9, { lastShownSlot: 3, lastShownAt: 3 }), sun(2, 0.8)], d, S0, 5, 'sunrise');
    expect(step(t, 2).dropped).toEqual([{ snapshotId: 1, why: 'resting · back in 3 draws' }]);
  });

  it('rule 2 is waived when everything is resting', () => {
    const d = { ...D, rest: 4 };
    const t = traceDraw([sun(1, 0.9, { lastShownSlot: 3, lastShownAt: 3 }), sun(2, 0.8, { lastShownSlot: 4, lastShownAt: 4 })], d, S0, 5, 'sunrise');
    expect(step(t, 2).dropped).toEqual([]);
    expect(step(t, 2).note).toBe('everything resting · rest waived');
  });

  it('rule 1 names the bin decision', () => {
    const pool = [sun(1, 0.9), sun(2, 0.8), non(3, 0.6)];
    expect(step(traceDraw(pool, { ...D, sunsetFloor: 2 }, S0, 1, 'sunrise'), 1).note).toBe('2 sunsets ≥ floor 2 → sunsets');
    expect(step(traceDraw(pool, { ...D, sunsetFloor: 6, mix: 2 }, { lastSnapshotId: null, sunsetStreak: 2 }, 1, 'sunrise'), 1).note)
      .toBe('2 sunsets < floor 6 · streak 2 ≥ mix 2 → non-sunsets');
    expect(step(traceDraw(pool, { ...D, sunsetFloor: 6, mix: 2 }, { lastSnapshotId: null, sunsetStreak: 1 }, 1, 'sunrise'), 1).note)
      .toBe('2 sunsets < floor 6 · streak 1 < mix 2 → sunsets');
    expect(step(traceDraw([non(3, 0.6)], D, S0, 1, 'sunrise'), 1).note).toBe('no sunsets left → non-sunsets');
    expect(step(traceDraw([sun(1, 0.9)], D, S0, 1, 'sunrise'), 1).note).toBe('no non-sunsets left → sunsets');
    expect(step(traceDraw(pool, { ...D, sunsetFloor: 2 }, S0, 1, 'sunrise'), 1).dropped).toEqual([{ snapshotId: 3, why: 'other bin' }]);
  });
});

describe('the sorted column', () => {
  it('names the role on the head and the first deciding comparator on every other row', () => {
    const pool = [
      sun(1, 0.9, { lastShownSlot: 2, lastShownAt: 2 }),
      sun(2, 0.8),
      sun(3, 0.8, { isNew: true }),
      sun(4, 0.5, { lastShownSlot: 1, lastShownAt: 1 }),
    ];
    const t = traceDraw(pool, { ...D, rest: 0, promoteNew: true }, S0, 5, 'sunrise');
    expect(t.role).toBe('peak');
    expect(t.sorted.map((r) => [r.entry.snapshotId, r.key])).toEqual([
      [3, 'peak · best first'],
      [2, 'score 0.80'],
      [4, 'since draw 1'],
      [1, 'since draw 2'],
    ]);
  });

  it('a valley sorts worst first', () => {
    const t = traceDraw([sun(1, 0.9), sun(2, 0.3)], { ...D, valleys: 1 }, S0, 1, 'sunrise');
    expect(t.role).toBe('valley');
    expect(t.sorted.map((r) => r.entry.snapshotId)).toEqual([2, 1]);
    expect(t.sorted[0].key).toBe('valley · worst first');
    expect(t.sorted[1].key).toBe('score 0.90');
  });

  it('ties fall to entered-earlier, then id', () => {
    const t = traceDraw([sun(2, 0.5, { enteredAt: 5 }), sun(1, 0.5, { enteredAt: 5 }), sun(3, 0.5, { enteredAt: 9 })], D, S0, 1, 'sunrise');
    expect(t.sorted.map((r) => [r.entry.snapshotId, r.key])).toEqual([
      [1, 'peak · best first'],
      [2, 'same score · higher id'],
      [3, 'same score · entered later'],
    ]);
  });
});
