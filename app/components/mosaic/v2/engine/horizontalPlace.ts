import {
  SEARCH_RADIUS_DEG,
  TERMINATOR_SUN_ALTITUDE_DEG,
} from '@/app/lib/masterConfig';
import type { PlacedRow, PlacedTile, V2Config } from './types';

/**
 * The window that turns a sun altitude into a horizontal position.
 *
 * It is the pool's own definition: the terminator ring the sweep gathers
 * around, plus the radius it gathers within. Decision 6a chose solar altitude
 * over true longitude partly for "no pool-relative normalization, no
 * dependence on pool membership", and deriving min/max from the tiles in hand
 * gave away exactly that property — one camera entering or leaving rescaled
 * every tile on the panel, and the two panels normalised independently, so
 * sunrise and sunset were not even on the same ruler.
 *
 * Altitudes outside the window clamp to an edge rather than widening it. The
 * escalation rings near +2.75 and -28.75 only sweep when a feed falls under
 * the camera floor; widening the window to cover them would squeeze every
 * ordinary night into the middle of the panel for a case that rarely fires.
 * A golden-hour camera pinned to the day edge is also simply true: it is the
 * shallowest into twilight of anything on the wall.
 */
export const ALTITUDE_WINDOW = {
  min: TERMINATOR_SUN_ALTITUDE_DEG - SEARCH_RADIUS_DEG,
  max: TERMINATOR_SUN_ALTITUDE_DEG + SEARCH_RADIUS_DEG,
} as const;

/**
 * Solar altitude to a horizontal unit position, 0 = west edge, 1 = east.
 *
 * The sun sets in the west, so on the SUNSET feed a camera further east is
 * later in the day and its sun sits LOWER — west-to-east is altitude
 * high-to-low, and the mapping inverts. Sunrise is the mirror. This keeps
 * the spec's "west to east renders left to right" directive true on both
 * feeds while X still means depth into twilight.
 */
export function altitudeToUnit(
  altDeg: number,
  min: number,
  max: number,
  feed: 'sunrise' | 'sunset'
): number {
  const span = max - min;
  if (span <= 0) return 0.5;
  const raw = (altDeg - min) / span;
  const unit = raw < 0 ? 0 : raw > 1 ? 1 : raw;
  return feed === 'sunrise' ? unit : 1 - unit;
}

/** Shoulder-to-shoulder packing in west-to-east order, honouring rowAlign. */
function packByOrder(
  row: PlacedRow,
  viewportWidth: number,
  cfg: V2Config
): PlacedTile[] {
  const tiles = [...row.tiles].sort((a, b) => a.lng - b.lng || a.id - b.id);
  const tilesWidth = tiles.reduce((sum, t) => sum + t.width, 0);
  const total = tilesWidth + cfg.tileGapPx * (tiles.length - 1);

  let gap = cfg.tileGapPx;
  let x = 0;
  if (cfg.rowAlign === 'justify' && tiles.length > 1) {
    gap = (viewportWidth - tilesWidth) / (tiles.length - 1);
  } else if (cfg.rowAlign !== 'west') {
    x = (viewportWidth - total) / 2; // 'center', and 'justify' with one tile
  }

  const y = row.centerY - row.height / 2;
  return tiles.map((t) => {
    const placed: PlacedTile = { ...t, x, y: y + (row.height - t.height) / 2 };
    x += t.width + gap;
    return placed;
  });
}

/** Anchor each tile to its twilight depth, then de-overlap left to right. */
function packByAltitude(
  row: PlacedRow,
  viewportWidth: number,
  cfg: V2Config,
  feed: 'sunrise' | 'sunset',
  altRange: { min: number; max: number }
): PlacedTile[] {
  const y = row.centerY - row.height / 2;
  const anchored = row.tiles
    .map((t) => {
      const unit =
        t.sunAltitudeDeg === null
          ? 0.5
          : altitudeToUnit(t.sunAltitudeDeg, altRange.min, altRange.max, feed);
      return { tile: t, x: unit * Math.max(0, viewportWidth - t.width) };
    })
    .sort((a, b) => a.x - b.x || a.tile.id - b.tile.id);

  for (let i = 1; i < anchored.length; i++) {
    const minX = anchored[i - 1].x + anchored[i - 1].tile.width + cfg.tileGapPx;
    if (anchored[i].x < minX) anchored[i].x = minX;
  }

  // De-overlapping only pushes right, so the row can run off the edge.
  // Slide the whole row back by ONE shift — clamping each tile at 0
  // independently would break the uniform-shift property the pass above
  // established and let tiles overlap again. formRows guarantees a row's
  // tiles plus gaps fit the panel, so in practice `shift === overflow`;
  // the min() only matters for an over-constrained row, which then bleeds
  // off the right edge rather than overlapping — the better failure.
  const last = anchored[anchored.length - 1];
  const overflow = last.x + last.tile.width - viewportWidth;
  if (overflow > 0) {
    const shift = Math.min(overflow, anchored[0].x);
    for (const a of anchored) a.x -= shift;
  }

  return anchored.map(({ tile, x }) => ({
    ...tile,
    x,
    y: y + (row.height - tile.height) / 2,
  }));
}

/**
 * Places one row's tiles horizontally. Vertical position comes from the row;
 * shorter tiles are centred within the row's height.
 */
export function placeRowHorizontally(
  row: PlacedRow,
  viewportWidth: number,
  cfg: V2Config,
  feed: 'sunrise' | 'sunset',
  altRange: { min: number; max: number } | null
): PlacedTile[] {
  if (row.tiles.length === 0) return [];
  if (cfg.horizontalAnchor === 'solarAltitude' && altRange !== null) {
    return packByAltitude(row, viewportWidth, cfg, feed, altRange);
  }
  return packByOrder(row, viewportWidth, cfg);
}
