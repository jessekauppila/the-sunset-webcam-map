import type { Location } from '@/app/lib/types';

export interface BoundingBox {
  northLat: number;
  southLat: number;
  eastLon: number;
  westLon: number;
}

/**
 * The lat/lng box one Windy query covers around a ring point. Shared by the
 * cron that sends it and the globe overlay that draws it, so the picture on
 * the map is the query, not an approximation of it.
 *
 * Clamped at the poles and the antimeridian: Windy rejects a box that crosses
 * either with a 400, and about 2 of 31 boxes per sweep sat there. Clamping
 * shrinks the box rather than wrapping it, so a box straddling the
 * antimeridian loses the sliver on the far side; that stretch is open ocean
 * and a shrunken box still beats a 400.
 */
export function boundingBox(loc: Location, radiusDeg: number): BoundingBox {
  return {
    northLat: Math.min(90, loc.lat + radiusDeg),
    southLat: Math.max(-90, loc.lat - radiusDeg),
    eastLon: Math.min(180, loc.lng + radiusDeg),
    westLon: Math.max(-180, loc.lng - radiusDeg),
  };
}
