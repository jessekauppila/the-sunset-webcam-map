export type CameraHealth = 'live' | 'stale' | 'offline' | 'never';
export type PhasePreference = 'sunrise' | 'sunset' | 'both';
export type ExpectedWindow = { start: Date; end: Date };

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ComputeCameraHealthInput {
  lastSnapshotAt: Date | null;
  lastHeartbeatAt: Date | null;
  mostRecentWindow: ExpectedWindow | null;
  now: Date;
}

/**
 * Window-relative health. These cameras are duty-cycled (asleep at midday), so
 * a healthy camera is legitimately silent most of the day. We judge against the
 * most recent expected capture window, NOT the wall clock.
 */
export function computeCameraHealth({
  lastSnapshotAt,
  lastHeartbeatAt,
  mostRecentWindow,
  now,
}: ComputeCameraHealthInput): CameraHealth {
  if (lastSnapshotAt == null && lastHeartbeatAt == null) return 'never';

  // No derivable window (e.g. polar day/night) → rolling 24h so health is never stuck.
  const windowStart = mostRecentWindow
    ? mostRecentWindow.start
    : new Date(now.getTime() - DAY_MS);
  const startMs = windowStart.getTime();

  if (lastSnapshotAt != null && lastSnapshotAt.getTime() >= startMs) return 'live';
  if (lastHeartbeatAt != null && lastHeartbeatAt.getTime() >= startMs) return 'stale';
  return 'offline';
}
