import { sql } from '@/app/lib/db';
import {
  TERMINATOR_SUN_ALTITUDE_DEG,
  SEARCH_RADIUS_DEG,
  TERMINATOR_WIDEN_OFFSETS_DEG,
} from '@/app/lib/masterConfig';

/**
 * The ring angles a tick actually ran with.
 *
 * Stored beside the counters because offset_deg alone is not a fact about the
 * sky. +15.75 means +2.75 degrees of solar altitude only while the base ring
 * is at -13, and this configuration is expected to move. Without this record,
 * comparing a day of counters against a day from before a change silently
 * compares two different experiments.
 */
export interface SweepGeometry {
  signature: string;
  baseAltitudeDeg: number;
  searchRadiusDeg: number;
  widenOffsetsDeg: string;
  forcedOffsetsDeg: string;
  /**
   * The span the sweep was GUARANTEED to gather from: the base ring plus
   * whatever was forced on this tick.
   *
   * Distinct from TERMINATOR_POOL_COVERAGE_DEG, which is the display's
   * compile-time contract and only moves when a ring becomes unconditional.
   * This one is the measurement record: during a bounded measurement window
   * the runtime flag widens what the sweep really gathers while the display
   * contract deliberately stays put, and this column is the only place that
   * difference is written down.
   */
  coverageMinDeg: number;
  coverageMaxDeg: number;
}

const fmt = (offsets: readonly number[]) => [...offsets].join(',');

/**
 * The solar-altitude span a set of ring altitudes gathers from.
 *
 * Shared so the two questions that need it cannot drift apart: this module
 * asks "what was the pool guaranteed to hold on this tick", and the digest
 * asks "what did yesterday's rings actually cover". Same arithmetic, two
 * inputs. (masterConfig's TERMINATOR_POOL_COVERAGE_DEG is a third thing —
 * the display contract, moved by hand — and cannot call this, because masterConfig is
 * imported by client code and this module imports the database.)
 *
 * A true union rather than a hull: the widest gap between consecutive ring
 * altitudes (15.75) is under one band's width (2 x SEARCH_RADIUS_DEG = 22),
 * so there is no hole for min/max to paper over.
 */
export function coverageSpan(
  ringAltitudesDeg: number[],
): { min: number; max: number } {
  return {
    min: Math.min(...ringAltitudesDeg) - SEARCH_RADIUS_DEG,
    max: Math.max(...ringAltitudesDeg) + SEARCH_RADIUS_DEG,
  };
}

export function sweepGeometry(forcedOffsets: readonly number[]): SweepGeometry {
  const guaranteed = [0, ...forcedOffsets];
  const { min: coverageMinDeg, max: coverageMaxDeg } = coverageSpan(
    guaranteed.map((o) => TERMINATOR_SUN_ALTITUDE_DEG + o),
  );
  const widenOffsetsDeg = fmt(TERMINATOR_WIDEN_OFFSETS_DEG);
  const forcedOffsetsDeg = fmt(forcedOffsets);
  return {
    signature:
      `base${TERMINATOR_SUN_ALTITUDE_DEG}` +
      `_r${SEARCH_RADIUS_DEG}` +
      `_off${widenOffsetsDeg}` +
      `_forced${forcedOffsetsDeg}`,
    baseAltitudeDeg: TERMINATOR_SUN_ALTITUDE_DEG,
    searchRadiusDeg: SEARCH_RADIUS_DEG,
    widenOffsetsDeg,
    forcedOffsetsDeg,
    coverageMinDeg,
    coverageMaxDeg,
  };
}

/**
 * Add one tick to today's row for this geometry.
 *
 * `ticks` accumulates, everything else is fixed by the signature, so a
 * configuration change mid-day makes a second row rather than corrupting the
 * first. Non-fatal by contract, like every other telemetry write in this
 * directory: a missing table means a quiet warning, never a failed tick.
 */
export async function upsertSweepGeometry(
  now: Date,
  geometry: SweepGeometry,
): Promise<void> {
  const date = now.toISOString().slice(0, 10);
  try {
    await sql`
      insert into daily_sweep_geometry (
        date, signature, base_altitude_deg, search_radius_deg,
        widen_offsets_deg, forced_offsets_deg,
        coverage_min_deg, coverage_max_deg, ticks, updated_at
      ) values (
        ${date}, ${geometry.signature}, ${geometry.baseAltitudeDeg},
        ${geometry.searchRadiusDeg}, ${geometry.widenOffsetsDeg},
        ${geometry.forcedOffsetsDeg}, ${geometry.coverageMinDeg},
        ${geometry.coverageMaxDeg}, 1, now()
      )
      on conflict (date, signature) do update set
        ticks = daily_sweep_geometry.ticks + 1,
        updated_at = now()
    `;
  } catch (error) {
    console.warn('[sweepGeometry] persist failed:', error);
  }
}
