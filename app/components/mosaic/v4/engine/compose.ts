import { tileX } from './axis';
import { tileY } from './bands';
import { admit, EMPTY_HISTORY, type CompositionHistory } from './evict';
import { MIN_COMPOSITION_SCALE, scaleTiles } from './overflow';
import { sizeTiles } from './sizing';
import { applyPolicy, capTiles, splitPool } from './visibility';
import type { Layout, PlacedTile, SizedTile, TileInput, V4Config } from './types';

const MAX_SCALE_PASSES = 4;

interface Placement {
  tiles: PlacedTile[];
  evicted: number[];
  extent: number;
}

/**
 * Absolute placement, then eviction. No packing, no relaxing, no shoving:
 * every tile's x comes from its own solar altitude and its y from its own
 * latitude, and crowding is settled by leaving the loser undrawn (spec §5.2,
 * §5.3).
 *
 * `extent` is the unclamped vertical span of what was ADMITTED, which is what
 * the overflow stage scales against. Tiles are centred on fixed bands, so the
 * only way to overflow is for tall tiles in the end bands to overhang the
 * panel — a uniform shrink pulls them back in.
 */
function arrange(
  sized: SizedTile[],
  viewport: { width: number; height: number },
  cfg: V4Config,
  feed: 'sunrise' | 'sunset',
  history: CompositionHistory
): Placement {
  const placed: PlacedTile[] = sized.map((t) => ({
    ...t,
    x: tileX(t, viewport.width, cfg, feed),
    y: tileY(t, viewport.height, cfg),
  }));
  const { admitted, evicted } = admit(placed, history, cfg);
  if (admitted.length === 0) return { tiles: [], evicted, extent: 0 };
  const top = Math.min(...admitted.map((t) => t.y));
  const bottom = Math.max(...admitted.map((t) => t.y + t.height));
  return { tiles: admitted, evicted, extent: bottom - top };
}

/** Does this candidate set, sized and scaled, fit the panel height? */
function fits(
  candidates: TileInput[],
  viewport: { width: number; height: number },
  cfg: V4Config,
  feed: 'sunrise' | 'sunset',
  history: CompositionHistory,
  scale: number
): boolean {
  const sized = scaleTiles(sizeTiles(candidates, cfg, feed), scale);
  return arrange(sized, viewport, cfg, feed, history).extent <= viewport.height;
}

/**
 * The visible candidate set for a pool: gate split, the operator's
 * failed-cam policy, then the hard tile cap. Pulled out of `compose` so the
 * peer feed can be run through exactly the same funnel when the two panels
 * share one scale.
 */
export function selectCandidates(
  tiles: TileInput[],
  viewport: { width: number; height: number },
  cfg: V4Config,
  feed: 'sunrise' | 'sunset',
  history: CompositionHistory
): TileInput[] {
  const { passers, failers } = splitPool(tiles);
  const candidates =
    cfg.failedCamPolicy === 'showIfRoom'
      ? [
          ...passers,
          ...failers.slice(
            0,
            largestFittingCount(passers, failers, viewport, cfg, feed, history, 1)
          ),
        ]
      : applyPolicy(passers, failers, cfg);
  return capTiles(candidates, cfg.maxTiles);
}

/**
 * Smallest uniform scale this candidate set needs to fit the panel: 1 when
 * it already fits, never below MIN_COMPOSITION_SCALE.
 *
 * The iterative step can exhaust its passes while still overflowing and
 * still above the floor — extent is not linear in scale, because gaps do not
 * scale and shrinking changes which tiles the eviction pass admits. Forcing
 * the floor in that case is what makes "nothing is dropped until scaling has
 * bottomed out" hold literally rather than approximately.
 */
