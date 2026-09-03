import { describe, it, expect } from 'vitest';
import { compose } from './compose';
import { poolFrom, type FixturePool } from './fixturePool';
import { schemaDefaults } from '@/app/lib/settings/schema';
import { V3_SETTINGS_SCHEMA, configFromSettings } from '../settingsSchema';
import fixture from './__fixtures__/live-capture-pool.json';

/**
 * The trustworthy pool (spec §9). Both reconstructed historical scenes sit
 * roughly 7 hours off in local solar time and cannot judge anything
 * twilight-dependent, so only the live capture will do here.
 */
const pool = fixture as FixturePool;
const cfg = configFromSettings(schemaDefaults(V3_SETTINGS_SCHEMA));
const viewport = { width: 1080, height: 1920 };

const sunset = poolFrom(pool.sunset, pool.representsAt);
const sunrise = poolFrom(pool.sunrise, pool.representsAt);

const posOf = (tiles: { id: number; x: number; y: number }[]) =>
  new Map(tiles.map((t) => [t.id, `${t.x},${t.y}`]));

describe('the live capture pool', () => {
  it('is the scene this test claims to use', () => {
    expect(pool.sunrise).toHaveLength(21);
    expect(pool.sunset).toHaveLength(42);
  });

  it('composes without dropping the whole pool', () => {
    const layout = compose(sunset, viewport, cfg, 'sunset', sunrise);
    expect(layout.tiles.length).toBeGreaterThan(0);
  });
});

describe('HEADLINE: adding or removing a camera moves no other tile', () => {
  it('holds when each camera in turn is removed from the sunset pool', () => {
    const full = compose(sunset, viewport, cfg, 'sunset');
    const before = posOf(full.tiles);

    for (let i = 0; i < sunset.length; i++) {
      const without = sunset.filter((_, j) => j !== i);
      const layout = compose(without, viewport, cfg, 'sunset');
      for (const t of layout.tiles) {
        const was = before.get(t.id);
        if (was === undefined) continue; // evicted before, admitted now
        expect(`${t.id}: ${t.x},${t.y}`).toBe(`${t.id}: ${was}`);
      }
    }
  });

  it('holds when a camera arrives into the sunrise pool', () => {
    const base = sunrise.slice(0, sunrise.length - 1);
    const before = posOf(compose(base, viewport, cfg, 'sunrise').tiles);
    const after = compose(sunrise, viewport, cfg, 'sunrise').tiles;
    for (const t of after) {
      const was = before.get(t.id);
      if (was === undefined) continue;
      expect(`${t.id}: ${t.x},${t.y}`).toBe(`${t.id}: ${was}`);
    }
  });

  it('holds for the panel scale too — one camera does not rescale the wall', () => {
    const full = compose(sunset, viewport, cfg, 'sunset').scale;
    const without = compose(sunset.slice(1), viewport, cfg, 'sunset').scale;
    expect(without).toBe(full);
  });
});

describe('the real pool, on the real axis', () => {
  it('accounts for every candidate: drawn, evicted, or dropped', () => {
    const layout = compose(sunset, viewport, cfg, 'sunset');
    const seen = new Set([
      ...layout.tiles.map((t) => t.id),
      ...layout.evicted,
      ...layout.dropped,
    ]);
    // Default policy is showAtFloor, so nothing is configured away.
    expect(seen.size).toBe(sunset.length);
  });

  it('draws no two tiles overlapping', () => {
    const { tiles } = compose(sunset, viewport, cfg, 'sunset');
    for (let i = 0; i < tiles.length; i++) {
      for (let j = i + 1; j < tiles.length; j++) {
        const a = tiles[i];
        const b = tiles[j];
        const clear =
          a.x + a.width <= b.x || b.x + b.width <= a.x ||
          a.y + a.height <= b.y || b.y + b.height <= a.y;
        expect(`${a.id} vs ${b.id}: ${clear}`).toBe(`${a.id} vs ${b.id}: true`);
      }
    }
  });

  it('records how dense the default dials actually leave the wall', () => {
    // Not a correctness property — a measurement, pinned so a tuning change
    // is visible rather than silent. On the live capture the sunset panel
    // draws 8 of 42 and evicts 34, because the pool clusters hard in BOTH
    // latitude and altitude: every camera is near the terminator by
    // construction, and 38 of the 42 fail the gate and sit at the identical
    // floor size, so they land on top of each other.
    //
    // Eviction is behaving as specified. The defaults moved once already:
    // 13 x 480 drew 5 / evicted 37 here and showed 1 of the 4 real sunsets;
    // 8 x 240 (decided 2026-09-03) shows 3 of 4. Update these numbers when
    // the dials move again.
    const layout = compose(sunset, viewport, cfg, 'sunset');
    expect(layout.tiles.length).toBe(8);
    expect(layout.evicted.length).toBe(34);
    expect(layout.tiles.filter((t) => t.passes).length).toBe(3);
    expect(compose(sunrise, viewport, cfg, 'sunrise').tiles.length).toBe(9);
  });

  it('keeps every drawn tile inside the panel horizontally', () => {
    const { tiles } = compose(sunset, viewport, cfg, 'sunset');
    for (const t of tiles) {
      expect(t.x).toBeGreaterThanOrEqual(0);
      expect(t.x + t.width).toBeLessThanOrEqual(viewport.width + 0.001);
    }
  });
});
