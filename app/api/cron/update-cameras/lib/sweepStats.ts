import { sql } from '@/app/lib/db';
import type { Feed, SweepTelemetry } from './terminatorSweep';

/** Scoring outcomes for the cameras one ring was first to find, this tick. */
export interface RingGateCounts {
  /** Frames that reached the ONNX head. Cache hits are excluded: no verdict. */
  scored: number;
  /** Of those, frames the binary head called a sunset. */
  gatePassed: number;
}

export interface SweepRingStats {
  offsetDeg: number;
  ringsSwept: number;
  boxesAttempted: number;
  boxesEmpty: number;
  boxesFailed: number;
  newWebcams: number;
  framesScored: number;
  framesGatePassed: number;
  elapsedMs: number;
}

/**
 * One tick's contribution to the day. Every tick-level field is 0 or 1 so the
 * accumulated column reads directly as "N of today's ticks".
 */
export interface SweepTickStats {
  ticks: number;
  escalatedTicks: number;
  budgetExhaustedTicks: number;
  /** The feed was under the floor after the base ring. */
  sunriseThinTicks: number;
  sunsetThinTicks: number;
  /** The feed was STILL under the floor after every ring the tick swept. */
  sunriseShortTicks: number;
  sunsetShortTicks: number;
  /** Windy boxes attributable to the base ring — the ~3,000/day baseline. */
  baseBoxes: number;
  /** Windy boxes attributable to widening — the bill this feature adds. */
  escalationBoxes: number;
  /** Wall clock the base ring spent, summed over the tick. */
  baseMs: number;
  /** Wall clock widening added. Boxes are free at Windy; seconds are not. */
  escalationMs: number;
  rings: SweepRingStats[];
}

/**
 * Which ring first saw each camera, this tick.
 *
 * `newWebcamIds` is already a per-ring first-sighting list, so the map is a
 * flatten. It exists so the scoring loop can attribute a gate verdict to the
 * ring that paid for the camera, which is the only way to answer the spec's
 * golden-hour risk: do day-side frames pass the detection gate, or does
 * widening buy tiles the panel will floor?
 */
export function ringOffsetByWebcamId(
  telemetry: SweepTelemetry,
): Map<number, number> {
  const byId = new Map<number, number>();
  for (const ring of telemetry.rings) {
    for (const id of ring.newWebcamIds) {
      if (!byId.has(id)) byId.set(id, ring.offsetDeg);
    }
  }
  return byId;
}

export function computeSweepTickStats(input: {
  telemetry: SweepTelemetry;
  floor: number;
  gateByOffset?: Map<number, RingGateCounts>;
}): SweepTickStats {
  const { telemetry, floor, gateByOffset } = input;
  const thin = new Set<Feed>(telemetry.thinAfterBase);
  const short = (feed: Feed) => (telemetry.counts[feed] < floor ? 1 : 0);

  // Ring 0 is always the base sweep; everything after it is widening. Keyed
  // on position rather than on offsetDeg === 0 so a future base ring with a
  // non-zero offset does not silently move its cost into the widening column.
  const [base, ...escalation] = telemetry.rings;

  const byOffset = new Map<number, SweepRingStats>();
  for (const ring of telemetry.rings) {
    const acc = byOffset.get(ring.offsetDeg) ?? {
      offsetDeg: ring.offsetDeg,
      ringsSwept: 0,
      boxesAttempted: 0,
      boxesEmpty: 0,
      boxesFailed: 0,
      newWebcams: 0,
      framesScored: 0,
      framesGatePassed: 0,
      elapsedMs: 0,
    };
    acc.ringsSwept += 1;
    acc.boxesAttempted += ring.attempted;
    acc.boxesEmpty += ring.empty;
    acc.boxesFailed += ring.failed;
    acc.newWebcams += ring.newWebcams;
    acc.elapsedMs += ring.elapsedMs;
    byOffset.set(ring.offsetDeg, acc);
  }
  for (const [offsetDeg, gate] of gateByOffset ?? []) {
    const acc = byOffset.get(offsetDeg);
    if (!acc) continue;
    acc.framesScored += gate.scored;
    acc.framesGatePassed += gate.gatePassed;
  }

  return {
    ticks: 1,
    escalatedTicks: escalation.length > 0 ? 1 : 0,
    budgetExhaustedTicks: telemetry.budgetExhausted ? 1 : 0,
    sunriseThinTicks: thin.has('sunrise') ? 1 : 0,
    sunsetThinTicks: thin.has('sunset') ? 1 : 0,
    sunriseShortTicks: short('sunrise'),
    sunsetShortTicks: short('sunset'),
    baseBoxes: base?.attempted ?? 0,
    escalationBoxes: escalation.reduce((sum, r) => sum + r.attempted, 0),
    baseMs: base?.elapsedMs ?? 0,
    escalationMs: escalation.reduce((sum, r) => sum + r.elapsedMs, 0),
    rings: [...byOffset.values()],
  };
}

function utcDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Accumulate one tick into today's rows.
 *
 * Every counter ADDS, so an intra-day rerun is additive and the columns keep
 * their "N of today's ticks" reading. Non-fatal by contract: telemetry is
 * never worth failing a cron tick over, and the tables may not exist yet on a
 * deploy that lands before the migration is applied.
 *
 * `modelVersion` is passed because daily_sunset_stats.model_version is NOT
 * NULL and either writer may be the one that creates the day's row. Both
 * writers are handed the same value in the same tick.
 */
export async function upsertSweepStats(
  now: Date,
  stats: SweepTickStats,
  modelVersion: string,
): Promise<void> {
  const date = utcDateString(now);
  try {
    await sql`
      insert into daily_sunset_stats (
        date, model_version,
        sweep_ticks, sweep_escalated_ticks, sweep_budget_exhausted_ticks,
        sweep_sunrise_thin_ticks, sweep_sunset_thin_ticks,
        sweep_sunrise_short_ticks, sweep_sunset_short_ticks,
        sweep_base_boxes, sweep_escalation_boxes,
        sweep_base_ms, sweep_escalation_ms,
        updated_at
      ) values (
        ${date}, ${modelVersion},
        ${stats.ticks}, ${stats.escalatedTicks}, ${stats.budgetExhaustedTicks},
        ${stats.sunriseThinTicks}, ${stats.sunsetThinTicks},
        ${stats.sunriseShortTicks}, ${stats.sunsetShortTicks},
        ${stats.baseBoxes}, ${stats.escalationBoxes},
        ${stats.baseMs}, ${stats.escalationMs},
        now()
      )
      on conflict (date) do update set
        sweep_ticks = daily_sunset_stats.sweep_ticks + excluded.sweep_ticks,
        sweep_escalated_ticks =
          daily_sunset_stats.sweep_escalated_ticks + excluded.sweep_escalated_ticks,
        sweep_budget_exhausted_ticks =
          daily_sunset_stats.sweep_budget_exhausted_ticks
          + excluded.sweep_budget_exhausted_ticks,
        sweep_sunrise_thin_ticks =
          daily_sunset_stats.sweep_sunrise_thin_ticks + excluded.sweep_sunrise_thin_ticks,
        sweep_sunset_thin_ticks =
          daily_sunset_stats.sweep_sunset_thin_ticks + excluded.sweep_sunset_thin_ticks,
        sweep_sunrise_short_ticks =
          daily_sunset_stats.sweep_sunrise_short_ticks + excluded.sweep_sunrise_short_ticks,
        sweep_sunset_short_ticks =
          daily_sunset_stats.sweep_sunset_short_ticks + excluded.sweep_sunset_short_ticks,
        sweep_base_boxes = daily_sunset_stats.sweep_base_boxes + excluded.sweep_base_boxes,
        sweep_escalation_boxes =
          daily_sunset_stats.sweep_escalation_boxes + excluded.sweep_escalation_boxes,
        sweep_base_ms = daily_sunset_stats.sweep_base_ms + excluded.sweep_base_ms,
        sweep_escalation_ms =
          daily_sunset_stats.sweep_escalation_ms + excluded.sweep_escalation_ms,
        updated_at = now()
    `;

    for (const ring of stats.rings) {
      await sql`
        insert into daily_sweep_ring_stats (
          date, offset_deg,
          rings_swept, boxes_attempted, boxes_empty, boxes_failed,
          new_webcams, frames_scored, frames_gate_passed, elapsed_ms,
          updated_at
        ) values (
          ${date}, ${ring.offsetDeg},
          ${ring.ringsSwept}, ${ring.boxesAttempted}, ${ring.boxesEmpty}, ${ring.boxesFailed},
          ${ring.newWebcams}, ${ring.framesScored}, ${ring.framesGatePassed}, ${ring.elapsedMs},
          now()
        )
        on conflict (date, offset_deg) do update set
          rings_swept = daily_sweep_ring_stats.rings_swept + excluded.rings_swept,
          boxes_attempted =
            daily_sweep_ring_stats.boxes_attempted + excluded.boxes_attempted,
          boxes_empty = daily_sweep_ring_stats.boxes_empty + excluded.boxes_empty,
          boxes_failed = daily_sweep_ring_stats.boxes_failed + excluded.boxes_failed,
          new_webcams = daily_sweep_ring_stats.new_webcams + excluded.new_webcams,
          frames_scored =
            daily_sweep_ring_stats.frames_scored + excluded.frames_scored,
          frames_gate_passed =
            daily_sweep_ring_stats.frames_gate_passed + excluded.frames_gate_passed,
          elapsed_ms = daily_sweep_ring_stats.elapsed_ms + excluded.elapsed_ms,
          updated_at = now()
      `;
    }
  } catch (error) {
    console.warn('[sweepStats] persist failed:', error);
  }
}

