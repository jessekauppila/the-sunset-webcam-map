import type { CanvasItem } from './types';

/**
 * Organize webcams into latitude-based rows (bands)
 * Items are sorted north to south, then west to east within each row
 */
export function createLatitudeBands(
  items: CanvasItem[],
  targetRows: number
): CanvasItem[][] {
  if (items.length === 0 || targetRows === 0) return [];

  const out: CanvasItem[][] = [];

  // Calculate latitude ranges for each row
  const minLat = Math.min(...items.map((item) => item.lat));
  const maxLat = Math.max(...items.map((item) => item.lat));
  const latRange = maxLat - minLat;
  const latStep = latRange / targetRows;

  for (let i = 0; i < targetRows; i++) {
    const rowMinLat = minLat + i * latStep;
    const rowMaxLat = minLat + (i + 1) * latStep;

    // Find items in this latitude range
    const rowItems = items.filter(
      (item) => item.lat >= rowMinLat && item.lat < rowMaxLat
    );

    // Sort by longitude (west → east) within each row
    rowItems.sort((a, b) => a.lng - b.lng);

    // Always add the row, even if empty (for geographic positioning)
    out.push(rowItems);
  }

  return out;
}

/**
 * Calculate optimal number of rows based on screen size and image count
 */
export function calculateOptimalRows(
  totalImages: number,
  height: number,
  baseHeight: number,
  minRows: number,
  maxRows: number,
  padding: number,
  fillScreenHeight: boolean
): number {
  if (totalImages === 0) return minRows;

  let targetRows: number;

  if (fillScreenHeight) {
    // Calculate rows based on available height and minimum row height
    const availableHeight = height - padding * 2; // Account for top/bottom padding
    const minRowHeight = baseHeight * 0.2; // Minimum 20% of base height
    const maxRowsFromHeight = Math.floor(
      availableHeight / (minRowHeight + padding)
    );

    // Use the smaller of: maxRowsFromHeight, maxRows, or totalImages
    targetRows = Math.min(maxRowsFromHeight, maxRows, totalImages);
    targetRows = Math.max(minRows, targetRows); // Ensure minimum rows
  } else {
    // Use fixed calculation based on image count
    targetRows = Math.min(
      Math.max(minRows, Math.ceil(Math.sqrt(totalImages))),
      maxRows
    );
  }

  return targetRows;
}

/**
 * Calculate dynamic base height to fill screen
 */
export function calculateDynamicBaseHeight(
  targetRows: number,
  height: number,
  baseHeight: number,
  padding: number,
  fillScreenHeight: boolean
): number {
  if (!fillScreenHeight || targetRows === 0) return baseHeight;

  const availableHeight = height - padding * 2;
  const totalPaddingHeight = padding * (targetRows - 1);
  const availableForImages = availableHeight - totalPaddingHeight;
  const calculatedBaseHeight = Math.max(
    baseHeight * 0.2,
    availableForImages / targetRows
  );

  return calculatedBaseHeight;
}
