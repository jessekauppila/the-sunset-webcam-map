import { sql } from '@/app/lib/db';
import {
  getCalibrationDigestSummary,
  type CalibrationDigestSummary,
} from './dbOperations';
import {
  getSweepDigestSummary,
  type SweepDigestSummary,
  type SweepRingStats,
} from './sweepStats';
import { coverageSpan } from './sweepGeometry';
import { deriveDailyDeltas } from '@/app/components/Ops/opsMath';
import type { ProviderUsageRow, CostEventRow } from '@/app/lib/opsTypes';
import {
  NEON_COST_PER_CU_HOUR,
  DIGEST_LOOKBACK_DAYS,
  TERMINATOR_SUN_ALTITUDE_DEG,
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

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);
const count = (n: number) => n.toLocaleString('en-US');

/** `base`, `+15.75°`, `-15.75°`. */
function ringLabel(offsetDeg: number): string {
  if (offsetDeg === 0) return 'base';
  return `${offsetDeg > 0 ? '+' : ''}${offsetDeg}°`;
}

/**
 * The solar-altitude span yesterday's rings actually gathered from.
 *
 * The digest already prints ring offsets, which say where a ring sits
 * relative to the base ring and nothing about where the sun was. The useful
 * form is the resulting altitude band, because that is what can be read
 * against the measured quality curve: good frames peak at 0 to +6 degrees,
 * and a span whose day edge is -2 never touches it.
 *
 * Shares its arithmetic with sweepGeometry's coverageSpan, which answers the
 * same question about a tick rather than about yesterday.
 */
export function sweptAltitudeSpan(
  rings: SweepRingStats[],
): { min: number; max: number } | null {
  if (rings.length === 0) return null;
  return coverageSpan(
    rings.map((r) => TERMINATOR_SUN_ALTITUDE_DEG + r.offsetDeg),
  );
}

/**
 * `-24° to +14°`. Rounded outward to whole degrees; the printed band may
 * overstate by under 1° and never understates.
 */
function formatSpan(span: { min: number; max: number }): string {
  const lo = Math.floor(span.min);
  const hi = Math.ceil(span.max);
  return `${lo}° to ${hi > 0 ? '+' : ''}${hi}°`;
}

/**
 * Two-line adaptive-widening summary for the digest.
 *
 * Answers the two questions the feature was built to make answerable day to
 * day: how often did a feed fall under the camera floor, and what did the
 * extra rings cost against the ~3,000 boxes/day baseline.
 *
 * The per-ring gate-pass rates are the second line, and they are the whole
 * point of splitting the telemetry by ring. The widening's self-concealing
 * failure mode is a day-side ring that adds cameras the detection gate then
 * floors: escalations and new cameras both read as success while the panel
 * stays exactly as empty. A day-side rate far under the base rate is what
 * that looks like, and it is the evidence for making the floor count only
 * gate-passers rather than for raising the floor.
 *
 * `null` (no sweep recorded, or the tables are not migrated yet) renders
 * nothing rather than an error line, like the calibration section.
 */
