// Pure solar math for the setup wizard's sun-arc overlay.
// Ported verbatim (typed) from the verified bracket prototype
// (sunset-cam-firmware/docs/prototypes/2026-06-12-window-bracket-prototype.jsx).
// NOAA approximation, good to ~±1° — fine for placement guidance.

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** Signed smallest angular difference a−b, in (−180, 180]. */
export const angDiff = (a: number, b: number) => ((a - b + 540) % 360) - 180;

function julianDay(date: Date): number {
  let y = date.getUTCFullYear();
  let m = date.getUTCMonth() + 1;
  const d = date.getUTCDate();
  if (m <= 2) {
    y -= 1;
    m += 12;
  }
  const a = Math.floor(y / 100);
  const b = 2 - a + Math.floor(a / 4);
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + d + b - 1524.5;
}

/** Solar declination (degrees) for a date, NOAA Spencer approximation. */
export function solarDeclination(date: Date): number {
  const n = julianDay(date) + 0.5 - 2451545.0;
  const g = rad((357.528 + 0.9856003 * n) % 360);
  const lam = rad((280.46 + 0.9856474 * n + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) % 360);
  const eps = rad(23.439 - 0.0000004 * n);
  return deg(Math.asin(Math.sin(eps) * Math.sin(lam)));
}

/** Sunset azimuth (degrees from North, clockwise) at a latitude on a date. Sunset is westward. */
export function sunsetAzimuth(latDeg: number, date: Date): number {
  const declR = rad(solarDeclination(date));
  let cosA = Math.sin(declR) / Math.cos(rad(latDeg));
  cosA = Math.max(-1, Math.min(1, cosA));
  return (360 - deg(Math.acos(cosA))) % 360;
}

/** Sunrise azimuth = mirror of sunset across the N-S meridian. */
export const sunriseAzimuth = (lat: number, date: Date) => (360 - sunsetAzimuth(lat, date)) % 360;

export type Facing = 'east' | 'west';

export const eventAz = (lat: number, date: Date, facing: Facing) =>
  facing === 'east' ? sunriseAzimuth(lat, date) : sunsetAzimuth(lat, date);

export interface ArcAnchors {
  jun: number;
  equinox: number;
  dec: number;
  today: number;
}

/** The three solar-arc anchor azimuths (+ today) for the AR overlay. */
export function arcAnchors(lat: number, year: number, facing: Facing): ArcAnchors {
  return {
    jun: eventAz(lat, new Date(Date.UTC(year, 5, 21)), facing),
    equinox: eventAz(lat, new Date(Date.UTC(year, 2, 20)), facing),
    dec: eventAz(lat, new Date(Date.UTC(year, 11, 21)), facing),
    today: eventAz(lat, new Date(), facing),
  };
}

/** Project a true-north azimuth to a horizontal screen x for a view centered on centerAz. */
export const azToX = (az: number, centerAz: number, fovDeg: number, width: number) =>
  width * (0.5 + angDiff(az, centerAz) / fovDeg);
