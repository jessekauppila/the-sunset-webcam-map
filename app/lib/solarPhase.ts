import SunCalc from 'suncalc';

/**
 * Sunrise or sunset, decided by where the sun actually was — not by what a
 * judge said about the picture and not by which sweep bucket a camera sat in
 * when the frame was captured.
 *
 * A place and a moment are enough. The sun is either climbing or falling, and
 * that is the whole distinction, so this is ground truth wherever we have a
 * latitude, a longitude and a capture time. Measured against the 21,061
 * leaderboard-eligible frames on 2026-09-08, the two labels we had been using
 * instead disagree with it often: the stored `webcam_snapshots.phase` on
 * 3,658 frames (17%), and Claude's `llm_is_sunrise` flag on 6,493 (31%).
 *
 * ⚠️ `webcam_snapshots.captured_at` is `timestamp WITHOUT time zone` holding
 * UTC digits, and the Neon driver hands it back as a Date shifted by the
 * server's local offset. Read it as `captured_at AT TIME ZONE 'UTC'` (or
 * `::text` plus a `Z`) before passing it here, or every altitude is hours off.
 */
export type SolarPhase = 'sunrise' | 'sunset';

const DEG_PER_RAD = 180 / Math.PI;
const TEN_MINUTES_MS = 10 * 60 * 1000;

/** Solar altitude above the horizon at a place and moment, degrees. Negative below. */
export function sunAltitudeDeg(at: Date, lat: number, lng: number): number {
  return SunCalc.getPosition(at, lat, lng).altitude * DEG_PER_RAD;
}

/**
 * Which half of the day a moment belongs to: a climbing sun is a sunrise, a
 * falling sun is a sunset. Compared over ten minutes rather than read off the
 * azimuth, which keeps it correct at every latitude including inside the
 * polar circles, where the sun can circle the sky without setting.
 */
export function solarPhaseAt(at: Date, lat: number, lng: number): SolarPhase {
  const now = sunAltitudeDeg(at, lat, lng);
  const later = sunAltitudeDeg(new Date(at.getTime() + TEN_MINUTES_MS), lat, lng);
  return later > now ? 'sunrise' : 'sunset';
}

/**
 * The same call for a row that may be missing a coordinate or a time. Null,
 * never a guess: a surface that cannot say which it is should say neither
 * rather than pick one.
 */
export function solarPhaseOf(
  at: Date | string | number | null | undefined,
  lat: number | null | undefined,
  lng: number | null | undefined,
): SolarPhase | null {
  if (lat == null || lng == null || at == null) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const moment = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(moment.getTime())) return null;
  return solarPhaseAt(moment, lat, lng);
}
