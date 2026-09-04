import { describe, it, expect } from 'vitest';
import {
  createMotionState,
  commit,
  sample,
  staggerKeys,
  scatterKey,
  isSettled,
  nextEventAt,
  type MotionConfig,
  type MotionTarget,
} from './motion';

const CFG: MotionConfig = {
  mode: 'tween',
  order: 'none',
  durationMs: 1000,
  spreadMs: 0,
  waveGridMs: 0,
  transition: 'dissolve',
  fadeMs: 1000,
  fadeScale: 0.85,
  gapPx: 0,
};

const cfg = (over: Partial<MotionConfig> = {}): MotionConfig => ({ ...CFG, ...over });

const target = (id: number, over: Partial<MotionTarget> = {}): MotionTarget => ({
  id, x: 0, y: 0, width: 100, height: 75, lat: 45, ...over,
});

const CTX = { panelWidth: 1080, panelSlot: 0 as const };

const byId = <T extends { id: number }>(frames: T[]) =>
  new Map(frames.map((f) => [f.id, f] as const));

/** Run an entry to completion so a later commit is a retarget, not a mid-entry update. */
function settle(s: ReturnType<typeof createMotionState>, c: MotionConfig, now: number) {
  sample(s, now, 16, c);
}

describe('motion — entry and exit fades', () => {
  it('enters from fadeScale and transparent, then lands full size and opaque', () => {
    const s = createMotionState();
    commit(s, [target(1, { x: 200, y: 100 })], cfg(), 0, CTX);

    // Transparent frames are not drawn, so t=0 yields nothing.
    expect(sample(s, 0, 16, cfg())).toEqual([]);

    const mid = sample(s, 500, 16, cfg())[0];
    expect(mid.width).toBeGreaterThan(85);
    expect(mid.width).toBeLessThan(100);
    expect(mid.opacity).toBeGreaterThan(0);
    expect(mid.opacity).toBeLessThan(1);

    const done = sample(s, 1000, 16, cfg())[0];
    expect(done).toMatchObject({ x: 200, y: 100, width: 100, height: 75, opacity: 1 });
  });

  it('uses fadeMs for the entry, not durationMs', () => {
    const s = createMotionState();
    const c = cfg({ durationMs: 10, fadeMs: 2000 });
    commit(s, [target(1)], c, 0, CTX);
    expect(sample(s, 1000, 16, c)[0].opacity).toBeLessThan(1);
    expect(sample(s, 2000, 16, c)[0].opacity).toBe(1);
  });

  it('exits by shrinking about its centre to fadeScale while fading, then is forgotten', () => {
    const s = createMotionState();
    commit(s, [target(1, { x: 100, y: 100 }), target(2, { x: 400 })], cfg(), 0, CTX);
    settle(s, cfg(), 1000);

    commit(s, [target(2, { x: 400 })], cfg(), 1000, CTX);
    const mid = byId(sample(s, 1500, 16, cfg())).get(1)!;
    expect(mid.opacity).toBeGreaterThan(0);
    expect(mid.opacity).toBeLessThan(1);
    expect(mid.width).toBeLessThan(100);
    expect(mid.width).toBeGreaterThan(85);
    // Centre held: x + width/2 stays at 150.
    expect(mid.x + mid.width / 2).toBeCloseTo(150, 6);

    const after = byId(sample(s, 2000, 16, cfg()));
    expect(after.has(1)).toBe(false);
    expect(after.has(2)).toBe(true);
  });

  it('exits as a tween even in drift mode', () => {
    const s = createMotionState();
    const c = cfg({ mode: 'drift', durationMs: 60_000 });
    commit(s, [target(1)], c, 0, CTX);
    settle(s, c, 1000);
    commit(s, [], c, 1000, CTX);
    // A 60s drift constant would barely move; the exit is done at fadeMs.
    expect(byId(sample(s, 2000, 16, c)).has(1)).toBe(false);
  });

  it('cancels an exit when the tile comes back', () => {
    const s = createMotionState();
    commit(s, [target(1)], cfg(), 0, CTX);
    settle(s, cfg(), 1000);
    commit(s, [], cfg(), 1000, CTX);
    sample(s, 1500, 16, cfg()); // half faded
    commit(s, [target(1)], cfg(), 1500, CTX);
    const back = sample(s, 2500, 16, cfg())[0];
    expect(back).toMatchObject({ width: 100, opacity: 1 });
  });
});

