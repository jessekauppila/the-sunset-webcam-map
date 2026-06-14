// Pure geo helpers for the placement flow. ADVISORY ONLY — nothing here mutates
// state; the wizard uses suggestMode to pre-select the default the human confirms,
// and haversineMeters to power the non-blocking "nearby" FYI.
const EARTH_RADIUS_M = 6_371_000;
export const NEW_LOCATION_THRESHOLD_M = 100;

export function haversineMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

export type PlacementMode = 'reaim' | 'new';

export function suggestMode(distanceM: number): PlacementMode {
  return distanceM > NEW_LOCATION_THRESHOLD_M ? 'new' : 'reaim';
}
