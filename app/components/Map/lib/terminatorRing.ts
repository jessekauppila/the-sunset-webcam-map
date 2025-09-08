// npm i solar-calculator d3-geo
//import * as solar from "solar-calculator";
import { geoCircle } from 'd3-geo';
import { subsolarPoint } from './subsolarLocation';
import type { Location } from '../../../lib/types';
import type { Feature, LineString } from 'geojson';

// ---------- tiny math helpers ----------
//const DEG = Math.PI / 180;
//const RAD = 1 / DEG;
const normHours = (h: number) => ((h % 24) + 24) % 24;
//const normDeg = (d: number) =>
// ((((d + 180) % 360) + 360) % 360) - 180;
const normSignedHours = (h: number) => {
  // Normalize to (-12, +12]
  const x = normHours(h);
  return x > 12 ? x - 24 : x;
};

/** Build the terminator ring (GeoJSON Polygon) centered on subsolar point. */
export function terminatorPolygon(
  date = new Date(),
  precisionDeg = 0.5,
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
export function splitTerminatorSunriseSunset(
  date: Date,
  RA: number,
  GMST: number
): {
  sunriseCoords: Location[];
  sunsetCoords: Location[];
  sunrise: Feature<LineString>;
  sunset: Feature<LineString>;
} {
  //const { raHours: RA, gmstHours: GMST } = subsolarPoint(date);
  const ring = terminatorPolygon(date).coordinates[0]; // [ [lon,lat], ... , first point repeats ]
  // We’ll traverse segments and allocate them into sunrise/sunset by HA sign.
  const sunriseCoords: Location[] = [];
  const sunsetCoords: Location[] = [];

  const pushTo = (arr: Location[], pt: number[]) => {
    // Avoid duplicating back-to-back identical points
    if (
      arr.length === 0 ||
      arr[arr.length - 1].lat !== pt[1] ||
      arr[arr.length - 1].lng !== pt[0]
    ) {
      arr.push({ lat: pt[1], lng: pt[0] }); // Transform to Location
    }
  };

  // Helper: hour angle at a given longitude (hours)
  const hourAngle = (lonDeg: number) => {
    const LST = normHours(GMST + lonDeg / 15);
    return normSignedHours(LST - RA); // (-12,+12], negative=east (morning)
  };

  // Walk the ring and split at sign changes so each set stays contiguous.
  let currentSet: 'sunrise' | 'sunset' | null = null;

  for (let i = 0; i < ring.length - 1; i++) {
    // last == first; we stop at length - 1
    const a = ring[i];
    const b = ring[i + 1];

    const HAa = hourAngle(a[0]);
    const HAb = hourAngle(b[0]);

    const aIsSunrise = HAa < 0;
    const bIsSunrise = HAb < 0;

    // Start a set if needed
    if (!currentSet) currentSet = aIsSunrise ? 'sunrise' : 'sunset';

    // Push point a into the active set
    if (currentSet === 'sunrise') pushTo(sunriseCoords, a);
    else pushTo(sunsetCoords, a);

    // If the sign flips between a and b, we’re crossing sunrise↔sunset boundary.
    if (aIsSunrise !== bIsSunrise) {
      // Optionally, you could interpolate the exact split point here.
      // For map visualization, adding 'b' to the new set is sufficient.
      currentSet = bIsSunrise ? 'sunrise' : 'sunset';
    }
  }

  // Build GeoJSON LineStrings
  const sunrise = {
    type: 'Feature' as const,
    properties: { type: 'sunrise' as const },
    geometry: {
      type: 'LineString' as const,
      coordinates: sunriseCoords.map((loc) => [loc.lng, loc.lat]), // Convert back for GeoJSON
    },
  };
  const sunset = {
    type: 'Feature' as const,
    properties: { type: 'sunset' as const },
    geometry: {
      type: 'LineString' as const,
      coordinates: sunsetCoords.map((loc) => [loc.lng, loc.lat]), // Convert back for GeoJSON
    },
  };

  return { sunriseCoords, sunsetCoords, sunrise, sunset };
}
