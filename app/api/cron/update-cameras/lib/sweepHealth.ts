import type { SweepTelemetry } from './terminatorSweep';

export type SweepHoldReason =
  | 'none'
  | 'no-boxes'
  | 'nothing-found'
  | 'failed-ratio';

export interface SweepHold {
  held: boolean;
  reason: SweepHoldReason;
  attempted: number;
  failed: number;
  found: number;
}

/**
 * Should this tick be allowed to deactivate cameras?
 *
 * A tick that could not see the world must not rewrite the pool from what it
 * saw. Three shapes of "could not see": no boxes were sent (a ring built no
 * coordinates); boxes went out and not one camera came back (the empty-200
 * shape a quota could take, and the base ring has never been all ocean); or
 * at least `failedHoldRatio` of the boxes came back non-OK. Ordinary days
 * fail a few percent of boxes on the antimeridian and poles, well under the
 * ratio.
 *
 * Pure: reads telemetry the sweep already produces. The caller decides what a
 * hold means (skip deactivation, keep the last good pool).
 */
export function assessSweepHold(
  telemetry: SweepTelemetry,
  found: number,
  failedHoldRatio: number,
): SweepHold {
  let attempted = 0;
  let failed = 0;
  for (const ring of telemetry.rings) {
    attempted += ring.attempted;
    failed += ring.failed;
  }
  const base = { attempted, failed, found };
  if (attempted === 0) return { held: true, reason: 'no-boxes', ...base };
  if (found === 0) return { held: true, reason: 'nothing-found', ...base };
  if (failed / attempted >= failedHoldRatio) {
    return { held: true, reason: 'failed-ratio', ...base };
  }
  return { held: false, reason: 'none', ...base };
}
