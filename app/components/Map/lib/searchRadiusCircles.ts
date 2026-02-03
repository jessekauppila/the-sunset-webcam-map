import { geoCircle } from 'd3-geo';
import type { Location } from '../../../lib/types';
import type { Feature, Polygon } from 'geojson';
import { CIRCLE_RENDERING_PRECISION_DEG } from '@/app/api/cron/update-windy/route';

/**
 * Creates circles (polygons) around terminator points to visualize search coverage
 * @param points - Array of terminator point locations
 * @param radiusDegrees - Search radius in degrees (must match cron job SEARCH_RADIUS_DEG)
 * @returns GeoJSON FeatureCollection of circle polygons
 */
export function createSearchRadiusCircles(
  points: Location[],
  radiusDegrees: number
): Feature<Polygon>[] {
  const circles: Feature<Polygon>[] = points.map((point, index) => {
    // Create a circle around each point
    // radiusDegrees is converted to approximate km: 1° ≈ 111 km
    // geoCircle expects radius in degrees for small circles
    const circle = geoCircle()
      .center([point.lng, point.lat])
      .radius(radiusDegrees)
      .precision(CIRCLE_RENDERING_PRECISION_DEG)(); // Use configured precision for the circle shape

    return {
      type: 'Feature' as const,
      properties: {
        pointIndex: index,
        centerLat: point.lat,
        centerLng: point.lng,
        radiusDegrees,
      },
      geometry: {
        type: 'Polygon' as const,
        coordinates: circle.coordinates,
      },
    };
  });

  return circles;
}

