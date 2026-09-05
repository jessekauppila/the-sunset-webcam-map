import SunCalc from 'suncalc';
import type { Feed } from './types';

const DEG_PER_RAD = 180 / Math.PI;
const TEN_MINUTES_MS = 10 * 60 * 1000;

/** Solar altitude above the horizon at a place and moment, degrees. Negative below. */
export function sunAltitudeDeg(at: Date, lat: number, lng: number): number {
  return SunCalc.getPosition(at, lat, lng).altitude * DEG_PER_RAD;
}

/** Which feed a place belongs to right now: rising sun is sunrise, falling is sunset. */
export function feedAt(at: Date, lat: number, lng: number): Feed {
  const now = sunAltitudeDeg(at, lat, lng);
  const later = sunAltitudeDeg(new Date(at.getTime() + TEN_MINUTES_MS), lat, lng);
  return later > now ? 'sunrise' : 'sunset';
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
