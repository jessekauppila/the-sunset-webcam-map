import { describe, it, expect } from 'vitest';
import {
  createMotionState,
  commit,
  sample,
  staggerKeys,
  isSettled,
  type MotionConfig,
  type MotionTarget,
} from './motion';

const CFG: MotionConfig = {
  mode: 'tween',
  order: 'none',
  durationMs: 1000,
  staggerMs: 0,
  waveGridMs: 0,
};

const cfg = (over: Partial<MotionConfig> = {}): MotionConfig => ({ ...CFG, ...over });

const target = (id: number, over: Partial<MotionTarget> = {}): MotionTarget => ({
  id,
  x: 0,
  y: 0,
  width: 100,
  height: 75,
  lat: 45,
  ...over,
});

const CTX = { panelWidth: 1080, panelSlot: 0 as const };

const byId = <T extends { id: number }>(frames: T[]) =>
  new Map(frames.map((f) => [f.id, f] as const));

describe('motion — tween', () => {
  it('starts a new tile transparent and inset, then settles on the target', () => {
    const s = createMotionState();
    commit(s, [target(1, { x: 200, y: 100 })], cfg(), 0, CTX);

    const first = sample(s, 0, 16, cfg())[0];
    expect(first.opacity).toBe(0);
    expect(first.width).toBeLessThan(100);

    const settled = sample(s, 1000, 16, cfg())[0];
    expect(settled).toMatchObject({ x: 200, y: 100, width: 100, height: 75 });
    expect(settled.opacity).toBe(1);
  });

  it('travels between two layouts rather than jumping', () => {
    const s = createMotionState();
    commit(s, [target(1, { x: 0 })], cfg(), 0, CTX);
    sample(s, 1000, 16, cfg());

    commit(s, [target(1, { x: 400 })], cfg(), 1000, CTX);
    const mid = sample(s, 1500, 16, cfg())[0];
    expect(mid.x).toBeGreaterThan(0);
    expect(mid.x).toBeLessThan(400);

    const end = sample(s, 2000, 16, cfg())[0];
    expect(end.x).toBe(400);
  });

  it('fades a dropped tile out and then forgets it', () => {
    const s = createMotionState();
    commit(s, [target(1), target(2, { x: 200 })], cfg(), 0, CTX);
    sample(s, 1000, 16, cfg());

    commit(s, [target(1)], cfg(), 1000, CTX);
    const mid = byId(sample(s, 1400, 16, cfg()));
    expect(mid.has(2)).toBe(true);

    const after = byId(sample(s, 2000, 16, cfg()));
    expect(after.has(2)).toBe(false);
    expect(after.has(1)).toBe(true);
  });
});

describe('motion — cut', () => {
  it('lands on the target with no travel, matching the old canvas', () => {
    const s = createMotionState();
    commit(s, [target(1, { x: 300 })], cfg({ mode: 'cut' }), 0, CTX);
    const f = sample(s, 0, 16, cfg({ mode: 'cut' }))[0];
    expect(f).toMatchObject({ x: 300, width: 100, opacity: 1 });
  });
});

describe('motion — drift', () => {
  it('closes most of the gap in one time constant and never overshoots', () => {
    const s = createMotionState();
    const c = cfg({ mode: 'drift', durationMs: 1000 });
    commit(s, [target(1, { x: 0 })], c, 0, CTX);
    sample(s, 0, 1000, c); // settle the entry

    commit(s, [target(1, { x: 1000 })], c, 0, CTX);
    const step = sample(s, 100, 100, c)[0];
    expect(step.x).toBeGreaterThan(0);
    expect(step.x).toBeLessThan(1000);

    const later = sample(s, 1000, 900, c)[0];
    expect(later.x).toBeGreaterThan(900);
    expect(later.x).toBeLessThanOrEqual(1000);
  });

  it('moves imperceptibly over one frame when the time constant is long', () => {
    const s = createMotionState();
    const c = cfg({ mode: 'drift', durationMs: 30_000 });
    commit(s, [target(1, { x: 0 })], c, 0, CTX);
    sample(s, 0, 60_000, c);

    commit(s, [target(1, { x: 200 })], c, 0, CTX);
    const oneFrame = sample(s, 16, 16, c)[0];
    expect(oneFrame.x).toBeLessThan(1);
  });
});

