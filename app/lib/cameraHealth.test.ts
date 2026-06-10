// app/lib/cameraHealth.test.ts
import { describe, it, expect } from 'vitest';
import { computeCameraHealth, type ExpectedWindow, getMostRecentExpectedWindow, isInWindowNow } from './cameraHealth';

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

describe('getMostRecentExpectedWindow', () => {
  const midLat = { lat: 40, lng: -74 }; // New York-ish, reliable sun events

  it('returns a window that has already started, with end after start', () => {
    const now = new Date('2026-06-09T18:00:00Z'); // afternoon UTC
    const w = getMostRecentExpectedWindow(midLat, 'both', now);
    expect(w).not.toBeNull();
    expect(w!.start.getTime()).toBeLessThanOrEqual(now.getTime());
    expect(w!.end.getTime()).toBeGreaterThan(w!.start.getTime());
  });

  it('honors phase preference (sunrise window opens in the morning, sunset in the evening)', () => {
    const now = new Date('2026-06-09T18:00:00Z');
    const sunrise = getMostRecentExpectedWindow(midLat, 'sunrise', now);
    const sunset = getMostRecentExpectedWindow(midLat, 'sunset', now);
    expect(sunrise).not.toBeNull();
    expect(sunset).not.toBeNull();
    const utcHour = (d: Date) => d.getUTCHours() + d.getUTCMinutes() / 60;
    // At lng -74 the sunrise window opens in the morning (UTC), the sunset
    // window in the evening (UTC) — true regardless of which calendar day
    // each "most recent" window falls on.
    expect(utcHour(sunrise!.start)).toBeLessThan(12);
    expect(utcHour(sunset!.start)).toBeGreaterThan(12);
  });

  it('returns null at a polar latitude where no window can be derived', () => {
    // Midsummer high Arctic: sun never crosses the dawn/dusk thresholds.
    const now = new Date('2026-06-21T12:00:00Z');
    expect(getMostRecentExpectedWindow({ lat: 89, lng: 0 }, 'both', now)).toBeNull();
  });
});

describe('isInWindowNow', () => {
  it('is false for a null window', () => {
    expect(isInWindowNow(null, new Date())).toBe(false);
  });

  it('is true only when now is between start and end', () => {
    const w = { start: new Date('2026-06-09T03:00:00Z'), end: new Date('2026-06-09T05:00:00Z') };
    expect(isInWindowNow(w, new Date('2026-06-09T04:00:00Z'))).toBe(true);
    expect(isInWindowNow(w, new Date('2026-06-09T06:00:00Z'))).toBe(false);
  });

  it('treats the window end as inclusive', () => {
    const w = { start: new Date('2026-06-09T03:00:00Z'), end: new Date('2026-06-09T05:00:00Z') };
    expect(isInWindowNow(w, new Date('2026-06-09T05:00:00Z'))).toBe(true);
  });
});
