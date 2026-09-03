import { formRows } from './rows';
import type { PlacedRow, SizedTile, V3Config } from './types';

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

/**
 * The fixed-zone alternative to anchorRelax: chop the latitude window into
 * bandCount equal bands, drop every tile into its band, and centre each
 * band's row on the band. Empty bands stay empty rather than collapsing, so
 * a quiet latitude still reads as quiet — but unlike anchorRelax the
 * vertical positions are quantised.
 */
export function placeBands(
  tiles: SizedTile[],
  viewport: { width: number; height: number },
  cfg: V3Config
): { rows: PlacedRow[]; extent: number } {
  if (tiles.length === 0) return { rows: [], extent: 0 };

  const bandCount = Math.max(1, Math.floor(cfg.bandCount));
  const span = cfg.latNorth - cfg.latSouth;
  const bandHeight = viewport.height / bandCount;

  const buckets = new Map<number, SizedTile[]>();
  for (const tile of tiles) {
    const t = span > 0 ? (cfg.latNorth - tile.lat) / span : 0.5;
    const index = Math.max(0, Math.min(bandCount - 1, Math.floor(t * bandCount)));
    const bucket = buckets.get(index);
    if (bucket) bucket.push(tile);
    else buckets.set(index, [tile]);
  }

  const rows: PlacedRow[] = [];
  for (const index of [...buckets.keys()].sort((a, b) => a - b)) {
    const bandCenter = (index + 0.5) * bandHeight;
    // A band wider than the panel still has to wrap, so reuse row formation
    // and stack the resulting rows around the band's centre.
    const formed = formRows(buckets.get(index)!, viewport.width, cfg.tileGapPx);
    const stackHeight =
      formed.reduce((sum, r) => sum + r.height, 0) + cfg.tileGapPx * (formed.length - 1);
    let top = bandCenter - stackHeight / 2;
    for (const row of formed) {
      rows.push({ ...row, centerY: top + row.height / 2 });
      top += row.height + cfg.tileGapPx;
    }
  }

  // Bands are centred independently, so a crowded band's stack spills into its
  // neighbour and the northernmost band can start above the panel. Apply the
  // discipline anchorRelax already uses: pin the first row inside the top edge,
  // then relax downward so no row overlaps the one before it. Without this the
  // overlap is invisible to the caller — `extent` is derived from these rows,
  // so compose() would be told the composition fits.
  const firstTop = rows[0].centerY - rows[0].height / 2;
  if (firstTop < 0) {
    for (const row of rows) row.centerY -= firstTop;
  }
  for (let i = 1; i < rows.length; i++) {
    const minCenter =
      rows[i - 1].centerY + rows[i - 1].height / 2 + cfg.tileGapPx + rows[i].height / 2;
    if (rows[i].centerY < minCenter) rows[i].centerY = minCenter;
  }

  const top = Math.min(...rows.map((r) => r.centerY - r.height / 2));
  const bottom = Math.max(...rows.map((r) => r.centerY + r.height / 2));
  return { rows, extent: bottom - top };
}