export function formatSweepLine(summary: SweepDigestSummary | null): string {
  if (!summary) return '';
  const s = summary;
  const totalBoxes = s.baseBoxes + s.escalationBoxes;
  const emptyBoxes = s.rings.reduce((sum, r) => sum + r.boxesEmpty, 0);

  const parts: string[] = [];
  const thin: Array<[string, number, number]> = [
    ['sunrise', s.sunriseThinTicks, s.sunriseShortTicks],
    ['sunset', s.sunsetThinTicks, s.sunsetShortTicks],
  ];
  const thinClauses = thin
    .filter(([, ticks]) => ticks > 0)
    .map(([feed, ticks, short]) => {
      const clause = `<b>${feed} thin on ${ticks} of ${s.ticks} ticks</b>`;
      // thin minus short is what widening recovered; short is what it did not.
      return short > 0 ? `${clause} (${short} still short)` : clause;
    });
  parts.push(
    thinClauses.length > 0
      ? thinClauses.join(', ')
      : `no feed fell under the floor in ${s.ticks} ticks`,
  );

  parts.push(
    s.escalationBoxes > 0
      ? `+${count(s.escalationBoxes)} boxes on ${count(s.baseBoxes)} base (+${pct(
          s.escalationBoxes,
          s.baseBoxes,
        )}%)`
      : `${count(totalBoxes)} boxes`,
  );

  const span = sweptAltitudeSpan(s.rings);
  if (span) {
    // The span alone over-claims on a partial-escalation day: one ring that
    // ran a single tick prints the same band as one that ran all day. The
    // parenthetical says how many of the base ring's ticks each other ring
    // actually shared, against the base ring's ringsSwept.
    const base = s.rings.find((r) => r.offsetDeg === 0);
    const shares = base
      ? s.rings
          .filter((r) => r.offsetDeg !== 0)
          .map(
            (r) => `${ringLabel(r.offsetDeg)} on ${r.ringsSwept}/${base.ringsSwept} ticks`,
          )
          .join(', ')
      : '';
    parts.push(
      shares
        ? `swept ${formatSpan(span)} solar altitude (${shares})`
        : `swept ${formatSpan(span)} solar altitude`,
    );
  }

  if (s.budgetExhaustedTicks > 0) {
    parts.push(`${s.budgetExhaustedTicks} ticks hit the sweep budget`);
  }
  // A held tick is a tick Windy could not be trusted: the pool was kept, not
  // rebuilt. One or two on a day is a Windy blip. A run of them is an outage
  // the glass rode out, and the reason is in the tick log's `sweep hold` line.
  if (s.heldTicks > 0) {
    parts.push(`<b>${s.heldTicks} ticks held the last good pool</b>`);
  }
  // Empty and failed are different facts and the digest keeps them apart.
  // Empty is ocean. Failed is a non-OK response, and a RISING failed count
  // is the only thing in this line that can mean a Windy ceiling; the empty
  // share never could, because it used to contain the failures.
  const failedBoxes = s.rings.reduce((sum, r) => sum + r.boxesFailed, 0);
  parts.push(`${pct(emptyBoxes, totalBoxes)}% of boxes empty`);
  if (failedBoxes > 0) {
    parts.push(`<b>${count(failedBoxes)} boxes failed</b>`);
  }

  const lines = [`Widening: ${parts.join(' · ')}`];

  // The bill, in the units that actually have one.
  //
  // Not dollars, deliberately. Windy publishes no price, no rate limit and no
  // quota headers (measured 2026-09-02, see the camera-refresh cost spec), so
  // multiplying boxes by a rate would mean inventing the rate. What widening
  // provably consumes is function wall-clock and scoring work, and both are
  // measured here.
  // Rows written before the timing migration have elapsed_ms = 0 alongside a
  // non-zero escalationBoxes, so this gate silently omits the Widening cost
  // line for those days. Acceptable: it only means pre-migration days don't
  // get the section, not that they print a wrong number.
  if (s.escalationMs > 0) {
    const escalationMin = s.escalationMs / 60_000;
    const escalationFrames = s.rings
      .filter((r) => r.offsetDeg !== 0)
      .reduce((sum, r) => sum + r.framesScored, 0);
    lines.push(
      `Widening cost: ${escalationMin.toFixed(1)} min/day sweeping ` +
        `(+${pct(s.escalationMs, s.baseMs)}% on base) · ` +
        `${count(escalationFrames)} extra frames scored`,
    );
  }

  // Cost per result, per ring. The lever line.
  //
  // Totals cannot say which ring to narrow or drop; a ratio can. A ring
  // buying gate-passed frames at several times the base ring's box cost is
  // the one to change, and that stays true whether the bill went up or down.
  // Rings with no gate-passed frames print as "none", not as a division by
  // zero dressed up as a large number.
  const efficiency = s.rings.map((r) => {
    if (r.framesGatePassed === 0) return `${ringLabel(r.offsetDeg)} none`;
    const boxesEach = Math.round(r.boxesAttempted / r.framesGatePassed);
    const secondsEach = r.elapsedMs / r.framesGatePassed / 1000;
    return (
      `${ringLabel(r.offsetDeg)} ${count(boxesEach)} boxes` +
      ` + ${secondsEach.toFixed(1)}s`
    );
  });
  lines.push(`Per gate-passed frame: ${efficiency.join(' · ')}`);

  if (s.rings.length > 1) {
    const ringClauses = s.rings.map((r) => {
      const rate =
        r.framesScored > 0
          ? `${r.framesGatePassed}/${r.framesScored}${
              r.offsetDeg === 0 ? ' gate-passed' : ''
            } (${pct(r.framesGatePassed, r.framesScored)}%)`
          : `${count(r.newWebcams)} new, unscored`;
      return `${ringLabel(r.offsetDeg)} ${rate}`;
    });
    lines.push(`Rings: ${ringClauses.join(' · ')}`);
  }

  return `<p style="font:12px sans-serif">${lines.join('<br/>')}</p>`;
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
    // Same isolation contract: swallows its own failures and returns null, so
    // an unmigrated sweep table degrades this section to silence.
    const sweep = await getSweepDigestSummary();

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
        ${formatSweepLine(sweep)}
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
