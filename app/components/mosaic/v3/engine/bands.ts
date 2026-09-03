import type { BandGrid, SizedTile } from './types';

/**
 * The band model (spec §5.1). The latitude window is cut into bandCount
 * equal strips that never move. A camera's band follows from its latitude
 * alone: the strip covering 45N to 50N is the same pixels tonight and next
 * year, holding one camera or forty.
 *
 * This is the vertical cure for the disease fixed on the horizontal axis on
 * 2026-09-01. v2 formed rows by greedy width packing over the current pool
 * and placed each row at its members' mean latitude, so adding one camera
 * changed row membership, which changed the means, which moved every row.
 *
 * An empty band stays empty. A quiet latitude reads as quiet.
 */
export interface BandConfig {
  bandCount: number;
  latNorth: number;
  latSouth: number;
  bandGrid: BandGrid;
  ceilingPx: number;
}

const bandsOf = (cfg: BandConfig): number => Math.max(1, Math.floor(cfg.bandCount));

/** Which fixed strip a latitude falls in. North is band 0. */
export function bandIndexForLat(lat: number, cfg: BandConfig): number {
  const count = bandsOf(cfg);
  const span = cfg.latNorth - cfg.latSouth;
  if (span <= 0) return 0;
  const t = (cfg.latNorth - lat) / span;
  return Math.max(0, Math.min(count - 1, Math.floor(t * count)));
}

/**
 * How far the band grid is held back from each panel edge, in px.
 *
 * `full` is the literal reading of §5.1: strips divide the whole panel, so
 * the outermost band centres sit half a band from each edge and a tall tile
 * there hangs off the panel. The overflow stage measures total extent, reads
 * that overhang as overflow, and shrinks the ENTIRE wall for it. The relation
 * is exact — an unshrunk wall needs bandCount * ceilingPx <= panelHeight — so
 * at a 480px ceiling on a 1920px panel anything past 4 bands runs the
 * composition into its scale floor.
 *
 * `inset` holds the grid back by half a ceiling tile at each edge, so a
 * full-height tile in the top band starts exactly at the top edge instead of
 * half above it, and no pool can drive the shrink.
 *
 * The inset comes from the DIAL, never from the tallest tile actually
 * present. Insetting by an observed maximum would move every band the moment
 * a tall tile arrived, which is precisely the disease v3 exists to cure.
 */
export function bandInsetPx(viewportHeight: number, cfg: BandConfig): number {
  if (cfg.bandGrid !== 'inset') return 0;
  const inset = Math.max(0, Math.min(cfg.ceilingPx / 2, viewportHeight / 2));
  // A ceiling taller than the panel would collapse the grid to a point.
  // Fall back to no inset rather than stacking every band on one line.
  return viewportHeight - inset * 2 > 0 ? inset : 0;
}

/** A band's vertical centre in px. Fixed for the life of the panel. */
export function bandCenterY(
  index: number,
  viewportHeight: number,
  cfg: BandConfig
): number {
  const inset = bandInsetPx(viewportHeight, cfg);
  const usable = viewportHeight - inset * 2;
  return inset + ((index + 0.5) * usable) / bandsOf(cfg);
}

/**
 * A tile's absolute y: centred on its band, whatever its height.
 *
 * A tall tile is allowed to overhang its band. Capping tile height to the
 * band would make size mean "quality, unless you happen to be in a crowded
 * latitude", and size means quality and nothing else (spec §3). The overhang
 * is safe because the eviction pass tests rectangles in TWO dimensions
 * against the whole panel's admitted set, not just within the band.
 */
export function tileY(
  tile: SizedTile,
  viewportHeight: number,
  cfg: BandConfig
): number {
  return bandCenterY(bandIndexForLat(tile.lat, cfg), viewportHeight, cfg) - tile.height / 2;
}
