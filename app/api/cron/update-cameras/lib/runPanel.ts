import { sql } from '@/app/lib/db';

/**
 * The cameras whose whole evening is kept, or an empty set when capture is off.
 *
 * Read once per tick, not per frame. The BIGINT id comes back from the Neon
 * driver as a string on some paths, so it is coerced here rather than at every
 * call site.
 */
export async function loadRunPanel(): Promise<Set<number>> {
  const flag = (await sql`
    SELECT enabled FROM runtime_flags WHERE key = 'run_panel_capture'
  `) as { enabled: boolean }[];

  if (flag[0]?.enabled !== true) return new Set();

  const rows = (await sql`
    SELECT webcam_id FROM run_panel
  `) as { webcam_id: number | string }[];

  return new Set(rows.map((r) => Number(r.webcam_id)));
}
