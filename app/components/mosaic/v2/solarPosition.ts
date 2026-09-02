import SunCalc from 'suncalc';

/**
 * The altitude the terminator band is centred on. Mirrors
 * masterConfig.TERMINATOR_SUN_ALTITUDE_DEG, which is what the camera-finding
 * cron actually searches around — the pool IS a band of solar altitudes, and
 * that is why altitude works as v2's horizontal axis.
 */
export const TERMINATOR_ALTITUDE_DEG = -13;

const DEG_PER_RAD = 180 / Math.PI;

/**
 * The sun's altitude above the horizon at a place and moment, in degrees.
 * Negative below the horizon. This is v2's "depth into twilight" signal:
 * measured corr(lat, altitude) is ~0.06 on a real pool, so it carries
 * information the latitude axis does not.
 */
export function sunAltitudeDeg(at: Date, lat: number, lng: number): number {
  return SunCalc.getPosition(at, lat, lng).altitude * DEG_PER_RAD;
}
