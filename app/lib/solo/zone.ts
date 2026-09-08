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
