import { describe, it, expect, vi, beforeEach } from 'vitest';

const sqlMock = vi.fn();
vi.mock('@/app/lib/db', () => ({
  sql: (strings: TemplateStringsArray, ...values: unknown[]) =>
    sqlMock(strings, ...values),
}));

import {
  ringOffsetByWebcamId,
  computeSweepTickStats,
  upsertSweepStats,
  getSweepDigestSummary,
} from './sweepStats';
import type { SweepTelemetry } from './terminatorSweep';

// Braces, not a concise arrow: `mockReset()` returns the mock, and Vitest
// treats a value returned from a hook as a teardown callback -- it would call
// sqlMock() after every test, which under a rejecting implementation surfaces
// as an unhandled rejection blamed on the test that installed it.
beforeEach(() => {
  sqlMock.mockReset();
});

/** A healthy tick: base ring only, both feeds over the floor. */
const healthy: SweepTelemetry = {
  rings: [
    {
      offsetDeg: 0,
      feedsSwept: ['sunrise', 'sunset'],
      attempted: 31,
      empty: 4,
      failed: 0,
      failedByStatus: {},
      newWebcams: 3,
      newWebcamIds: [101, 102, 103],
      elapsedMs: 8_000,
    },
  ],
  counts: { sunrise: 18, sunset: 21 },
  thinAfterBase: [],
  escalations: 0,
  budgetExhausted: false,
};

/** Sunset thin after the base ring; the day-side ring recovers it. */
const escalated: SweepTelemetry = {
  rings: [
    {
      offsetDeg: 0,
      feedsSwept: ['sunrise', 'sunset'],
      attempted: 31,
      empty: 4,
      failed: 0,
      failedByStatus: {},
      newWebcams: 3,
      newWebcamIds: [101, 102, 103],
      elapsedMs: 8_000,
    },
    {
      offsetDeg: 15.75,
      feedsSwept: ['sunset'],
      attempted: 15,
      empty: 2,
      failed: 0,
      failedByStatus: {},
      newWebcams: 2,
      newWebcamIds: [201, 202],
      elapsedMs: 5_000,
    },
  ],
  counts: { sunrise: 18, sunset: 17 },
  thinAfterBase: ['sunset'],
  escalations: 1,
  budgetExhausted: false,
};

describe('ringOffsetByWebcamId', () => {
  it('attributes each camera to the ring that first saw it', () => {
    const map = ringOffsetByWebcamId(escalated);
    expect(map.get(101)).toBe(0);
    expect(map.get(201)).toBe(15.75);
    expect(map.get(999)).toBeUndefined();
  });
});

describe('computeSweepTickStats', () => {
  it('counts a healthy tick as one tick and nothing else', () => {
    const s = computeSweepTickStats({ telemetry: healthy, floor: 15 });
    expect(s.ticks).toBe(1);
    expect(s.escalatedTicks).toBe(0);
    expect(s.sunriseThinTicks).toBe(0);
    expect(s.sunsetThinTicks).toBe(0);
    expect(s.sunriseShortTicks).toBe(0);
    expect(s.sunsetShortTicks).toBe(0);
    expect(s.baseBoxes).toBe(31);
    expect(s.escalationBoxes).toBe(0);
  });

  it('splits boxes into base and escalation, and marks the thin feed', () => {
    const s = computeSweepTickStats({ telemetry: escalated, floor: 15 });
    expect(s.escalatedTicks).toBe(1);
    expect(s.sunsetThinTicks).toBe(1);
    expect(s.sunriseThinTicks).toBe(0);
    expect(s.baseBoxes).toBe(31);
    expect(s.escalationBoxes).toBe(15);
  });

  it('separates a feed that widened from one that widening did not recover', () => {
    // Sunset was thin AND is still under the floor after every ring: the
    // failure the digest exists to make visible.
    const stillShort: SweepTelemetry = {
      ...escalated,
      counts: { sunrise: 18, sunset: 9 },
    };
    const s = computeSweepTickStats({ telemetry: stillShort, floor: 15 });
    expect(s.sunsetThinTicks).toBe(1);
    expect(s.sunsetShortTicks).toBe(1);
  });

  it('records a thin feed even when the budget stopped the sweep', () => {
    // thinAfterBase, not feedsSwept, is the source: a tick that ran out of
    // budget before ring 1 has a thin feed and no escalation ring to show it.
    const starved: SweepTelemetry = {
      rings: [healthy.rings[0]],
      counts: { sunrise: 4, sunset: 21 },
      thinAfterBase: ['sunrise'],
      escalations: 0,
      budgetExhausted: true,
    };
    const s = computeSweepTickStats({ telemetry: starved, floor: 15 });
    expect(s.sunriseThinTicks).toBe(1);
    expect(s.escalationBoxes).toBe(0);
    expect(s.budgetExhaustedTicks).toBe(1);
  });

  it('folds per-ring gate outcomes onto the ring that found the camera', () => {
    const s = computeSweepTickStats({
      telemetry: escalated,
      floor: 15,
      gateByOffset: new Map([
        [0, { scored: 3, gatePassed: 1 }],
        [15.75, { scored: 2, gatePassed: 0 }],
      ]),
    });
    const day = s.rings.find((r) => r.offsetDeg === 15.75)!;
    expect(day).toMatchObject({
      ringsSwept: 1,
      boxesAttempted: 15,
      boxesEmpty: 2,
      newWebcams: 2,
      framesScored: 2,
      framesGatePassed: 0,
    });
    expect(s.rings.find((r) => r.offsetDeg === 0)!.framesGatePassed).toBe(1);
  });

  it('leaves gate counts at zero when no scoring outcomes are supplied', () => {
    const s = computeSweepTickStats({ telemetry: escalated, floor: 15 });
    expect(s.rings.every((r) => r.framesScored === 0)).toBe(true);
  });

  it('accumulates failed boxes per ring', async () => {
    const withFailures: SweepTelemetry = {
      ...healthy,
      rings: [{ ...healthy.rings[0], failed: 3, failedByStatus: { '400': 3 } }],
    };
    const stats = computeSweepTickStats({ telemetry: withFailures, floor: 15 });
    expect(stats.rings[0].boxesFailed).toBe(3);
    expect(stats.rings[0].boxesEmpty).toBe(healthy.rings[0].empty);
  });

  it('splits sweep milliseconds into base and escalation', async () => {
    const stats = computeSweepTickStats({ telemetry: escalated, floor: 15 });
    expect(stats.baseMs).toBe(8_000);
    expect(stats.escalationMs).toBe(5_000);
  });

  it('reports no escalation milliseconds on a base-only tick', async () => {
    const stats = computeSweepTickStats({ telemetry: healthy, floor: 15 });
    expect(stats.baseMs).toBe(8_000);
    expect(stats.escalationMs).toBe(0);
  });
});

