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
});
