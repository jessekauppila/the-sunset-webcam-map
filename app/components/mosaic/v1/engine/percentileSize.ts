import type { CompositionConfig, SizedTile, TileInput } from './types';

/**
 * Rank scored tiles ascending by score and map each to a percentile in
 * [0, 1]: percentile = rank / (scoredCount - 1). A single scored tile
 * gets percentile 1. Ties share the mean of their ranks' percentiles.
 * Unscored tiles always get 0.5, independent of the scored distribution.
 */
export function computePercentiles(tiles: TileInput[]): Map<number, number> {
  const result = new Map<number, number>();

  const scored = tiles.filter(
    (t): t is TileInput & { score: number } => t.score !== null
  );
  const unscored = tiles.filter((t) => t.score === null);

  const n = scored.length;
  if (n === 1) {
    result.set(scored[0].id, 1);
  } else if (n > 1) {
    const sorted = [...scored].sort((a, b) => a.score - b.score);
    let i = 0;
    while (i < n) {
      let j = i;
      while (j < n && sorted[j].score === sorted[i].score) j++;
      let sum = 0;
      for (let k = i; k < j; k++) sum += k / (n - 1);
      const mean = sum / (j - i);
      for (let k = i; k < j; k++) result.set(sorted[k].id, mean);
      i = j;
    }
  }

  for (const u of unscored) result.set(u.id, 0.5);

  return result;
}

/**
 * Preferred laid-out height for a tile given its percentile within the
 * scored pool. Interpolates linearly between floorPx (percentile 0) and
 * ceilPx (percentile 1), then clamps to the upscale ceiling. The upscale
 * ceiling may legitimately push the result below the floor for tiny
 * source images — quality beats legibility for tiny sources.
 */
export function preferredHeight(
  t: TileInput,
  percentile: number,
  cfg: CompositionConfig
): number {
  return Math.min(
    cfg.floorPx + (cfg.ceilPx - cfg.floorPx) * percentile,
    t.srcHeight * cfg.upscaleMax
  );
}

/**
 * Sizes every tile: computes percentiles across the whole pool, derives
 * a preferred height per tile, and scales width to preserve the source
 * aspect ratio.
 */
export function sizeTiles(
  tiles: TileInput[],
  cfg: CompositionConfig
): SizedTile[] {
  const percentiles = computePercentiles(tiles);

  return tiles.map((t) => {
    const percentile = percentiles.get(t.id) ?? 0.5;
    const height = preferredHeight(t, percentile, cfg);
    const width = height * (t.srcWidth / t.srcHeight);
    return { ...t, percentile, width, height };
  });
}
