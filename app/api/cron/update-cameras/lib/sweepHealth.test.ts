import { describe, it, expect } from 'vitest';
import { assessSweepHold } from './sweepHealth';
import type { SweepTelemetry } from './terminatorSweep';

function telemetry(rings: Array<{ attempted: number; failed: number }>): SweepTelemetry {
  return {
    rings: rings.map((r, i) => ({
      offsetDeg: i === 0 ? 0 : 15.75,
      feedsSwept: ['sunrise', 'sunset'],
      attempted: r.attempted,
      empty: 0,
      failed: r.failed,
      failedByStatus: r.failed ? { '400': r.failed } : {},
      newWebcams: 0,
      newWebcamIds: [],
      elapsedMs: 0,
    })),
    counts: { sunrise: 0, sunset: 0 },
    thinAfterBase: [],
    escalations: 0,
    budgetExhausted: false,
  };
}

describe('assessSweepHold', () => {
  it('does not hold a healthy sweep', () => {
    const r = assessSweepHold(telemetry([{ attempted: 30, failed: 1 }]), 97, 0.5);
    expect(r).toEqual({ held: false, reason: 'none', attempted: 30, failed: 1, found: 97 });
  });

  it('holds when no boxes were sent at all', () => {
    // A ring that built no coordinates is a bug, not an empty world.
    const r = assessSweepHold(telemetry([{ attempted: 0, failed: 0 }]), 0, 0.5);
    expect(r.held).toBe(true);
    expect(r.reason).toBe('no-boxes');
  });

  it('holds when boxes went out and nothing came back', () => {
    // The 200-with-empty-body shape a quota could take: not one failure, and
    // not one camera. The base ring circles the whole terminator and has never
    // been all ocean.
    const r = assessSweepHold(telemetry([{ attempted: 30, failed: 0 }]), 0, 0.5);
    expect(r.held).toBe(true);
    expect(r.reason).toBe('nothing-found');
  });

  it('holds when at least the ratio of boxes failed, even if some cameras came back', () => {
    const r = assessSweepHold(telemetry([{ attempted: 30, failed: 15 }]), 12, 0.5);
    expect(r.held).toBe(true);
    expect(r.reason).toBe('failed-ratio');
  });

  it('does not hold on the ordinary edge-of-world failures', () => {
    // 2 of 30 boxes 400 on the antimeridian: a normal day.
    const r = assessSweepHold(telemetry([{ attempted: 30, failed: 2 }]), 90, 0.5);
    expect(r.held).toBe(false);
  });

  it('sums across rings', () => {
    const r = assessSweepHold(
      telemetry([{ attempted: 30, failed: 0 }, { attempted: 30, failed: 30 }]),
      40,
      0.5,
    );
    expect(r.attempted).toBe(60);
    expect(r.failed).toBe(30);
    expect(r.held).toBe(true);
    expect(r.reason).toBe('failed-ratio');
  });
});
