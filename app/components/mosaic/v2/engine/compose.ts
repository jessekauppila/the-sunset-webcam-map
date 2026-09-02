import { placeBands } from './bands';
import { altitudeRange, placeRowHorizontally } from './horizontalPlace';
import { MIN_COMPOSITION_SCALE, scaleTiles } from './overflow';
import { formRows } from './rows';
import { sizeTiles } from './sizing';
import { applyPolicy, capTiles, splitPool } from './visibility';
import { placeRowsVertically } from './verticalPlace';
import type { Layout, PlacedRow, SizedTile, TileInput, V2Config } from './types';

const MAX_SCALE_PASSES = 4;

function arrange(
  sized: SizedTile[],
  viewport: { width: number; height: number },
  cfg: V2Config
): { rows: PlacedRow[]; extent: number } {
  if (cfg.strategy === 'latitudeBands') return placeBands(sized, viewport, cfg);
  const rows = formRows(sized, viewport.width, cfg.tileGapPx);
  return placeRowsVertically(rows, viewport.height, cfg);
}

/** Does this candidate set, sized and scaled, fit the panel height? */
function fits(
  candidates: TileInput[],
  viewport: { width: number; height: number },
  cfg: V2Config,
  scale: number
): boolean {
  const sized = scaleTiles(sizeTiles(candidates, cfg), scale);
  return arrange(sized, viewport, cfg).extent <= viewport.height;
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
  cfg: V2Config
): TileInput[] {
  const { passers, failers } = splitPool(tiles);
  const candidates =
    cfg.failedCamPolicy === 'showIfRoom'
      ? [
          ...passers,
          ...failers.slice(0, largestFittingCount(passers, failers, viewport, cfg, 1)),
        ]
      : applyPolicy(passers, failers, cfg);
  return capTiles(candidates, cfg.maxTiles);
}

/**
 * Smallest uniform scale this candidate set needs to fit the panel: 1 when
 * it already fits, never below MIN_COMPOSITION_SCALE.
 *
 * The iterative step can exhaust its passes while still overflowing and
 * still above the floor — extent is not linear in scale (gaps do not scale,
 * and re-formed rows repack at smaller widths). Forcing the floor in that
 * case is what makes "nothing is dropped until scaling has bottomed out"
 * hold literally rather than approximately.
 */
export function requiredScale(
  candidates: TileInput[],
  viewport: { width: number; height: number },
  cfg: V2Config
): number {
  let scale = 1;
  let extent = arrange(sizeTiles(candidates, cfg), viewport, cfg).extent;

  for (let pass = 0; pass < MAX_SCALE_PASSES && extent > viewport.height; pass++) {
    const next = Math.max(MIN_COMPOSITION_SCALE, scale * (viewport.height / extent));
    if (next === scale) break;
    scale = next;
    extent = arrange(scaleTiles(sizeTiles(candidates, cfg), scale), viewport, cfg).extent;
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
  cfg: V2Config,
  scale: number
): number {
  let lo = 0;
  let hi = ordered.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (fits([...base, ...ordered.slice(0, mid)], viewport, cfg, scale)) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * The full v2 pipeline: signal-derived flags in, placed pixels out. Pure —
 * no DOM, no Image, no clock.
 *
 * Overflow NEVER culls arbitrarily (v1's named failure). The composition
 * shrinks uniformly first; only once it hits MIN_COMPOSITION_SCALE does it
 * drop, and then deterministically from the lowest-scoring gate-failers up.
 *
 * `peerTiles` is the OTHER feed's pool. With cfg.sharedScale on, both panels
 * adopt the tighter of the two scales, so a floor tile is the same number of
 * pixels on the sunrise screen as on the sunset screen. Without it each
 * panel shrinks to its own crowding and the two screens stop agreeing on
 * what "small" means. Surfaces that show one panel alone omit it.
 */
export function compose(
  tiles: TileInput[],
  viewport: { width: number; height: number },
  cfg: V2Config,
  feed: 'sunrise' | 'sunset',
  peerTiles: TileInput[] = []
): Layout {
  if (tiles.length === 0) {
    return { tiles: [], dropped: [], scale: 1, viewport };
  }

  let candidates = selectCandidates(tiles, viewport, cfg);

  // `dropped` reports overflow casualties ONLY. Tiles the operator's own
  // visibility policy removed (failedCamPolicy: 'hide', or a maxTiles cap)
  // were configured away, not dropped — conflating the two makes the setup
  // overlay's counter claim the composition is struggling when it isn't.
  const droppedIds = new Set<number>();

  let scale = requiredScale(candidates, viewport, cfg);
  if (cfg.sharedScale && peerTiles.length > 0) {
    scale = Math.min(
      scale,
      requiredScale(selectCandidates(peerTiles, viewport, cfg), viewport, cfg)
    );
  }

  let sized = scaleTiles(sizeTiles(candidates, cfg), scale);
  let placement = arrange(sized, viewport, cfg);

  // Last resort: still overflowing at the scale floor. Keep the longest
  // prefix that fits — candidates run passers-first, weakest failers last,
  // so this drops exactly the tiles that matter least, deterministically.
  if (placement.extent > viewport.height) {
    const keep = Math.max(1, largestFittingCount([], candidates, viewport, cfg, scale));
    for (const t of candidates.slice(keep)) droppedIds.add(t.id);
    candidates = candidates.slice(0, keep);
    sized = scaleTiles(sizeTiles(candidates, cfg), scale);
    placement = arrange(sized, viewport, cfg);
  }

  const altRange = altitudeRange(sized);
  const placed = placement.rows.flatMap((row) =>
    placeRowHorizontally(row, viewport.width, cfg, feed, altRange)
  );

  return {
    tiles: placed,
    dropped: [...droppedIds],
    scale,
    viewport,
  };
}
