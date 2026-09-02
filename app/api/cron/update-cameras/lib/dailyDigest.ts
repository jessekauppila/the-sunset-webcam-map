import { sql } from '@/app/lib/db';
import {
  getCalibrationDigestSummary,
  type CalibrationDigestSummary,
} from './dbOperations';
import { deriveDailyDeltas } from '@/app/components/Ops/opsMath';
import type { ProviderUsageRow, CostEventRow } from '@/app/lib/opsTypes';
import {
  NEON_COST_PER_CU_HOUR,
  DIGEST_LOOKBACK_DAYS,
} from '@/app/lib/masterConfig';

const SUNSET_PROJECT = 'noisy-leaf-96391119';
const NWAC_PROJECT = 'rough-resonance-57753560';

const LABELS: Record<string, string> = {
  [SUNSET_PROJECT]: 'sunrise-sunset (this site)',
  [NWAC_PROJECT]: 'nwac-observations',
};

/**
 * One-line per-camera calibration summary for the digest.
 *
 * Ambient awareness, not an audit surface: the Ops tab answers "why is this
 * camera at 0.59"; this answers "did anything change while I wasn't looking".
 * Steady state is one clause; the events worth knowing are cameras newly
 * tempered and cameras that healed.
 *
 * `null` (calibration unavailable) renders nothing rather than an error line.
 */
