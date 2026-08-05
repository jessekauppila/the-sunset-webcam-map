import { formRows, type Row } from './bandRows';
import type { SizedTile, CompositionConfig } from './types';

export interface FitResult {
  rows: Row[];
  kept: SizedTile[];
  dropped: number[];
}

const COMPRESS_STEP = 0.02;

function stackedHeight(rows: Row[], padding: number): number {
  if (rows.length === 0) return 0;
  return (
    rows.reduce((sum, row) => sum + row.height, 0) + padding * (rows.length - 1)
  );
}

/**
 * Removal priority for cull mode: lowest percentile first; ties broken by
 * lower score first (null score treated as lowest); further ties broken by
 * higher id first, for determinism.
 */
function removalPriority(a: SizedTile, b: SizedTile): number {
  if (a.percentile !== b.percentile) return a.percentile - b.percentile;
  const scoreA = a.score ?? -Infinity;
  const scoreB = b.score ?? -Infinity;
  if (scoreA !== scoreB) return scoreA - scoreB;
  return b.id - a.id;
}

/**
 * Repeatedly removes the single worst tile (per removalPriority), re-forming
 * rows each time, until the layout fits or only one tile remains. Never
 * drops the final tile.
 */
function cullMode(
  tiles: SizedTile[],
  viewport: { width: number; height: number },
  cfg: CompositionConfig
): FitResult {
  const removalOrder = [...tiles].sort(removalPriority);
  let removeIdx = 0;
  let remaining = tiles;
  let rows = formRows(remaining, viewport.width, cfg.padding);
  const dropped: number[] = [];

  while (
    stackedHeight(rows, cfg.padding) > viewport.height &&
    remaining.length > 1 &&
    removeIdx < removalOrder.length
  ) {
    const victimId = removalOrder[removeIdx].id;
    removeIdx += 1;
    if (!remaining.some((t) => t.id === victimId)) continue;
    remaining = remaining.filter((t) => t.id !== victimId);
    dropped.push(victimId);
    rows = formRows(remaining, viewport.width, cfg.padding);
  }

  return { rows, kept: remaining, dropped };
}

/**
 * Applies a uniform scale `s` to every tile's width/height, except tiles
 * whose starting height is already at or below floorPx (left unscaled).
 * Scaled height is clamped at floorPx; width scales by the same ratio the
 * height actually moved, preserving aspect ratio.
 */
function scaleTiles(
  tiles: SizedTile[],
  s: number,
  floorPx: number
): SizedTile[] {
  return tiles.map((t) => {
    if (t.height <= floorPx) return t;
    const newHeight = Math.max(floorPx, t.height * s);
    const ratio = newHeight / t.height;
    return { ...t, width: t.width * ratio, height: newHeight };
  });
}

/**
 * The largest `s` at which every scalable tile (height > floorPx) has been
 * clamped down to exactly floorPx. Below this value, further reducing `s`
 * has no effect. Returns null if no tile is scalable at all.
 */
function fullFloorThreshold(tiles: SizedTile[], floorPx: number): number | null {
  const scalable = tiles.filter((t) => t.height > floorPx);
  if (scalable.length === 0) return null;
  return Math.min(...scalable.map((t) => floorPx / t.height));
}

function compressMode(
  tiles: SizedTile[],
  viewport: { width: number; height: number },
  cfg: CompositionConfig
): FitResult {
  const sFloor = fullFloorThreshold(tiles, cfg.floorPx);

  if (sFloor !== null) {
    let s = 1 - COMPRESS_STEP;
    while (s > sFloor) {
      const scaled = scaleTiles(tiles, s, cfg.floorPx);
      const rows = formRows(scaled, viewport.width, cfg.padding);
      if (stackedHeight(rows, cfg.padding) <= viewport.height) {
        return { rows, kept: scaled, dropped: [] };
      }
      s -= COMPRESS_STEP;
    }
  }

  // Every scalable tile is now at floorPx (or nothing was scalable at all).
  // If that still overflows, fall back to culling from this floor-state.
  const floored = sFloor === null ? tiles : scaleTiles(tiles, sFloor, cfg.floorPx);
  const flooredRows = formRows(floored, viewport.width, cfg.padding);
  if (stackedHeight(flooredRows, cfg.padding) <= viewport.height) {
    return { rows: flooredRows, kept: floored, dropped: [] };
  }
  return cullMode(floored, viewport, cfg);
}

export function fitToViewport(
  tiles: SizedTile[],
  viewport: { width: number; height: number },
  cfg: CompositionConfig
): FitResult {
  const initialRows = formRows(tiles, viewport.width, cfg.padding);
  if (stackedHeight(initialRows, cfg.padding) <= viewport.height) {
    return { rows: initialRows, kept: tiles, dropped: [] };
  }

  return cfg.cullOverflow
    ? cullMode(tiles, viewport, cfg)
    : compressMode(tiles, viewport, cfg);
}
