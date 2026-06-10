// app/lib/cameraHealth.test.ts
import { describe, it, expect } from 'vitest';
import { computeCameraHealth, type ExpectedWindow } from './cameraHealth';

const win = (startIso: string, endIso: string): ExpectedWindow => ({
  start: new Date(startIso),
  end: new Date(endIso),
});

describe('computeCameraHealth', () => {
  const now = new Date('2026-06-09T20:00:00Z');
  const window = win('2026-06-09T03:00:00Z', '2026-06-09T05:00:00Z'); // sunrise window earlier today

  it('returns "never" when there is no data at all', () => {
    expect(
      computeCameraHealth({ lastSnapshotAt: null, lastHeartbeatAt: null, mostRecentWindow: window, now })
    ).toBe('never');
  });

  it('returns "live" when a snapshot landed during the most recent window (even if silent for hours since)', () => {
    expect(
      computeCameraHealth({
        lastSnapshotAt: new Date('2026-06-09T04:00:00Z'),
        lastHeartbeatAt: new Date('2026-06-09T04:00:00Z'),
        mostRecentWindow: window,
        now,
      })
    ).toBe('live');
  });

  it('returns "live" for a snapshot taken exactly at window.start (inclusive boundary)', () => {
    expect(
      computeCameraHealth({
        lastSnapshotAt: new Date(window.start),
        lastHeartbeatAt: null,
        mostRecentWindow: window,
        now,
      })
    ).toBe('live');
  });

  it('returns "live" for a snapshot taken after window.end then silent (snapshot-only liveness)', () => {
    expect(
      computeCameraHealth({
        lastSnapshotAt: new Date('2026-06-09T06:00:00Z'), // after window.end (05:00Z), then silent
        lastHeartbeatAt: null,
        mostRecentWindow: window,
        now,
      })
    ).toBe('live');
  });

  it('returns "stale" when it sent a heartbeat for the window but no snapshot landed', () => {
    expect(
      computeCameraHealth({
        lastSnapshotAt: null,
        lastHeartbeatAt: new Date('2026-06-09T04:00:00Z'),
        mostRecentWindow: window,
        now,
      })
    ).toBe('stale');
  });

  it('returns "stale" when the only snapshot predates the window but a heartbeat is in-window', () => {
    expect(
      computeCameraHealth({
        lastSnapshotAt: new Date('2026-06-08T04:00:00Z'),
        lastHeartbeatAt: new Date('2026-06-09T04:00:00Z'),
        mostRecentWindow: window,
        now,
      })
    ).toBe('stale');
  });

  it('returns "offline" when it missed the window entirely', () => {
    expect(
      computeCameraHealth({
        lastSnapshotAt: new Date('2026-06-08T04:00:00Z'),
        lastHeartbeatAt: new Date('2026-06-08T04:00:00Z'),
        mostRecentWindow: window,
        now,
      })
    ).toBe('offline');
  });

  it('falls back to a rolling 24h when no window can be derived', () => {
    expect(
      computeCameraHealth({
        lastSnapshotAt: new Date('2026-06-09T10:00:00Z'), // within 24h of now
        lastHeartbeatAt: null,
        mostRecentWindow: null,
        now,
      })
    ).toBe('live');
  });
});
