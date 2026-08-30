import { describe, it, expect } from 'vitest';
import { compose } from './compose';
import type { TileInput, CompositionConfig } from './types';

const cfg: CompositionConfig = { floorPx: 100, ceilPx: 300, upscaleMax: 1.5, latWindow: [70, -60], maxGrowth: 2, cullOverflow: true, padding: 2 };
const t = (id: number, lat: number, lng: number, score: number | null = 3): TileInput =>
  ({ id, lat, lng, srcWidth: 712, srcHeight: 400, score });

describe('compose', () => {
  it('empty pool → empty layout, no throw', () => {
    expect(compose([], { width: 1080, height: 1920 }, cfg).tiles).toEqual([]);
  });
  it('sparse pool grows tiles but never past upscale ceiling', () => {
    const layout = compose([t(1, 40, 0, 5), t(2, -20, 10, 1)], { width: 1080, height: 1920 }, cfg);
    for (const p of layout.tiles) expect(p.height).toBeLessThanOrEqual(400 * 1.5);
    expect(layout.tiles.length).toBe(2);
  });
  it('all tiles stay inside the viewport', () => {
    const many = Array.from({ length: 150 }, (_, i) => t(i, 60 - (i % 30) * 4, (i % 12) * 30 - 180, (i % 50) / 10));
    const layout = compose(many, { width: 1080, height: 1920 }, cfg);
    for (const p of layout.tiles) {
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y + p.height).toBeLessThanOrEqual(1920 + 0.5);
      expect(p.x).toBeGreaterThanOrEqual(-0.5);
      expect(p.x + p.width).toBeLessThanOrEqual(1080 + 0.5);
    }
  });
  it('overflow culls lowest percentile ids into dropped', () => {
    const many = Array.from({ length: 400 }, (_, i) => t(i, 60 - (i % 40) * 3, i % 360 - 180, (i % 40) / 8));
    const layout = compose(many, { width: 1080, height: 1920 }, cfg);
    expect(layout.dropped.length).toBeGreaterThan(0);
    expect(layout.tiles.length + layout.dropped.length).toBe(400);
  });
  it('higher percentile → taller tile (hierarchy visible)', () => {
    const layout = compose([t(1, 10, 0, 1), t(2, 10, 20, 5), t(3, 10, 40, 3)], { width: 2000, height: 400 }, cfg);
    const h = (id: number) => layout.tiles.find((p) => p.id === id)!.height;
    expect(h(2)).toBeGreaterThan(h(3));
    expect(h(3)).toBeGreaterThan(h(1));
  });

  // Regression coverage for the growth-search fix: a naive single-shot k
  // (scaling every tile's width AND height by the same k computed from the
  // ungrown stacked height) grows area ~k², which can push row-wrapped
  // tiles past the viewport width, forcing more/taller rows than assumed
  // and overflowing height — causing cullMode to drop tiles that fit fine
  // ungrown. This pool is built so uniform tiles pack 2-per-row at k=1,
  // but any k above ~1.08 forces a width-driven re-wrap to 1-per-row (8
  // rows instead of 4), which overflows the 1920px viewport under the old
  // naive-k approach. The fix must search for a workable k instead of
  // assuming the first one.
  describe('sparse growth search never overshoots into drops', () => {
    // floorPx === ceilPx pins every tile to the same preferred height
    // (280px) regardless of percentile, so the row-packing geometry below
    // is exact and independent of each tile's (still-varied) score.
    const growthCfg: CompositionConfig = {
      floorPx: 280,
      ceilPx: 280,
      upscaleMax: 1.5,
      latWindow: [70, -60],
      maxGrowth: 2,
      cullOverflow: true,
      padding: 2,
    };
    const viewport = { width: 1080, height: 1920 };
    const pool: TileInput[] = [
      t(1, 60, -100, 1),
      t(2, 60, -80, 4.5),
      t(3, 40, -60, 2),
      t(4, 40, -40, 5),
      t(5, 20, -20, 1.5),
      t(6, 20, 0, 3.5),
      t(7, 0, 20, 2.5),
      t(8, 0, 40, 4),
    ];

    it('keeps all 8 tiles with growth active and no drops', () => {
      const layout = compose(pool, viewport, growthCfg);
      expect(layout.dropped).toEqual([]);
      expect(layout.tiles.length).toBe(8);
      // Growth must actually have kicked in (heights above the ungrown
      // 280px preferred size) — otherwise this test wouldn't distinguish
      // the fix from simply disabling growth altogether.
      expect(layout.tiles.some((p) => p.height > 280)).toBe(true);
    });

    it('grown tile heights never exceed srcHeight × upscaleMax', () => {
      const layout = compose(pool, viewport, growthCfg);
      for (const p of layout.tiles) {
        expect(p.height).toBeLessThanOrEqual(400 * growthCfg.upscaleMax + 1e-6);
      }
    });
  });
});
