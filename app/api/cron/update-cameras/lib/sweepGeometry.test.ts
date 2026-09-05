// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sqlMock = vi.fn();
vi.mock('@/app/lib/db', () => ({
  sql: (strings: TemplateStringsArray, ...values: unknown[]) =>
    sqlMock(strings, ...values),
}));

import { coverageSpan, sweepGeometry, sweptZone, upsertSweepGeometry } from './sweepGeometry';

beforeEach(() => {
  sqlMock.mockReset();
});

describe('sweptZone', () => {
  it('is the base ring alone when only the base ring swept', () => {
    expect(sweptZone([0])).toEqual({ minDeg: -24, maxDeg: -2 });
  });

  it('includes every ring that swept this tick, escalations included', () => {
    // The 2026-09-05 sunrise bug: the sweep escalated to +15.75 for a thin
    // sunrise feed and admitted golden-hour cameras at +1..+11, but the
    // removal zone counted only the guaranteed rings (-24..-2), so every one
    // of them was evicted three ticks later. Admission and removal must read
    // the same band.
    expect(sweptZone([0, 15.75, -15.75])).toEqual({ minDeg: -39.75, maxDeg: 13.75 });
  });

  it('always contains the base ring, even if telemetry omitted it', () => {
    expect(sweptZone([15.75])).toEqual({ minDeg: -24, maxDeg: 13.75 });
    expect(sweptZone([])).toEqual({ minDeg: -24, maxDeg: -2 });
  });
});

describe('coverageSpan', () => {
  it('widens a single ring altitude by the search radius on both sides', () => {
    expect(coverageSpan([-13])).toEqual({ min: -24, max: -2 });
  });

  it('spans from the night-most floor to the day-most ceiling', () => {
    expect(coverageSpan([-13, 2.75])).toEqual({ min: -24, max: 13.75 });
  });
});

describe('sweepGeometry', () => {
  it('records the base ring alone when nothing is forced', () => {
    const g = sweepGeometry([]);
    expect(g.baseAltitudeDeg).toBe(-13);
    expect(g.searchRadiusDeg).toBe(11);
    expect(g.forcedOffsetsDeg).toBe('');
    expect(g.coverageMinDeg).toBe(-24);
    expect(g.coverageMaxDeg).toBe(-2);
  });

  it('widens the recorded coverage to golden hour when the day ring is forced', () => {
    // This is the number the whole measurement is about: the guaranteed pool
    // has to contain 0 to +6 degrees, where 19.7% of frames are good, versus
    // 1.0% at the base ring.
    const g = sweepGeometry([15.75]);
    expect(g.coverageMinDeg).toBe(-24);
    expect(g.coverageMaxDeg).toBe(13.75);
  });

  it('gives different configurations different signatures', () => {
    expect(sweepGeometry([]).signature).not.toBe(sweepGeometry([15.75]).signature);
  });

  it('gives the same configuration the same signature every tick', () => {
    expect(sweepGeometry([15.75]).signature).toBe(sweepGeometry([15.75]).signature);
  });
});

describe('upsertSweepGeometry', () => {
  it('never throws when the table is missing', async () => {
    // Same non-fatal contract as upsertSweepStats: a deploy that lands before
    // the migration is applied must not fail the tick.
    sqlMock.mockRejectedValue(new Error('relation "daily_sweep_geometry" does not exist'));
    await expect(
      upsertSweepGeometry(new Date('2026-09-05T00:10:00Z'), sweepGeometry([]))
    ).resolves.toBeUndefined();
  });

  it('writes under the UTC date', async () => {
    sqlMock.mockResolvedValue([]);
    await upsertSweepGeometry(new Date('2026-09-05T00:10:00Z'), sweepGeometry([]));
    expect(sqlMock.mock.calls[0]).toContain('2026-09-05');
  });
});
