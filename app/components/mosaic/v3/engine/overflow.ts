import type { SizedTile } from './types';

/**
 * How far the composition may shrink before dropping tiles becomes the
 * lesser evil. Below this everything is too small to read anyway.
 */
export const MIN_COMPOSITION_SCALE = 0.35;

/** Uniform scale — relative hierarchy and aspect ratios are preserved. */
export function scaleTiles(tiles: SizedTile[], k: number): SizedTile[] {
  if (k === 1) return tiles;
  return tiles.map((t) => ({ ...t, width: t.width * k, height: t.height * k }));
}