export function formatCalibrationLine(
  summary: CalibrationDigestSummary | null,
): string {
  if (!summary) return '';
  const { tempered, newlyTempered, healed } = summary;

  const parts: string[] = [`<b>${tempered} cameras tempered</b>`];
  if (newlyTempered.length > 0) {
    const named = newlyTempered
      .map((c) => `${c.title ?? `#${c.webcamId}`} ${c.multiplier.toFixed(2)}`)
      .join(', ');
    parts.push(`${newlyTempered.length} newly tempered (${named})`);
  }
  if (healed > 0) parts.push(`${healed} healed`);
  if (newlyTempered.length === 0 && healed === 0) parts.push('no changes');

  return `<p style="font:12px sans-serif">Calibration: ${parts.join(' · ')}</p>`;
}

// Daily usage digest email, sent right after the once-per-UTC-day provider
// snapshot lands (the caller gates on that, which gives once-a-day semantics
// for free). Reads the same table the Ops chart reads, so the email can never
// disagree with the dashboard. Non-fatal by contract: every failure path
// returns instead of throwing.
export async function sendDailyUsageDigest(
  now: Date,
): Promise<{ sent: true } | { skipped: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { skipped: 'no-resend-key' };
  const to = process.env.DIGEST_EMAIL_TO;
  if (!to) return { skipped: 'no-recipient' };

  try {
    const usage = (await sql`
      SELECT day::text AS day, project_id, compute_time_s::bigint AS compute_time_s
      FROM provider_usage_daily
      WHERE day > CURRENT_DATE - ${DIGEST_LOOKBACK_DAYS}::int
      ORDER BY day ASC, project_id ASC
    `) as unknown as ProviderUsageRow[];
    const events = (await sql`
      SELECT occurred_on::text AS occurred_on, sha, description
      FROM cost_events
      WHERE occurred_on > CURRENT_DATE - ${DIGEST_LOOKBACK_DAYS}::int
      ORDER BY occurred_on ASC
    `) as unknown as CostEventRow[];

    // Isolated on purpose: getCalibrationDigestSummary swallows its own
    // failures and returns null, so a missing calibration table degrades this
    // section to silence instead of killing the cost email.
    const calibration = await getCalibrationDigestSummary();

    const rows = usage.map((r) => ({ ...r, compute_time_s: Number(r.compute_time_s) }));
    const deltas = deriveDailyDeltas(rows);
    const days = [...new Set(deltas.map((d) => d.day))].sort();
    const latestDay = days.at(-1);
    const hoursFor = (day: string, projectId: string | null) =>
      deltas
        .filter(
          (d) =>
            d.day === day &&
            (projectId === null
              ? d.project_id !== SUNSET_PROJECT && d.project_id !== NWAC_PROJECT
              : d.project_id === projectId),
        )
        .reduce((sum, d) => sum + d.computeHours, 0);

    // Month-to-date: the latest snapshot per project IS the MTD counter.
    const mtdHours = Object.values(
      rows.reduce<Record<string, ProviderUsageRow>>((acc, r) => {
        if (!acc[r.project_id] || acc[r.project_id].day < r.day) acc[r.project_id] = r;
        return acc;
      }, {}),
    ).reduce((sum, r) => sum + Number(r.compute_time_s) / 3600, 0);
    const mtdDollars = mtdHours * NEON_COST_PER_CU_HOUR;
    const dayOfMonth = now.getUTCDate();
    const paceDollars = dayOfMonth > 0 ? (mtdDollars / dayOfMonth) * 30 : mtdDollars;

    const ySunset = latestDay ? hoursFor(latestDay, SUNSET_PROJECT) : 0;
    const yNwac = latestDay ? hoursFor(latestDay, NWAC_PROJECT) : 0;

    const maxHours = Math.max(...days.map((d) => hoursFor(d, SUNSET_PROJECT)), 1);
    const bar = (hours: number, color: string) =>
      `<td style="padding:1px 0"><div style="height:10px;width:${Math.max(
        2,
        Math.round((hours / maxHours) * 220),
      )}px;background:${color}"></div></td><td style="padding:0 6px;font:11px monospace">${hours.toFixed(1)}h</td>`;
    const eventByDay = new Map(events.map((e) => [e.occurred_on, e.description]));
    const chartRows = days
      .map(
        (d) => `<tr>
          <td style="font:11px monospace;padding-right:8px">${d.slice(5)}${eventByDay.has(d) ? ' ⚑' : ''}</td>
          ${bar(hoursFor(d, SUNSET_PROJECT), '#3b82f6')}
          ${bar(hoursFor(d, NWAC_PROJECT), '#9ca3af')}
        </tr>`,
      )
      .join('');
    const eventList = events.length
      ? `<h3 style="font:bold 13px sans-serif">Cost changes (⚑)</h3><ul style="font:12px sans-serif">${events
          .map((e) => `<li><b>${e.occurred_on}</b> — ${e.description}</li>`)
          .join('')}</ul>`
      : '';

    const html = `
      <div style="font:14px sans-serif;max-width:560px">
        <h2 style="font:bold 16px sans-serif">Sunset infra — daily usage</h2>
        <p>
          Yesterday: <b>sunrise-sunset (this site) ${ySunset.toFixed(1)} CU-hr</b>,
          nwac-observations ${yNwac.toFixed(1)} CU-hr.<br/>
          Month to date: <b>${mtdHours.toFixed(1)} CU-hr ≈ $${mtdDollars.toFixed(2)}</b>
          (pace ≈ $${paceDollars.toFixed(0)}/mo compute, + Vercel plan fee).
        </p>
        ${
          days.length
            ? `<table cellspacing="0" cellpadding="0"><tr>
                 <td></td><td colspan="2" style="font:11px sans-serif;color:#3b82f6">sunrise-sunset</td>
                 <td colspan="2" style="font:11px sans-serif;color:#6b7280">nwac-observations</td>
               </tr>${chartRows}</table>`
            : '<p style="font:12px sans-serif">Daily chart appears after two snapshots.</p>'
        }
        ${eventList}
        ${formatCalibrationLine(calibration)}
        <p style="font:11px sans-serif;color:#6b7280">
          Same data as the Ops tab. Estimate uses $${NEON_COST_PER_CU_HOUR}/CU-hr;
          the invoice of record is Vercel → Settings → Billing.
        </p>
      </div>`;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.DIGEST_EMAIL_FROM ?? 'onboarding@resend.dev',
        to: [to],
        subject: `Sunset infra: ${ySunset.toFixed(1)} CU-hr yesterday · $${mtdDollars.toFixed(2)} MTD`,
        html,
      }),
    });
    if (!res.ok) {
      console.warn('[dailyDigest] resend responded', res.status);
      return { skipped: 'send-failed' };
    }
    return { sent: true };
  } catch (error) {
    console.warn('[dailyDigest] failed:', error);
    return { skipped: 'send-failed' };
  }
}
