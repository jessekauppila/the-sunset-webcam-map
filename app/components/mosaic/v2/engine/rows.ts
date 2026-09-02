import type { Row, SizedTile } from './types';

/**
 * Greedy north-to-south row formation, width-limited. Row membership is by
 * ORDER, not by latitude bucket — two tiles at nearly the same latitude may
 * land in different rows if the first one filled up, which is correct: the
 * vertical stage puts each row at its own mean latitude anyway.
 */
export function formRows(
  tiles: SizedTile[],
  viewportWidth: number,
  gap: number
): Row[] {
  if (tiles.length === 0) return [];

  const northToSouth = [...tiles].sort((a, b) => b.lat - a.lat || a.id - b.id);
  const groups: SizedTile[][] = [];
  let current: SizedTile[] = [];
  let usedWidth = 0;

  for (const tile of northToSouth) {
    const addedWidth = current.length === 0 ? tile.width : gap + tile.width;
    // `current.length > 0` guarantees a single over-wide tile still lands
    // somewhere instead of spinning on an empty row forever.
    if (current.length > 0 && usedWidth + addedWidth > viewportWidth) {
      groups.push(current);
      current = [];
      usedWidth = 0;
    }
    usedWidth += current.length === 0 ? tile.width : gap + tile.width;
    current.push(tile);
  }
  if (current.length > 0) groups.push(current);

  return groups.map((members) => ({
    tiles: members,
    height: Math.max(...members.map((t) => t.height)),
    meanLat: members.reduce((sum, t) => sum + t.lat, 0) / members.length,
  }));
}
