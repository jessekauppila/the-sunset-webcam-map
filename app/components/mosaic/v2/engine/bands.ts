import { formRows } from './rows';
import type { PlacedRow, SizedTile, V2Config } from './types';

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
  cfg: V2Config
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

  const top = Math.min(...rows.map((r) => r.centerY - r.height / 2));
  const bottom = Math.max(...rows.map((r) => r.centerY + r.height / 2));
  return { rows, extent: bottom - top };
}
