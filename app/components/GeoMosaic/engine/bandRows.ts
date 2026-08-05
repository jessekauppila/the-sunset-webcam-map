import type { SizedTile } from './types';

export interface Row {
  tiles: SizedTile[];
  height: number;
  meanLat: number;
  totalWidth: number;
}

function closeRow(tiles: SizedTile[], padding: number): Row {
  const sorted = [...tiles].sort((a, b) => a.lng - b.lng);
  const height = Math.max(...sorted.map((t) => t.height));
  const meanLat = sorted.reduce((sum, t) => sum + t.lat, 0) / sorted.length;
  const totalWidth =
    sorted.reduce((sum, t) => sum + t.width, 0) + padding * (sorted.length - 1);
  return { tiles: sorted, height, meanLat, totalWidth };
}

export function formRows(
  tiles: SizedTile[],
  viewportWidth: number,
  padding: number
): Row[] {
  const ordered = [...tiles].sort((a, b) => b.lat - a.lat);

  const rows: Row[] = [];
  let current: SizedTile[] = [];
  let currentWidth = 0;

  for (const tile of ordered) {
    if (current.length > 0) {
      const prospectiveWidth = currentWidth + padding + tile.width;
      if (prospectiveWidth > viewportWidth) {
        rows.push(closeRow(current, padding));
        current = [];
        currentWidth = 0;
      }
    }

    if (current.length === 0) {
      current = [tile];
      currentWidth = tile.width;
    } else {
      current.push(tile);
      currentWidth += padding + tile.width;
    }
  }

  if (current.length > 0) {
    rows.push(closeRow(current, padding));
  }

  return rows;
}
