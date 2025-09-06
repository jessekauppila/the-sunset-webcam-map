// npm i solar-calculator d3-geo
//import * as solar from "solar-calculator";
import { geoCircle } from 'd3-geo';
import { subsolarPoint } from './subsolarLocation';

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
  precisionDeg = 0.5
) {
  const { lat, lng } = subsolarPoint(date);
  return geoCircle()
    .center([lng, lat])
    .radius(90)
    .precision(precisionDeg)();
}

/** Split the terminator ring into sunrise/sunset LineStrings.
 * Returns { sunrise, sunset } as GeoJSON LineStrings.
 */
export function splitTerminatorSunriseSunset(
  date: Date,
  RA: number,
  GMST: number
) {
  //const { raHours: RA, gmstHours: GMST } = subsolarPoint(date);
  const ring = terminatorPolygon(date).coordinates[0]; // [ [lon,lat], ... , first point repeats ]
  // We’ll traverse segments and allocate them into sunrise/sunset by HA sign.
  const sunriseCoords: number[][] = [];
  const sunsetCoords: number[][] = [];

  const pushTo = (arr: number[][], pt: number[]) => {
    // Avoid duplicating back-to-back identical points
    if (
      arr.length === 0 ||
      arr[arr.length - 1][0] !== pt[0] ||
      arr[arr.length - 1][1] !== pt[1]
    ) {
      arr.push(pt);
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
      coordinates: sunriseCoords,
    },
  };
  const sunset = {
    type: 'Feature' as const,
    properties: { type: 'sunset' as const },
    geometry: {
      type: 'LineString' as const,
      coordinates: sunsetCoords,
    },
  };

  return { sunriseCoords, sunsetCoords, sunrise, sunset };
}
