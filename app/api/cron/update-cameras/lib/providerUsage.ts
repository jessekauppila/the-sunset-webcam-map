import { sql } from '@/app/lib/db';
import { NEON_USAGE_PROJECT_IDS } from '@/app/lib/masterConfig';

const NEON_API = 'https://console.neon.tech/api/v2';

function utcDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Snapshot Neon month-to-date usage counters once per UTC day. Called from the
// update-cameras cron; every failure path returns instead of throwing so the
// scoring tick can never be broken by the cost dashboard.
export async function captureProviderUsageDaily(
  now: Date,
): Promise<{ captured: number } | { skipped: string }> {
  const apiKey = process.env.NEON_COST_API;
  if (!apiKey) return { skipped: 'no-api-key' };

  const day = utcDateString(now);
  const existing = (await sql`
    SELECT COUNT(*)::int AS count FROM provider_usage_daily WHERE day = ${day}
  `) as unknown as { count: number }[];
  if ((existing[0]?.count ?? 0) > 0) return { skipped: 'already-captured' };

  let captured = 0;
  for (const projectId of NEON_USAGE_PROJECT_IDS) {
    try {
      const res = await fetch(`${NEON_API}/projects/${projectId}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!res.ok) {
        console.warn(`[providerUsage] ${projectId} -> ${res.status}`);
        continue;
      }
      const { project } = (await res.json()) as {
        project: {
          compute_time_seconds?: number;
          active_time_seconds?: number;
          data_transfer_bytes?: number;
          synthetic_storage_size?: number;
        };
      };
      await sql`
        INSERT INTO provider_usage_daily
          (day, project_id, compute_time_s, active_time_s, data_transfer_b, storage_b)
        VALUES (${day}, ${projectId},
          ${project.compute_time_seconds ?? 0}, ${project.active_time_seconds ?? 0},
          ${project.data_transfer_bytes ?? 0}, ${project.synthetic_storage_size ?? 0})
        ON CONFLICT (day, project_id) DO NOTHING
      `;
      captured++;
    } catch (error) {
      console.warn(`[providerUsage] ${projectId} failed:`, error);
    }
  }
  return { captured };
}