describe('staggerKeys', () => {
  it('gives every tile the same key when ordering is off', () => {
    const keys = staggerKeys(
      [target(1, { lat: 60 }), target(2, { lat: 10 })],
      createMotionState(),
      'none',
      CTX
    );
    expect([...keys.values()]).toEqual([0, 0]);
  });

  it('leads with the northernmost tile for latitude ordering', () => {
    const keys = staggerKeys(
      [target(1, { lat: 60 }), target(2, { lat: 10 })],
      createMotionState(),
      'latitude',
      CTX
    );
    expect(keys.get(1)).toBe(0);
    expect(keys.get(2)).toBe(1);
  });

  it('spans a sweep across both panels rather than restarting on each', () => {
    // The sunrise panel owns the first half of the wave, the sunset panel the
    // second. Without this the wall runs two waves side by side.
    const sunrise = staggerKeys(
      [target(1, { x: 0, width: 0 }), target(2, { x: 1080, width: 0 })],
      createMotionState(),
      'sweep',
      { panelWidth: 1080, panelSlot: 0 }
    );
    const sunset = staggerKeys(
      [target(3, { x: 0, width: 0 }), target(4, { x: 1080, width: 0 })],
      createMotionState(),
      'sweep',
      { panelWidth: 1080, panelSlot: 1 }
    );
    expect(sunrise.get(1)).toBe(0);
    expect(sunrise.get(2)).toBe(0.5);
    expect(sunset.get(3)).toBe(0.5);
    expect(sunset.get(4)).toBe(1);
  });

  it('leads with the furthest traveller for magnitude ordering', () => {
    const s = createMotionState();
    commit(s, [target(1, { x: 0 }), target(2, { x: 0 })], cfg(), 0, CTX);
    sample(s, 1000, 16, cfg());

    const keys = staggerKeys(
      [target(1, { x: 10 }), target(2, { x: 500 })],
      s,
      'magnitude',
      CTX
    );
    expect(keys.get(2)).toBe(0);
    expect(keys.get(1)).toBeGreaterThan(0);
  });
});

describe('sweep phase', () => {
  it('rounds the wave start onto a shared grid so both panels stay in step', () => {
    // Two panels commit 300ms apart. Quantised to a 1000ms grid they still
    // start the same wave, which is what keeps the wall reading as one motion.
    const a = createMotionState();
    const b = createMotionState();
    const c = cfg({ order: 'sweep', staggerMs: 0, waveGridMs: 1000 });

    commit(a, [target(1, { x: 0, width: 0 })], c, 1200, { panelWidth: 1080, panelSlot: 0 });
    commit(b, [target(2, { x: 0, width: 0 })], c, 1500, { panelWidth: 1080, panelSlot: 1 });

    // Neither has begun at t=1900; both are underway at t=2100.
    expect(sample(a, 1900, 16, c)[0].opacity).toBe(0);
    expect(sample(b, 1900, 16, c)[0].opacity).toBe(0);
    expect(sample(a, 2100, 16, c)[0].opacity).toBeGreaterThan(0);
    expect(sample(b, 2100, 16, c)[0].opacity).toBeGreaterThan(0);
  });

  it('spreads start times across the stagger span', () => {
    const s = createMotionState();
    const c = cfg({ order: 'sweep', staggerMs: 2000, waveGridMs: 0 });
    commit(
      s,
      [target(1, { x: 0, width: 0 }), target(2, { x: 1080, width: 0 })],
      c,
      0,
      { panelWidth: 1080, panelSlot: 0 }
    );
    // Tile 1 has key 0 and is already moving; tile 2 has key 0.5, so its start
    // is 1000ms out and it has not begun.
    const frames = byId(sample(s, 500, 16, c));
    expect(frames.get(1)!.opacity).toBeGreaterThan(0);
    expect(frames.get(2)!.opacity).toBe(0);
  });
});

describe('isSettled', () => {
  it('reports unsettled mid-tween and settled after it', () => {
    const s = createMotionState();
    commit(s, [target(1)], cfg(), 0, CTX);
    expect(isSettled(s, cfg(), 500)).toBe(false);
    sample(s, 1000, 16, cfg());
    expect(isSettled(s, cfg(), 1000)).toBe(true);
  });
});
