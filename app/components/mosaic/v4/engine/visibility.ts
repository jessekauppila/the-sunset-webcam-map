import type { TileInput, V4Config } from './types';

/**
 * Descending by score with unscored last, then ascending by id. The id
 * tie-break matters: without it, equal-scoring tiles would reorder between
 * ticks and the layout would churn for no reason.
 */
function byScoreDesc(a: TileInput, b: TileInput): number {
  const as = a.score, bs = b.score;
  if (as === null && bs === null) return a.id - b.id;
  if (as === null) return 1;
  if (bs === null) return -1;
  if (as !== bs) return bs - as;
  return a.id - b.id;
}

export function splitPool(tiles: TileInput[]): {
  passers: TileInput[];
  failers: TileInput[];
} {
  const passers = tiles.filter((t) => t.passes).sort(byScoreDesc);
  const failers = tiles.filter((t) => !t.passes).sort(byScoreDesc);
  return { passers, failers };
}

/**
 * Which tiles are candidates for arrangement. `showIfRoom` cannot be decided
 * here — it depends on how much space the composed layout has left — so it
 * behaves like showAtFloor at this stage and compose() trims it down.
 */
export function applyPolicy(
  passers: TileInput[],
  failers: TileInput[],
  cfg: V4Config
): TileInput[] {
  if (cfg.failedCamPolicy === 'hide') return [...passers];
  return [...passers, ...failers];
}

/** A hard ceiling on tile count. Passers lead the list, so they survive first. */
export function capTiles(tiles: TileInput[], maxTiles: number): TileInput[] {
  if (maxTiles <= 0) return tiles;
  return tiles.slice(0, maxTiles);
}
