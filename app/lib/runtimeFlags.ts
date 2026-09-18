import 'server-only';
import { sql } from '@/app/lib/db';

/**
 * Reading the booleans the cron consults at tick time.
 *
 * The point is reversibility without a redeploy: env vars in this project
 * bake in when the deploy is built, so an env-var kill-switch cannot bring
 * spending down until someone redeploys. A row can be flipped in seconds --
 * see scripts/set-runtime-flag.mjs -- and the next tick honours it.
 *
 * The keys themselves are in `app/lib/runtimeFlagKeys.ts`, which imports
 * nothing. Naming a flag is not a database operation, and a module that only
 * names one should not inherit `server-only` and a connection string from this
 * file (issue #245).
 */

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
