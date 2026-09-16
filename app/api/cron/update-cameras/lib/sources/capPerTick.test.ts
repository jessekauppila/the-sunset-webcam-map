import { describe, it, expect } from 'vitest';
import { capCamerasPerTick, SOURCE_MAX_CAMERAS_PER_TICK } from './capPerTick';

const cams = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ externalId: `C${String(i).padStart(4, '0')}` }));

describe('capCamerasPerTick', () => {
  it('passes a list at or under the cap through untouched', () => {
    const list = cams(5);
    const out = capCamerasPerTick(list, new Date('2026-09-16T00:00:00Z'), 10);
    expect(out.cameras).toEqual(list);
    expect(out.dropped).toBe(0);
  });

  it('takes exactly the cap and reports the rest as dropped', () => {
    const out = capCamerasPerTick(cams(2258), new Date('2026-09-16T00:00:00Z'), 120);
    expect(out.cameras).toHaveLength(120);
    expect(out.dropped).toBe(2138);
  });

  it('advances the window one cap-sized step per tick, so no camera is stranded', () => {
    const list = cams(500);
    const t0 = new Date('2026-09-16T00:00:00Z');
    const t1 = new Date(t0.getTime() + 10 * 60 * 1000);
    const a = capCamerasPerTick(list, t0, 120).cameras.map((c) => c.externalId);
    const b = capCamerasPerTick(list, t1, 120).cameras.map((c) => c.externalId);
    expect(a[0]).not.toBe(b[0]);
    expect(new Set([...a, ...b]).size).toBe(240);
  });

  it('covers the whole list within ceil(n / cap) ticks, then wraps', () => {
    const list = cams(500);
    const t0 = new Date('2026-09-16T00:00:00Z');
    const seen = new Set<string>();
    for (let i = 0; i < Math.ceil(500 / 120); i++) {
      const at = new Date(t0.getTime() + i * 10 * 60 * 1000);
      for (const c of capCamerasPerTick(list, at, 120).cameras) seen.add(c.externalId);
    }
    expect(seen.size).toBe(500);
  });

  it('is stable within one tick regardless of the order the source listed', () => {
    const list = cams(500);
    const shuffled = [...list].reverse();
    const at = new Date('2026-09-16T04:20:00Z');
    expect(capCamerasPerTick(list, at, 120).cameras).toEqual(capCamerasPerTick(shuffled, at, 120).cameras);
  });

  it('does not mutate the caller list', () => {
    const list = cams(300);
    const before = list.map((c) => c.externalId);
    capCamerasPerTick(list, new Date('2026-09-16T00:00:00Z'), 120);
    expect(list.map((c) => c.externalId)).toEqual(before);
  });

  it('takes nothing at a cap of zero', () => {
    const out = capCamerasPerTick(cams(10), new Date('2026-09-16T00:00:00Z'), 0);
    expect(out.cameras).toEqual([]);
    expect(out.dropped).toBe(10);
  });

  it('defaults to the shared ceiling', () => {
    const out = capCamerasPerTick(cams(1000), new Date('2026-09-16T00:00:00Z'));
    expect(out.cameras).toHaveLength(SOURCE_MAX_CAMERAS_PER_TICK);
  });
});
