import type { SolarPhase } from './solarPhase';

const MS_PER_HOUR = 3_600_000;

/**
 * The identity of one camera's one evening.
 *
 * Keyed on LOCAL SOLAR date, not a fixed UTC offset. Longitude gives local
 * solar time directly at 15 degrees per hour, and both solar events sit far
 * from local midnight, so a sunset never straddles a local-solar-day boundary.
 * A fixed offset does not have that property: at lng -122 an evening lands on
 * both sides of UTC midnight and would split into two runs, which is exactly
 * the bug that would cut a run in half at its most interesting end.
 *
 * KNOWN DUPLICATION: scripts/run-inventory.mjs mirrors this in SQL, because a
 * .mjs script cannot import a .ts module. This function is the definition of
 * record. Phase 2 collapses the two when the queue needs run identity in
 * TypeScript; until then, a change here must be made in that query too.
 */
export function runKey(
  webcamId: number,
  phase: SolarPhase,
  capturedAt: Date,
  lngDeg: number,
): string {
  const solarLocal = new Date(
    capturedAt.getTime() + (lngDeg / 15) * MS_PER_HOUR,
  );
  const date = solarLocal.toISOString().slice(0, 10);
  return `${webcamId}:${phase}:${date}`;
}
