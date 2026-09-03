import type { PlacedTile } from './types';

/**
 * What the previous composition admitted, and when.
 *
 * `compose()` is pure and must stay pure — no module state, no hook inside
 * the engine (spec §5.4). Memory across compositions is therefore an
 * ARGUMENT: the caller owns the map and the clock, and passes both in.
 *
 * `now` and the map's values share one clock. `index.tsx` uses Date.now().
 */
export interface CompositionHistory {
  /** webcamId -> the clock reading when the tile was first admitted. */
  admittedSince: ReadonlyMap<number, number>;
  /** The clock reading this composition is being computed at. */
  now: number;
}

/** A first composition has no incumbents: everyone competes on merit alone. */
export const EMPTY_HISTORY: CompositionHistory = { admittedSince: new Map(), now: 0 };

export interface EvictionConfig {
  tileGapPx: number;
  hysteresisMargin: number;
  minDwellMs: number;
}

/**
 * The quality a tile fights with, before incumbency.
 *
 * Gate-failers and unscored frames sit at -1, below every real passer's
 * [0,1] score, so a floor tile never displaces a sunset.
 */
export function baseQuality(t: PlacedTile): number {
  return t.passes && t.score !== null ? t.score : -1;
}

/**
 * Incumbency bonus: a tile already on screen competes with
 * quality + hysteresisMargin, so a challenger must beat it by that margin
 * rather than by a rounding error. Without this, two cameras with close
 * scores trade places on every poll (spec §5.4).
 */
export function effectiveQuality(
  t: PlacedTile,
  history: CompositionHistory,
  cfg: EvictionConfig
): number {
  return history.admittedSince.has(t.id)
    ? baseQuality(t) + cfg.hysteresisMargin
    : baseQuality(t);
}

/**
 * Minimum dwell: a tile that has been on screen for less than minDwellMs is
 * not evicted at all, however good the challenger is.
 *
 * The incumbency bonus alone is not enough. It settles WHICH of two similar
 * tiles wins, but a genuinely better frame arriving every poll would still
 * flip the wall repeatedly. The dwell puts a floor on how often any one
 * position can change hands. Both mechanisms are required (spec §5.4).
 */
export function protectedByDwell(
  t: PlacedTile,
  history: CompositionHistory,
  cfg: EvictionConfig
): boolean {
  const since = history.admittedSince.get(t.id);
  return since !== undefined && history.now - since < cfg.minDwellMs;
}

/**
 * 2D intersection with each rectangle expanded by the gap.
 *
 * TWO dimensions, not one. A tall tile may exceed its band's height, and
 * testing both axes is what lets the bands stay fixed without capping tile
 * size (spec §5.3).
 */
export function overlaps(a: PlacedTile, b: PlacedTile, gap: number): boolean {
  return (
    a.x < b.x + b.width + gap &&
    b.x < a.x + a.width + gap &&
    a.y < b.y + b.height + gap &&
    b.y < a.y + a.height + gap
  );
}

/**
 * Resolve crowding by eviction, never by movement.
 *
 * v2's de-overlap pass pushed colliding tiles rightward and then slid the
 * whole row back, which meant one arriving camera could move every tile in
 * the row and corrupted the axis. That pass is DELETED in v3, not adjusted.
 * Here, absolute positions are preserved exactly and the loser is simply not
 * drawn.
 *
 * One ordered pass over the WHOLE panel, not per band: a tile overhanging
 * its band must be tested against its neighbour band's tiles too, and a
 * single global order removes any dependence on which band is visited first.
 *
 * O(n^2) on purpose, with eyes open about the multiplier: compose() calls
 * arrange() up to ~11 times per composition (the scale search for this feed
 * and its peer, then the final pass), and more when showIfRoom or an overflow
 * drop binary-searches. At a few hundred tiles that is still low single-digit
 * milliseconds in Chromium. The sort keys ARE hoisted out of the comparator,
 * because recomputing four Map lookups per comparison was pure waste; a
 * spatial index for the overlap test is the next step if a Pi ever shows it.
 */
export function admit(
  placed: PlacedTile[],
  history: CompositionHistory,
  cfg: EvictionConfig
): { admitted: PlacedTile[]; evicted: number[] } {
  // Rank once per tile, not once per comparison.
  const ranked = placed.map((tile) => ({
    tile,
    // Dwell-protected incumbents are admitted first, so nothing can take
    // their space. Two protected tiles that collide still need a winner, and
    // they get one on quality — deterministically, like everyone else.
    protected: protectedByDwell(tile, history, cfg) ? 1 : 0,
    quality: effectiveQuality(tile, history, cfg),
  }));
  ranked.sort((a, b) => {
    if (a.protected !== b.protected) return b.protected - a.protected;
    if (a.quality !== b.quality) return b.quality - a.quality;
    // Total order. Without the id tie-break, equal-scoring tiles would
    // reorder between ticks and the wall would churn for no reason.
    return a.tile.id - b.tile.id;
  });

  const admitted: PlacedTile[] = [];
  const evicted: number[] = [];
  for (const { tile } of ranked) {
    if (admitted.some((other) => overlaps(tile, other, cfg.tileGapPx))) evicted.push(tile.id);
    else admitted.push(tile);
  }
  return { admitted, evicted };
}
