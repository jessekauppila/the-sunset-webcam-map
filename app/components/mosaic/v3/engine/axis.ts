import type { SizedTile } from './types';

/**
 * The window that turns a sun altitude into a horizontal position.
 *
 * X is perpendicular angular distance from the terminator, and that is
 * exactly solar altitude rather than an approximation: a point with the sun
 * h degrees up sits h degrees on the day side of the terminator circle.
 *
 * v2 derived this window from the cron's own constants. v3 makes it two
 * dials instead, because the window can usefully NARROW: good frames crowd
 * into the day-side third of the panel, and a tighter window spreads them
 * across it. The property the derived form bought — that the axis tracks
 * what the sweep gathers — is bought back by a test against
 * TERMINATOR_POOL_COVERAGE_DEG. Do not import the sweep radius here.
 */
export interface AxisConfig {
  /** Deepest twilight the panel shows. Altitudes below this clamp. */
  axisNightEdgeDeg: number;
  /** Shallowest twilight the panel shows. Altitudes above this clamp. */
  axisDayEdgeDeg: number;
}

/**
 * Solar altitude to a horizontal unit position, 0 = west edge, 1 = east.
 *
 * The sun sets in the west, so on the SUNSET feed a camera further east is
 * later in the day and its sun sits LOWER — west-to-east is altitude
 * high-to-low, and the mapping inverts. Sunrise is the mirror. This is what
 * keeps "west on the left, tiles travel left to right" true on both panels
 * while X still means depth into twilight (spec §3).
 */
export function altitudeToUnit(
  altDeg: number,
  cfg: AxisConfig,
  feed: 'sunrise' | 'sunset'
): number {
  const span = cfg.axisDayEdgeDeg - cfg.axisNightEdgeDeg;
  if (span <= 0) return 0.5;
  const raw = (altDeg - cfg.axisNightEdgeDeg) / span;
  const unit = raw < 0 ? 0 : raw > 1 ? 1 : raw;
  return feed === 'sunrise' ? unit : 1 - unit;
}

/**
 * A tile's absolute x. No packing, no de-overlap, no dependence on the pool:
 * the same altitude puts a tile of the same width in the same pixels tonight
 * and next year (spec §5.2).
 *
 * Scaling by (viewportWidth - width) rather than viewportWidth keeps the tile
 * inside the panel AND has the pleasant property that a tile's CENTRE lands
 * exactly on unit * viewportWidth — which is what lets the centre-line
 * overlay in `overlays/CentreLine.tsx` mark a real position rather than an
 * approximate one.
 *
 * A null altitude means the moment is unknown, not that the sun is at zero.
 * Centre is the honest answer; an edge would be a claim.
 */
export function tileX(
  tile: SizedTile,
  viewportWidth: number,
  cfg: AxisConfig,
  feed: 'sunrise' | 'sunset'
): number {
  const unit =
    tile.sunAltitudeDeg === null ? 0.5 : altitudeToUnit(tile.sunAltitudeDeg, cfg, feed);
  return unit * Math.max(0, viewportWidth - tile.width);
}