export function requiredScale(
  candidates: TileInput[],
  viewport: { width: number; height: number },
  cfg: V4Config,
  feed: 'sunrise' | 'sunset',
  history: CompositionHistory
): number {
  let scale = 1;
  let extent = arrange(sizeTiles(candidates, cfg, feed), viewport, cfg, feed, history).extent;

  for (let pass = 0; pass < MAX_SCALE_PASSES && extent > viewport.height; pass++) {
    const next = Math.max(MIN_COMPOSITION_SCALE, scale * (viewport.height / extent));
    if (next === scale) break;
    scale = next;
    extent = arrange(
      scaleTiles(sizeTiles(candidates, cfg, feed), scale), viewport, cfg, feed, history
    ).extent;
  }

  return extent > viewport.height ? MIN_COMPOSITION_SCALE : scale;
}

/**
 * Largest prefix of `ordered` that still fits when appended to `base`.
 * Binary search, not one-at-a-time: more tiles is monotonically taller, and
 * a 400-tile pool would otherwise mean 400 full recompositions — the kind of
 * wall-clock blowup that has produced test flakes in this repo before.
 */
function largestFittingCount(
  base: TileInput[],
  ordered: TileInput[],
  viewport: { width: number; height: number },
  cfg: V4Config,
  feed: 'sunrise' | 'sunset',
  history: CompositionHistory,
  scale: number
): number {
  let lo = 0;
  let hi = ordered.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (fits([...base, ...ordered.slice(0, mid)], viewport, cfg, feed, history, scale)) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * The full v3 pipeline: signal-derived flags in, placed pixels out. Pure —
 * no DOM, no Image, no clock. The memory hysteresis needs arrives as
 * `history`, which the caller owns (spec §5.4).
 *
 * Two removal mechanisms, kept apart on purpose (spec §5.6). Band eviction
 * runs inside `arrange` and handles crowding. The overflow stage then handles
 * total vertical extent, and NEVER culls arbitrarily: the composition shrinks
 * uniformly first, and only once it hits MIN_COMPOSITION_SCALE does it drop,
 * deterministically from the lowest-scoring gate-failers up.
 *
 * `peerTiles` is the OTHER feed's pool. With cfg.sharedScale on, both panels
 * adopt the tighter of the two scales, so a floor tile is the same number of
 * pixels on the sunrise screen as on the sunset screen. Surfaces that show
 * one panel alone omit it.
 */
export function compose(
  tiles: TileInput[],
  viewport: { width: number; height: number },
  cfg: V4Config,
  feed: 'sunrise' | 'sunset',
  peerTiles: TileInput[] = [],
  history: CompositionHistory = EMPTY_HISTORY
): Layout {
  if (tiles.length === 0) {
    return { tiles: [], dropped: [], evicted: [], scale: 1, viewport };
  }

  let candidates = selectCandidates(tiles, viewport, cfg, feed, history);
  const droppedIds = new Set<number>();

  let scale = requiredScale(candidates, viewport, cfg, feed, history);
  if (cfg.sharedScale && peerTiles.length > 0) {
    // The peer is the other feed, so it must be arranged as the other feed:
    // x depends on the direction, x decides collisions, and collisions decide
    // the extent this scale is derived from.
    const peerFeed = feed === 'sunrise' ? 'sunset' : 'sunrise';
    scale = Math.min(
      scale,
      requiredScale(
        selectCandidates(peerTiles, viewport, cfg, peerFeed, history),
        viewport, cfg, peerFeed, history
      )
    );
  }

  let sized = scaleTiles(sizeTiles(candidates, cfg, feed), scale);
  let placement = arrange(sized, viewport, cfg, feed, history);

  // Last resort: still overflowing at the scale floor. Keep the longest
  // prefix that fits — candidates run passers-first, weakest failers last,
  // so this drops exactly the tiles that matter least, deterministically.
  if (placement.extent > viewport.height) {
    const keep = Math.max(
      1, largestFittingCount([], candidates, viewport, cfg, feed, history, scale)
    );
    for (const t of candidates.slice(keep)) droppedIds.add(t.id);
    candidates = candidates.slice(0, keep);
    sized = scaleTiles(sizeTiles(candidates, cfg, feed), scale);
    placement = arrange(sized, viewport, cfg, feed, history);
  }

  return {
    tiles: placement.tiles,
    dropped: [...droppedIds],
    evicted: placement.evicted,
    scale,
    viewport,
  };
}
