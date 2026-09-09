import SunCalc from 'suncalc';
import { solarPhaseAt, sunAltitudeDeg } from '@/app/lib/solarPhase';
import type { Feed } from './types';

export { sunAltitudeDeg };

/**
 * Which feed a place belongs to right now: rising sun is sunrise, falling is
 * sunset. The test itself lives in `app/lib/solarPhase.ts`, because the same
 * question is asked of an archived frame on the leaderboard. A `Feed` and a
 * `SolarPhase` are the same two words, so this is a name, not a conversion.
 */
export function feedAt(at: Date, lat: number, lng: number): Feed {
  return solarPhaseAt(at, lat, lng);
}

/** The swept altitude band, from sweepGeometry's coverage span. */
export interface Zone {
  minDeg: number;
  maxDeg: number;
}

/**
 * Removal is by zone, not by absence (spec §5.3): a camera is in a feed's zone
 * when its sun sits inside the swept band AND is moving the feed's way.
 */
export function inFeedZone(at: Date, lat: number, lng: number, feed: Feed, zone: Zone): boolean {
  const alt = sunAltitudeDeg(at, lat, lng);
  return alt >= zone.minDeg && alt <= zone.maxDeg && feedAt(at, lat, lng) === feed;
}

/**
 * The moment the sun crosses the horizon at a place, on the day of `at`, and
 * which crossing it is. Sunrise when the sun is climbing, sunset when it is
 * falling, so a frame is always measured against the event it belongs to.
 *
 * The caption uses this to say "Sunset 20 minutes ago" instead of counting
 * down to one. Only the past tense is safe to print: a ridge, a building or a
 * bank of cloud can only ever take the sun away EARLIER than this instant,
 * never later, so a countdown gets contradicted by the picture it captions
 * while an elapsed time never does.
 *
 * Null when SunCalc has no crossing to report, which happens inside the polar
 * circles for much of the year.
 */
export function sunEventAt(
  at: Date, lat: number, lng: number,
): { at: number; phase: Feed } | null {
  const phase = solarPhaseAt(at, lat, lng);
  const times = SunCalc.getTimes(at, lat, lng);
  const when = phase === 'sunrise' ? times.sunrise : times.sunset;
  const ms = when instanceof Date ? when.getTime() : NaN;
  return Number.isFinite(ms) ? { at: ms, phase } : null;
}
