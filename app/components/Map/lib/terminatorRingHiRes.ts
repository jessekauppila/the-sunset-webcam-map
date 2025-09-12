import { geoCircle } from 'd3-geo';
import { subsolarPoint } from './subsolarLocation';
import type { Location } from '../../../lib/types';
import type { Feature, LineString } from 'geojson';

// ---------- tiny math helpers ----------
const normHours = (h: number) => ((h % 24) + 24) % 24;

/** Build the terminator ring (GeoJSON Polygon) centered on subsolar point. */
export function terminatorPolygon(
  date = new Date(),
  precisionDeg = 1,
  sunAltitudeDegrees = 0 // this is used to calculate the angle/altitude of the sun in the sky
) {
  const { lat, lng } = subsolarPoint(date);
  const radius = 90 - sunAltitudeDegrees;

  return (
    geoCircle()
      .center([lng, lat])
      .radius(radius)

      // 90° = Sunset/sunrise (0° altitude)
      // 84° = Sun 6° above horizon (golden hour)
      // 78° = Sun 12° above horizon (good lighting)
      // 72° = Sun 18° above horizon (civil twilight)
      .precision(precisionDeg)()
  );
}
/** Split the terminator ring into sunrise/sunset LineStrings.
 * Returns { sunrise, sunset } as GeoJSON LineStrings.
 */
export function createTerminatorRingHiRes(date: Date): {
  entireHiResTerminatorRing: Feature<LineString>;
} {
  //const { raHours: RA, gmstHours: GMST } = subsolarPoint(date);
  const ring = terminatorPolygon(date).coordinates[0]; // [ [lon,lat], ... , first point repeats ]

  // Convert ring to Location objects for consistency
  const allTerminatorCoords: Location[] = ring.map((coord) => ({
    lng: coord[0],
    lat: coord[1],
  }));

  // Build GeoJSON LineStrings
  const entireHiResTerminatorRing = {
    type: 'Feature' as const,
    properties: { type: 'entireTerminatorRing' as const },
    geometry: {
      type: 'LineString' as const,
      coordinates: allTerminatorCoords.map((loc) => [
        loc.lng,
        loc.lat,
      ]),
    },
  };

  return {
    entireHiResTerminatorRing,
  };
}
