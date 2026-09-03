import type { SizedTile } from './types';

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

/** A band's vertical centre in px. Fixed for the life of the panel. */
export function bandCenterY(
  index: number,
  viewportHeight: number,
  cfg: BandConfig
): number {
  return ((index + 0.5) * viewportHeight) / bandsOf(cfg);
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
