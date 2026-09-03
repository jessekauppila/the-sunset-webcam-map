import SunCalc from 'suncalc';

/**
 * The camera-finding cron searches around masterConfig.TERMINATOR_SUN_ALTITUDE_DEG
 * — the pool IS a band of solar altitudes centred on that value, and that is
 * why altitude works as the mosaic's horizontal axis.
 */
const DEG_PER_RAD = 180 / Math.PI;

/**
 * The sun's altitude above the horizon at a place and moment, in degrees.
 * Negative below the horizon. This is the "depth into twilight" signal:
 * measured corr(lat, altitude) is ~0.06 on a real pool, so it carries
 * information the latitude axis does not.
 */
export function sunAltitudeDeg(at: Date, lat: number, lng: number): number {
  return SunCalc.getPosition(at, lat, lng).altitude * DEG_PER_RAD;
}
