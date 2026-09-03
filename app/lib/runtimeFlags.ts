import 'server-only';
import { sql } from '@/app/lib/db';

/**
 * Booleans the cron reads at tick time.
 *
 * The point is reversibility without a redeploy: env vars in this project
 * bake in when the deploy is built, so an env-var kill-switch cannot bring
 * spending down until someone redeploys. A row can be flipped in seconds --
 * see scripts/set-runtime-flag.mjs -- and the next tick honours it.
 */

/**
 * Sweep the day-side escalation ring every tick, both feeds, regardless of
 * TERMINATOR_CAMERA_FLOOR. Roughly doubles Windy boxes per tick. Off by
 * default; phase 1 of the pool-coverage spec turns it on for a bounded
 * measurement window.
 */
export const SWEEP_FORCE_DAY_RING = 'sweep_force_day_ring';

/**
 * Read one flag. Fails CLOSED: any error, missing row, or non-boolean value
 * reads as off.
 *
 * Failing closed is the whole safety property. This flag gates spending, and
 * an unreachable database must not be able to turn spending on. It also means
 * a deploy that lands before the migration is applied behaves exactly like
 * today rather than throwing inside the cron.
 */
export async function isFlagEnabled(key: string): Promise<boolean> {
  try {
    const rows = (await sql`
      SELECT enabled FROM runtime_flags WHERE key = ${key}
    `) as unknown as { enabled: boolean }[];
    return rows[0]?.enabled === true;
  } catch (error) {
    console.warn('[runtimeFlags] read failed, treating as off:', key, error);
    return false;
  }
}
