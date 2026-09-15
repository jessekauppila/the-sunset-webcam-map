import type { Location } from '@/app/lib/types';
import { boundingBox, type BoundingBox } from '@/app/lib/sweepBox';

/**
 * The swept band as a point test.
 *
 * The Windy sweep asks for cameras inside one box per ring coordinate
 * (boundingBox, SEARCH_RADIUS_DEG). A source that hands us its whole catalogue
 * has to be cut to the same shape, or its cameras would enter the pool on a
 * different rule from Windy's and leave it on the retention grace alone. Same
 * function, same radius, same clamping at the poles and the antimeridian.
 */
export function withinSweptBoxes(
  coords: Location[],
  radiusDeg: number,
): (lat: number, lng: number) => boolean {
  const boxes: BoundingBox[] = coords.map((c) => boundingBox(c, radiusDeg));
  return (lat, lng) =>
    boxes.some(
      (b) => lat <= b.northLat && lat >= b.southLat && lng <= b.eastLon && lng >= b.westLon,
    );
}