describe('motion — travel', () => {
  it('tweens a retarget between two layouts rather than jumping', () => {
    const s = createMotionState();
    commit(s, [target(1, { x: 0 })], cfg(), 0, CTX);
    settle(s, cfg(), 1000);

    commit(s, [target(1, { x: 400 })], cfg(), 1000, CTX);
    const mid = sample(s, 1500, 16, cfg())[0];
    expect(mid.x).toBeGreaterThan(0);
    expect(mid.x).toBeLessThan(400);
    expect(sample(s, 2000, 16, cfg())[0].x).toBe(400);
  });

  it('cut lands on the target with no travel', () => {
    const s = createMotionState();
    const c = cfg({ mode: 'cut' });
    commit(s, [target(1, { x: 300 })], c, 0, CTX);
    expect(sample(s, 0, 16, c)[0]).toMatchObject({ x: 300, width: 100, opacity: 1 });
  });

  it('drift closes most of the gap in one time constant and never overshoots', () => {
    const s = createMotionState();
    const c = cfg({ mode: 'drift', durationMs: 1000 });
    commit(s, [target(1, { x: 0 })], c, 0, CTX);
    settle(s, c, 1000);

    commit(s, [target(1, { x: 1000 })], c, 1000, CTX);
    const step = sample(s, 1100, 100, c)[0];
    expect(step.x).toBeGreaterThan(0);
    expect(step.x).toBeLessThan(1000);
    const later = sample(s, 2000, 900, c)[0];
    expect(later.x).toBeGreaterThan(900);
    expect(later.x).toBeLessThanOrEqual(1000);
  });

  it('a retarget during an entry just redirects the entry', () => {
    const s = createMotionState();
    commit(s, [target(1, { x: 0 })], cfg(), 0, CTX);
    commit(s, [target(1, { x: 200 })], cfg(), 200, CTX);
    // The redirect restarts the fade from wherever the entry currently is
    // (fix round 2, finding 1): it needs a full fadeMs from t=200, not from
    // the original entry's t=0, so it lands at t=1200, not t=1000.
    const done = sample(s, 1200, 16, cfg())[0];
    expect(done).toMatchObject({ x: 200, opacity: 1 });
  });
});

