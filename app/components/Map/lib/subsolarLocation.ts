// npm i solar-calculator
// @ts-expect-error - solar-calculator has no type definitions
import * as solar from 'solar-calculator';

// ---------- tiny math helpers ----------
const DEG = Math.PI / 180;
const RAD = 1 / DEG;
const normHours = (h: number) => ((h % 24) + 24) % 24;
const normDeg = (d: number) =>
  ((((d + 180) % 360) + 360) % 360) - 180;

// Greenwich Mean Sidereal Time (hours), USNO approx.
// D = days since J2000 (JD_UT - 2451545.0)
function gmstHours(date: Date): number {
  const jd = date.valueOf() / 86400000 + 2440587.5; // Unix ms → JD_UTC
  const D = jd - 2451545.0;
  const GMST = 18.697374558 + 24.06570982441908 * D; // hours
  return normHours(GMST);
}

// Right ascension (hours) from ecliptic longitude & obliquity.
function raHours(
  apparentLongitudeDeg: number,
  obliquityDeg: number
): number {
  const L = apparentLongitudeDeg * DEG;
  const e = obliquityDeg * DEG;
  const y = Math.cos(e) * Math.sin(L);
  const x = Math.cos(L);
  const raRad = Math.atan2(y, x);
  const raHours = normHours((raRad * RAD) / 15); // radians → hours
  return raHours;
}

/** Subsolar point at given time.
 *  Returns { lon, lat } in degrees. Longitude is [-180, +180], east-positive.
 */
export function subsolarPoint(date = new Date()): {
  lat: number;
  lng: number;
  // raHours: number;
  // gmstHours: number;
} {
  // 1) J2000 centuries
  const t = solar.century(date);

  // 2) Subsolar latitude = Sun’s declination (degrees)
  const lat = solar.declination(t);

  // 3) Sun’s apparent right ascension α (hours)
  const Lapp = solar.apparentLongitude(t); // degrees
  const eps = solar.obliquityOfEcliptic(t); // degrees
  const alpha = raHours(Lapp, eps); // hours

  // 4) GMST at Greenwich (hours)
  const gmst = gmstHours(date);

  // 5) Subsolar longitude λ = 15° * (α - GMST)
  const lng = normDeg((alpha - gmst) * 15);

  return {
    lat,
    lng,
    // raHours: alpha,
    // gmstHours: gmst,
  };
}
