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
 */
export function compose(
  tiles: TileInput[],
  viewport: { width: number; height: number },
  cfg: V2Config,
  feed: 'sunrise' | 'sunset'
): Layout {
  if (tiles.length === 0) {
    return { tiles: [], dropped: [], scale: 1, viewport };
  }

  const { passers, failers } = splitPool(tiles);

  let candidates: TileInput[];
  if (cfg.failedCamPolicy === 'showIfRoom') {
    const room = largestFittingCount(passers, failers, viewport, cfg, 1);
    candidates = [...passers, ...failers.slice(0, room)];
  } else {
    candidates = applyPolicy(passers, failers, cfg);
  }
  candidates = capTiles(candidates, cfg.maxTiles);

  const droppedIds = new Set(
    tiles.filter((t) => !candidates.includes(t)).map((t) => t.id)
  );

  let sized = sizeTiles(candidates, cfg);
  let scale = 1;
  let placement = arrange(sized, viewport, cfg);

  for (let pass = 0; pass < MAX_SCALE_PASSES && placement.extent > viewport.height; pass++) {
    const needed = viewport.height / placement.extent;
    const next = Math.max(MIN_COMPOSITION_SCALE, scale * needed);
    if (next === scale) break;
    scale = next;
    sized = scaleTiles(sizeTiles(candidates, cfg), scale);
    placement = arrange(sized, viewport, cfg);
  }

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