describe('scatter', () => {
  it('keys are deterministic, in [0,1), and differ across ids', () => {
    expect(scatterKey(1234)).toBe(scatterKey(1234));
    const keys = [1, 2, 3, 1000, 1001, 1002].map(scatterKey);
    for (const k of keys) {
      expect(k).toBeGreaterThanOrEqual(0);
      expect(k).toBeLessThan(1);
    }
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('is the ordering staggerKeys uses for scatter', () => {
    const keys = staggerKeys([target(7), target(8)], createMotionState(), 'scatter', CTX);
    expect(keys.get(7)).toBe(scatterKey(7));
    expect(keys.get(8)).toBe(scatterKey(8));
  });

  it('none still gives every tile key 0', () => {
    const keys = staggerKeys([target(1), target(2)], createMotionState(), 'none', CTX);
    expect([...keys.values()]).toEqual([0, 0]);
  });
});

describe('spread — the delay every change waits', () => {
  it('reports each tile\'s delay as key × spreadMs', () => {
    const s = createMotionState();
    const c = cfg({ order: 'scatter', spreadMs: 60_000 });
    const delays = commit(s, [target(5)], c, 0, CTX);
    expect(delays.get(5)).toBeCloseTo(scatterKey(5) * 60_000, 6);
  });

  it('holds a retarget until its delay in drift mode — stagger is no longer inert there', () => {
    const s = createMotionState();
    // Populate with no spread so both entries finish by t=1000, then
    // retarget under the staggered config so only the retarget is delayed.
    const plain = cfg({ mode: 'drift', durationMs: 100 });
    commit(s, [target(1, { x: 0, lat: 60 }), target(2, { x: 0, lat: 10 })], plain, 0, CTX);
    settle(s, plain, 1000);

    const c = cfg({ mode: 'drift', durationMs: 100, order: 'latitude', spreadMs: 2000 });
    // Tile 1 (north) has key 0, tile 2 key 1: its move waits 2000ms.
    commit(s, [target(1, { x: 500, lat: 60 }), target(2, { x: 500, lat: 10 })], c, 1000, CTX);
    const early = byId(sample(s, 1500, 500, c));
    expect(early.get(1)!.x).toBeGreaterThan(0);
    expect(early.get(2)!.x).toBe(0);
    const late = byId(sample(s, 3500, 500, c));
    expect(late.get(2)!.x).toBeGreaterThan(0);
  });

  it('delays an exit by the same rule, and freezes the tile until then', () => {
    const s = createMotionState();
    const c = cfg({ order: 'scatter', spreadMs: 100_000 });
    commit(s, [target(1), target(2, { x: 300 })], c, 0, CTX);
    settle(s, c, 100_000); // both entries long finished

    commit(s, [target(1)], c, 100_000, CTX);
    const delay = scatterKey(2) * 100_000;
    // Frozen and opaque right up to its moment...
    const before = byId(sample(s, 100_000 + delay - 1, 16, c)).get(2)!;
    expect(before).toMatchObject({ x: 300, width: 100, opacity: 1 });
    // ...fading after it, gone at its end.
    const during = byId(sample(s, 100_000 + delay + 500, 16, c)).get(2)!;
    expect(during.opacity).toBeLessThan(1);
    expect(byId(sample(s, 100_000 + delay + 1000, 16, c)).has(2)).toBe(false);
  });

  it('sweep still rounds the wave start onto the shared grid', () => {
    const a = createMotionState();
    const b = createMotionState();
    const c = cfg({ order: 'sweep', spreadMs: 0, waveGridMs: 1000 });
    commit(a, [target(1, { x: 0, width: 0 })], c, 1200, { panelWidth: 1080, panelSlot: 0 });
    commit(b, [target(2, { x: 0, width: 0 })], c, 1500, { panelWidth: 1080, panelSlot: 1 });
    expect(sample(a, 1900, 16, c)).toEqual([]);
    expect(sample(b, 1900, 16, c)).toEqual([]);
    expect(sample(a, 2100, 16, c)[0].opacity).toBeGreaterThan(0);
    expect(sample(b, 2100, 16, c)[0].opacity).toBeGreaterThan(0);
  });
});

describe('fade-through — two cameras never share pixels', () => {
  const FT = cfg({ transition: 'fadeThrough' });

  it('makes an entry wait for the departing tile it would overlap', () => {
    const s = createMotionState();
    commit(s, [target(1, { x: 100, y: 100 })], FT, 0, CTX);
    settle(s, FT, 1000);

    // Tile 2 arrives exactly where tile 1 is leaving.
    commit(s, [target(2, { x: 100, y: 100 })], FT, 1000, CTX);
    const mid = byId(sample(s, 1500, 16, FT));
    expect(mid.has(1)).toBe(true);
    expect(mid.has(2)).toBe(false);

    // Exit ends at 2000; entry runs 2000..3000.
    const later = byId(sample(s, 2500, 16, FT));
    expect(later.has(1)).toBe(false);
    expect(later.get(2)!.opacity).toBeGreaterThan(0);
    expect(later.get(2)!.opacity).toBeLessThan(1);
  });

  it("makes a STAYING tile wait before travelling into a departing tile's pixels", () => {
    const s = createMotionState();
    commit(s, [target(1, { x: 0, y: 100 }), target(2, { x: 300, y: 100 })], FT, 0, CTX);
    settle(s, FT, 1000);

    // Tile 2 departs; tile 1 (which stays) is retargeted into the pixels
    // tile 2 currently occupies.
    commit(s, [target(1, { x: 300, y: 100 })], FT, 1000, CTX);
    const mid = byId(sample(s, 1500, 16, FT));
    expect(mid.get(1)!.x).toBe(0);
    expect(mid.has(2)).toBe(true);

    // Exit ends at 2000; tile 1's held retarget starts then.
    const later = byId(sample(s, 2500, 16, FT));
    expect(later.has(2)).toBe(false);
    expect(later.get(1)!.x).toBeGreaterThan(0);
  });

  it('does not make an entry wait for a departure it would not touch', () => {
    const s = createMotionState();
    commit(s, [target(1, { x: 100, y: 100 })], FT, 0, CTX);
    settle(s, FT, 1000);
    commit(s, [target(2, { x: 800, y: 600 })], FT, 1000, CTX);
    const mid = byId(sample(s, 1500, 16, FT));
    expect(mid.has(1)).toBe(true);
    expect(mid.get(2)!.opacity).toBeGreaterThan(0);
  });

  it('counts the gap as overlap', () => {
    const s = createMotionState();
    const c = cfg({ transition: 'fadeThrough', gapPx: 10 });
    commit(s, [target(1, { x: 0, y: 0 })], c, 0, CTX);
    settle(s, c, 1000);
    // 5px clear of tile 1, inside the 10px gap.
    commit(s, [target(2, { x: 105, y: 0 })], c, 1000, CTX);
    expect(byId(sample(s, 1500, 16, c)).has(2)).toBe(false);
  });

  it('dissolve lets both run at once', () => {
    const s = createMotionState();
    const c = cfg({ transition: 'dissolve' });
    commit(s, [target(1, { x: 100, y: 100 })], c, 0, CTX);
    settle(s, c, 1000);
    commit(s, [target(2, { x: 100, y: 100 })], c, 1000, CTX);
    const mid = byId(sample(s, 1500, 16, c));
    expect(mid.has(1)).toBe(true);
    expect(mid.has(2)).toBe(true);
  });

  it('PROPERTY: over a whole replacement, no two drawn frames ever intersect', () => {
    const s = createMotionState();
    const c = cfg({ transition: 'fadeThrough', order: 'scatter', spreadMs: 700 });
    commit(s, [target(1, { x: 100, y: 100 }), target(3, { x: 100, y: 300 })], c, 0, CTX);
    settle(s, c, 1000);
    commit(s, [target(2, { x: 120, y: 110 }), target(4, { x: 90, y: 320 })], c, 1000, CTX);
    for (let now = 1000; now <= 6000; now += 16) {
      const frames = sample(s, now, 16, c);
      for (let i = 0; i < frames.length; i++) {
        for (let j = i + 1; j < frames.length; j++) {
          const a = frames[i], b = frames[j];
          const clear =
            a.x + a.width <= b.x || b.x + b.width <= a.x ||
            a.y + a.height <= b.y || b.y + b.height <= a.y;
          expect(`${now}: ${a.id} vs ${b.id} clear=${clear}`).toBe(`${now}: ${a.id} vs ${b.id} clear=true`);
        }
      }
    }
  });

  it('PROPERTY: a staying tile retargeted into a leaver waits too', () => {
    const s = createMotionState();
    // Populate with no spread so both tiles are fully settled by t=1000 —
    // otherwise tile 1's own entry could still be running when the retarget
    // lands, which is a different code path (a mid-entry redirect) than the
    // "staying, already-settled tile" case this test targets.
    const unstaggered = cfg({ transition: 'fadeThrough' });
    commit(s, [target(1, { x: 100, y: 100 }), target(2, { x: 400, y: 100 })], unstaggered, 0, CTX);
    settle(s, unstaggered, 1000);

    const c = cfg({ transition: 'fadeThrough', order: 'scatter', spreadMs: 700 });
    // Tile 2 departs; tile 1 (a stayer) is retargeted into its pixels.
    commit(s, [target(1, { x: 400, y: 100 })], c, 1000, CTX);
    for (let now = 1000; now <= 6000; now += 16) {
      const frames = sample(s, now, 16, c);
      for (let i = 0; i < frames.length; i++) {
        for (let j = i + 1; j < frames.length; j++) {
          const a = frames[i], b = frames[j];
          const clear =
            a.x + a.width <= b.x || b.x + b.width <= a.x ||
            a.y + a.height <= b.y || b.y + b.height <= a.y;
          expect(`${now}: ${a.id} vs ${b.id} clear=${clear}`).toBe(`${now}: ${a.id} vs ${b.id} clear=true`);
        }
      }
    }
  });
});

describe('isSettled and nextEventAt', () => {
  it('is unsettled mid-fade and settled after it', () => {
    const s = createMotionState();
    commit(s, [target(1)], cfg(), 0, CTX);
    expect(isSettled(s, cfg(), 500)).toBe(false);
    sample(s, 1000, 16, cfg());
    expect(isSettled(s, cfg(), 1000)).toBe(true);
  });

  it('is settled while a change is still waiting for its delay, and knows when it starts', () => {
    const s = createMotionState();
    const c = cfg({ order: 'latitude', spreadMs: 5000 });
    commit(s, [target(1, { lat: 60 }), target(2, { lat: 10 })], c, 0, CTX);
    sample(s, 1000, 16, c); // tile 1 entered; tile 2 waits until 5000
    expect(isSettled(s, c, 1000)).toBe(true);
    expect(nextEventAt(s, 1000)).toBe(5000);
    expect(isSettled(s, c, 5500)).toBe(false);
  });

  it('reports no event when nothing is scheduled', () => {
    const s = createMotionState();
    commit(s, [target(1)], cfg(), 0, CTX);
    sample(s, 1000, 16, cfg());
    expect(nextEventAt(s, 1000)).toBeNull();
  });

  it('stays unsettled through a mid-travel retarget', () => {
    const s = createMotionState();
    // Populate and take the first retarget with no spread, so the tile is
    // cleanly mid-travel by t=6000 with no unrelated delay to account for.
    const settled = cfg({ durationMs: 30_000, order: 'scatter', spreadMs: 0 });
    commit(s, [target(1, { x: 0 })], settled, 0, CTX);
    settle(s, settled, 1000); // entry (fadeMs 1000) completes

    commit(s, [target(1, { x: 900 })], settled, 1000, CTX); // starts at once
    sample(s, 6000, 16, settled); // 5s into the 30s travel — still moving

    // The next poll retargets the SAME tile to the SAME place, but under the
    // staggered config: this still queues a pending retarget (commit doesn't
    // know the target is unchanged), due well after now.
    const c = cfg({ durationMs: 30_000, order: 'scatter', spreadMs: 60_000 });
    commit(s, [target(1, { x: 900 })], c, 6000, CTX);
    expect(isSettled(s, c, 6000)).toBe(false);
  });

  it('nextEventAt reports a pending retarget', () => {
    const s = createMotionState();
    // Populate with no stagger so both tiles are fully settled by t=1000.
    const plain = cfg({ order: 'none' });
    commit(s, [target(1, { lat: 60 }), target(2, { lat: 10 })], plain, 0, CTX);
    settle(s, plain, 1000);

    const c = cfg({ order: 'latitude', spreadMs: 5000 });
    // Tile 1 (north) has key 0, so its retarget is due at once; tile 2
    // (south) has key 1, so its pending waits until 1000 + 5000 = 6000.
    commit(s, [target(1, { x: 500, lat: 60 }), target(2, { x: 500, lat: 10 })], c, 1000, CTX);
    expect(nextEventAt(s, 1000)).toBe(6000);
  });

  it('cut is always settled', () => {
    const s = createMotionState();
    const c = cfg({ mode: 'cut' });
    commit(s, [target(1)], c, 0, CTX);
    expect(isSettled(s, c, 0)).toBe(true);
  });
});