describe('upsertSweepStats', () => {
  it('writes the tick counters and one row per ring', async () => {
    sqlMock.mockResolvedValue([]);
    const stats = computeSweepTickStats({ telemetry: escalated, floor: 15 });
    await upsertSweepStats(new Date('2026-09-03T00:20:00Z'), stats, 'v5');

    // one daily_sunset_stats upsert + one row per ring
    expect(sqlMock).toHaveBeenCalledTimes(3);
    const [tickCall, ...ringCalls] = sqlMock.mock.calls;
    expect(tickCall[0].join('?')).toContain('daily_sunset_stats');
    expect(tickCall).toContain('2026-09-03');
    expect(tickCall).toContain(stats.baseMs);
    expect(tickCall).toContain(stats.escalationMs);
    for (const call of ringCalls) {
      expect(call[0].join('?')).toContain('daily_sweep_ring_stats');
      expect(call).toContain('2026-09-03');
    }
    expect(ringCalls.some((c) => c.includes(15.75))).toBe(true);
    expect(
      ringCalls.some((c) => stats.rings.some((r) => c.includes(r.elapsedMs))),
    ).toBe(true);
  });

  it('never throws when the tables are missing', async () => {
    sqlMock.mockImplementation(async () => {
      throw new Error('no such table');
    });
    const stats = computeSweepTickStats({ telemetry: healthy, floor: 15 });
    await expect(
      upsertSweepStats(new Date('2026-09-03T00:20:00Z'), stats, 'v5'),
    ).resolves.toBeUndefined();
  });
});

describe('getSweepDigestSummary', () => {
  it('returns yesterday-s tick counters joined to their ring rows', async () => {
    sqlMock
      .mockResolvedValueOnce([
        {
          sweep_ticks: 96,
          sweep_escalated_ticks: 12,
          sweep_budget_exhausted_ticks: 1,
          sweep_sunrise_thin_ticks: 0,
          sweep_sunset_thin_ticks: 12,
          sweep_sunrise_short_ticks: 0,
          sweep_sunset_short_ticks: 4,
          sweep_base_boxes: 2976,
          sweep_escalation_boxes: 180,
        },
      ])
      .mockResolvedValueOnce([
        {
          offset_deg: '0.00',
          rings_swept: 96,
          boxes_attempted: 2976,
          boxes_empty: 300,
          new_webcams: 400,
          frames_scored: 380,
          frames_gate_passed: 130,
        },
      ]);
    const summary = await getSweepDigestSummary();
    expect(summary).not.toBeNull();
    expect(summary!.ticks).toBe(96);
    expect(summary!.escalationBoxes).toBe(180);
    // NUMERIC comes back from the Neon driver as a string; the summary must
    // hand the formatter a number or the ring lookup silently misses.
    expect(summary!.rings[0].offsetDeg).toBe(0);
    expect(summary!.rings[0].framesGatePassed).toBe(130);
  });

  it('returns null when nothing was recorded', async () => {
    sqlMock.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    expect(await getSweepDigestSummary()).toBeNull();
  });

  it('returns null rather than throwing when the table is missing', async () => {
    sqlMock.mockImplementation(async () => {
      throw new Error('no such table');
    });
    expect(await getSweepDigestSummary()).toBeNull();
  });

  it('reads the timing columns back for the digest', async () => {
    sqlMock
      .mockResolvedValueOnce([
        {
          sweep_ticks: 96, sweep_escalated_ticks: 96,
          sweep_budget_exhausted_ticks: 3,
          sweep_sunrise_thin_ticks: 0, sweep_sunset_thin_ticks: 0,
          sweep_sunrise_short_ticks: 0, sweep_sunset_short_ticks: 0,
          sweep_base_boxes: 2976, sweep_escalation_boxes: 2880,
          sweep_base_ms: '1152000', sweep_escalation_ms: '960000',
        },
      ])
      .mockResolvedValueOnce([
        {
          offset_deg: '0', rings_swept: 96, boxes_attempted: 2976,
          boxes_empty: 400, boxes_failed: 0, new_webcams: 300, frames_scored: 200,
          frames_gate_passed: 40, elapsed_ms: '1152000',
        },
      ]);
    const summary = await getSweepDigestSummary();
    // BIGINT arrives from the Neon driver as a string, like every NUMERIC in
    // this codebase. Unwrapped, every downstream comparison silently
    // concatenates instead of adding.
    expect(summary?.escalationMs).toBe(960_000);
    expect(summary?.rings[0].elapsedMs).toBe(1_152_000);
  });
});
