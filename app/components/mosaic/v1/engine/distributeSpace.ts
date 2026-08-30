import type { CompositionConfig, PlacedTile } from './types';
import type { Row } from './bandRows';

/**
 * Distributes leftover viewport space (sparse layouts) or packs rows tightly
 * (dense layouts) based on the geographic (lat/lng) gaps between rows and
 * tiles. Pure function: no DOM/window/Image access.
 */
export function placeTiles(
  rows: Row[],
  viewport: { width: number; height: number },
  cfg: CompositionConfig
): PlacedTile[] {
  if (rows.length === 0) return [];

  const { padding } = cfg;
  const [north, south] = cfg.latWindow;

  // ---- Vertical distribution ----
  const sumRowHeights = rows.reduce((sum, r) => sum + r.height, 0);
  const S = Math.max(
    0,
    viewport.height - (sumRowHeights + padding * (rows.length - 1))
  );

  const vWeights: number[] = [];
  vWeights.push(Math.max(0, north - rows[0].meanLat)); // topGap
  for (let i = 0; i < rows.length - 1; i++) {
    vWeights.push(Math.max(0, rows[i].meanLat - rows[i + 1].meanLat)); // between
  }
  vWeights.push(Math.max(0, rows[rows.length - 1].meanLat - south)); // bottomGap

  const sumVWeights = vWeights.reduce((a, b) => a + b, 0);
  const vShares =
    sumVWeights > 0
      ? vWeights.map((w) => (w / sumVWeights) * S)
      : vWeights.map(() => S / vWeights.length);

  const rowYs: number[] = [];
  let y = vShares[0];
  for (let i = 0; i < rows.length; i++) {
    rowYs.push(y);
    if (i < rows.length - 1) {
      y = y + rows[i].height + padding + vShares[i + 1];
    }
  }

  // ---- Horizontal pool (lng range across all rows' tiles) ----
  let poolMinLng = Infinity;
  let poolMaxLng = -Infinity;
  for (const row of rows) {
    for (const tile of row.tiles) {
      if (tile.lng < poolMinLng) poolMinLng = tile.lng;
      if (tile.lng > poolMaxLng) poolMaxLng = tile.lng;
    }
  }

  const placed: PlacedTile[] = [];

  rows.forEach((row, rowIdx) => {
    const rowY = rowYs[rowIdx];
    const Sx = Math.max(0, viewport.width - row.totalWidth);

    const hWeights: number[] = [];
    hWeights.push(Math.max(0, row.tiles[0].lng - poolMinLng)); // leftGap
    for (let i = 0; i < row.tiles.length - 1; i++) {
      hWeights.push(Math.max(0, row.tiles[i + 1].lng - row.tiles[i].lng)); // between
    }
    hWeights.push(Math.max(0, poolMaxLng - row.tiles[row.tiles.length - 1].lng)); // rightGap

    const sumHWeights = hWeights.reduce((a, b) => a + b, 0);

    let x: number;
    let hShares: number[];
    if (sumHWeights > 0) {
      hShares = hWeights.map((w) => (w / sumHWeights) * Sx);
      x = hShares[0];
    } else {
      // center the row: equal left/right margins, tiles packed with padding
      hShares = hWeights.map(() => 0);
      x = Sx / 2;
    }

    row.tiles.forEach((tile, i) => {
      const tileY = rowY + (row.height - tile.height) / 2;
      placed.push({ ...tile, x, y: tileY });
      if (i < row.tiles.length - 1) {
        x = x + tile.width + padding + hShares[i + 1];
      }
    });
  });

  return placed;
}
