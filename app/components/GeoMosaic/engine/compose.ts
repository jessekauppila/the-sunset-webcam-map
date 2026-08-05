import { sizeTiles } from './percentileSize';
import { formRows, type Row } from './bandRows';
import { fitToViewport } from './overflow';
import { placeTiles } from './distributeSpace';
import type { CompositionConfig, Layout, SizedTile, TileInput } from './types';

function stackedHeightOf(rows: Row[], padding: number): number {
  if (rows.length === 0) return 0;
  return rows.reduce((sum, row) => sum + row.height, 0) + padding * (rows.length - 1);
}

/**
 * Multiplies every tile's height and width by k (uniform growth), then
 * re-clamps each tile's height at srcHeight×upscaleMax, rescaling width to
 * preserve aspect ratio when the clamp bites.
 */
function growTiles(tiles: SizedTile[], k: number, cfg: CompositionConfig): SizedTile[] {
  return tiles.map((t) => {
    const scaledHeight = t.height * k;
    const scaledWidth = t.width * k;
    const maxHeight = t.srcHeight * cfg.upscaleMax;
    const clampedHeight = Math.min(scaledHeight, maxHeight);
    const ratio = scaledHeight > 0 ? clampedHeight / scaledHeight : 1;
    return { ...t, height: clampedHeight, width: scaledWidth * ratio };
  });
}

/**
 * Orchestrates the full mosaic layout pipeline: size tiles by percentile,
 * band them into rows, grow sparse layouts to fill unused viewport height,
 * fit to the viewport (culling or compressing overflow), then place tiles
 * within their rows. Pure function: no DOM/window/Image access.
 */
export function compose(
  tiles: TileInput[],
  viewport: { width: number; height: number },
  cfg: CompositionConfig
): Layout {
  if (tiles.length === 0) {
    return { tiles: [], dropped: [], viewport };
  }

  let sized = sizeTiles(tiles, cfg);
  const rows = formRows(sized, viewport.width, cfg.padding);
  const stackedH = stackedHeightOf(rows, cfg.padding);

  if (stackedH > 0 && stackedH < viewport.height) {
    const k = Math.min(viewport.height / stackedH, cfg.maxGrowth);
    if (k > 1) {
      sized = growTiles(sized, k, cfg);
    }
  }

  const { rows: fittedRows, dropped } = fitToViewport(sized, viewport, cfg);
  const placed = placeTiles(fittedRows, viewport, cfg);

  return { tiles: placed, dropped, viewport };
}