export interface SweepDigestSummary {
  ticks: number;
  escalatedTicks: number;
  budgetExhaustedTicks: number;
  sunriseThinTicks: number;
  sunsetThinTicks: number;
  sunriseShortTicks: number;
  sunsetShortTicks: number;
  baseBoxes: number;
  escalationBoxes: number;
  baseMs: number;
  escalationMs: number;
  rings: SweepRingStats[];
}

/**
 * Yesterday's sweep rollup for the digest email.
 *
 * Yesterday, not today: the digest rides the once-per-UTC-day provider
 * snapshot, which lands just after midnight UTC, so CURRENT_DATE - 1 is the
 * only complete day. `null` (no rows, or no table) renders nothing rather
 * than an error line, matching the calibration section's contract.
 */
export async function getSweepDigestSummary(): Promise<SweepDigestSummary | null> {
  try {
    const rows = (await sql`
      select
        sweep_ticks, sweep_escalated_ticks, sweep_budget_exhausted_ticks,
        sweep_sunrise_thin_ticks, sweep_sunset_thin_ticks,
        sweep_sunrise_short_ticks, sweep_sunset_short_ticks,
        sweep_base_boxes, sweep_escalation_boxes,
        sweep_base_ms, sweep_escalation_ms
      from daily_sunset_stats
      where date = CURRENT_DATE - 1
    `) as Record<string, number | string>[];
    const row = rows[0];
    if (!row || Number(row.sweep_ticks) === 0) return null;

    const ringRows = (await sql`
      select
        offset_deg, rings_swept, boxes_attempted, boxes_empty, boxes_failed,
        new_webcams, frames_scored, frames_gate_passed, elapsed_ms
      from daily_sweep_ring_stats
      where date = CURRENT_DATE - 1
      order by offset_deg desc
    `) as Record<string, number | string>[];

    return {
      ticks: Number(row.sweep_ticks),
      escalatedTicks: Number(row.sweep_escalated_ticks),
      budgetExhaustedTicks: Number(row.sweep_budget_exhausted_ticks),
      sunriseThinTicks: Number(row.sweep_sunrise_thin_ticks),
      sunsetThinTicks: Number(row.sweep_sunset_thin_ticks),
      sunriseShortTicks: Number(row.sweep_sunrise_short_ticks),
      sunsetShortTicks: Number(row.sweep_sunset_short_ticks),
      baseBoxes: Number(row.sweep_base_boxes),
      escalationBoxes: Number(row.sweep_escalation_boxes),
      baseMs: Number(row.sweep_base_ms),
      escalationMs: Number(row.sweep_escalation_ms),
      // offset_deg is NUMERIC, which the Neon driver hands back as a string.
      // Number() here or every downstream comparison against 15.75 misses.
      rings: ringRows.map((r) => ({
        offsetDeg: Number(r.offset_deg),
        ringsSwept: Number(r.rings_swept),
        boxesAttempted: Number(r.boxes_attempted),
        boxesEmpty: Number(r.boxes_empty),
        boxesFailed: Number(r.boxes_failed),
        newWebcams: Number(r.new_webcams),
        framesScored: Number(r.frames_scored),
        framesGatePassed: Number(r.frames_gate_passed),
        elapsedMs: Number(r.elapsed_ms),
      })),
    };
  } catch (error) {
    console.warn('[sweepStats] digest summary unavailable:', error);
    return null;
  }
}
