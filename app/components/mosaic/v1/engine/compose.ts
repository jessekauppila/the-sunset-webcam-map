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

const GROWTH_STEP = 0.05;

/**
 * Finds the largest growth factor k (in (1, kMax]) that, once applied to
 * every tile and the rows re-formed, still fits the viewport height.
 * Growth scales tile area by roughly k² (both width and height scale by
 * k), so the first k that trivially "fits" the ungrown stacked height is
 * not safe to assume — a naive single-shot k can overshoot and cause
 * fitToViewport to cull tiles that fit fine ungrown. This searches
 * downward from kMax toward 1, accepting the first (largest) k whose
 * re-formed rows fit, and falls back to k=1 (no growth) if none do —
 * which always fits, since the caller only invokes this when the
 * ungrown layout already fits.
 */
function findWorkableGrowth(
  sized: SizedTile[],
  kMax: number,
  viewport: { width: number; height: number },
  cfg: CompositionConfig
): SizedTile[] {
  if (kMax <= 1) return sized;

  for (let k = kMax; k > 1; k -= GROWTH_STEP) {
    const candidate = growTiles(sized, k, cfg);
    const candidateRows = formRows(candidate, viewport.width, cfg.padding);
    if (stackedHeightOf(candidateRows, cfg.padding) <= viewport.height) {
      return candidate;
    }
  }

  return sized;
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
    const kMax = Math.min(viewport.height / stackedH, cfg.maxGrowth);
    sized = findWorkableGrowth(sized, kMax, viewport, cfg);
  }

  const { rows: fittedRows, dropped } = fitToViewport(sized, viewport, cfg);
  const placed = placeTiles(fittedRows, viewport, cfg);

  return { tiles: placed, dropped, viewport };
}
