import { sql } from '@/app/lib/db';

/**
 * The cameras whose whole evening is kept, or an empty set when capture is off.
 *
 * Read once per tick, not per frame. The BIGINT id comes back from the Neon
 * driver as a string on some paths, so it is coerced here rather than at every
 * call site.
 *
 * Fails CLOSED, same contract as runtimeFlags.isFlagEnabled: an unreachable
 * database gives today's behaviour (no panel capture), never a thrown error.
 * This call sits above the per-webcam scoring loop with no surrounding
 * try/catch in the caller, so an unguarded throw here would abort the whole
 * tick -- no scoring, no snapshots, no bin admission -- every 10 minutes
 * until the fault clears.
 */
export async function loadRunPanel(): Promise<Set<number>> {
  try {
    const flag = (await sql`
      SELECT enabled FROM runtime_flags WHERE key = 'run_panel_capture'
    `) as { enabled: boolean }[];

    if (flag[0]?.enabled !== true) return new Set();

    const rows = (await sql`
      SELECT webcam_id FROM run_panel
    `) as { webcam_id: number | string }[];

    return new Set(rows.map((r) => Number(r.webcam_id)));
  } catch (error) {
    console.warn('[runPanel] read failed, treating as no panel this tick:', error);
    return new Set();
  }
}
