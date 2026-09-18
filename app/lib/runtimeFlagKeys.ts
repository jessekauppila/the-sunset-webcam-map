/**
 * The keys of the booleans the cron reads at tick time — strings, and nothing
 * else (issue #245).
 *
 * They live apart from `runtimeFlags.ts` because that module is `server-only`
 * plus the Neon client, and a source adapter that names the flag governing it
 * was inheriting both. `scripts/cap-cost-sweep.ts` could not call a pure
 * GeoJSON parser for that reason. Declaring which flag governs a source is not
 * a database operation; reading the flag is, and that stays in
 * `runtimeFlags.ts`.
 *
 * Keep this module free of imports.
 */

/**
 * Sweep the day-side escalation ring every tick, both feeds, regardless of
 * TERMINATOR_CAMERA_FLOOR. Roughly doubles Windy boxes per tick. Off by
 * default; phase 1 of the pool-coverage spec turns it on for a bounded
 * measurement window.
 */
export const SWEEP_FORCE_DAY_RING = 'sweep_force_day_ring';

/**
 * Persist a Windy frame because the two model heads disagree (the Hard
 * Examples mining arm). Off by default: 32,013 frames were already banked
 * with zero labeled, and hard examples are model-relative, so flip this on
 * only in the week before a labeling sitting. model_disagreement_kind is
 * still computed and written on every persisted row regardless of this flag
 * -- the Hard Examples queue filters on that column, not on intake_reason.
 */
export const DISAGREEMENT_INTAKE = 'disagreement_intake';

/**
 * A non-Windy image source (issue #204), one flag per source so a source can be
 * turned on for a day and off in one command. Seeded OFF. The registry in
 * app/api/cron/update-cameras/lib/sources/registry.ts reads these.
 */
export const SOURCE_FAA = 'source_faa';

/** Finland Digitraffic road weather cameras (issue #221). Seeded OFF. */
export const SOURCE_DIGITRAFFIC = 'source_digitraffic';
