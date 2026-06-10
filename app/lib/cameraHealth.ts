import SunCalc from 'suncalc';

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

function isValidDate(d: Date | undefined): d is Date {
  return d instanceof Date && !Number.isNaN(d.getTime());
}

function windowForPhase(
  times: ReturnType<typeof SunCalc.getTimes>,
  phase: 'sunrise' | 'sunset'
): ExpectedWindow | null {
  // Sunrise window ≈ civil dawn → end of morning golden hour.
  // Sunset window ≈ start of evening golden hour → civil dusk.
  const start = phase === 'sunrise' ? times.dawn : times.goldenHour;
  const end = phase === 'sunrise' ? times.goldenHourEnd : times.dusk;
  return isValidDate(start) && isValidDate(end) ? { start, end } : null;
}

/**
 * The most recent expected capture window for this location whose start is at or
 * before `now`. Scans today and yesterday so a window that began before midnight
 * (or before now) still counts. Returns null when no window can be computed
 * (e.g. polar day/night where SunCalc yields Invalid Dates).
 *
 * Note: the returned window MAY have already ended — it is the most recent
 * window to have *started*, not necessarily one that contains `now`. Callers
 * wanting current membership should use `isInWindowNow`.
 */
export function getMostRecentExpectedWindow(
  location: { lat: number; lng: number },
  phasePreference: PhasePreference,
  now: Date
): ExpectedWindow | null {
  const phases: Array<'sunrise' | 'sunset'> =
    phasePreference === 'both' ? ['sunrise', 'sunset'] : [phasePreference];

  const candidates: ExpectedWindow[] = [];
  for (const dayOffset of [0, -1]) {
    const day = new Date(now.getTime() + dayOffset * DAY_MS);
    const times = SunCalc.getTimes(day, location.lat, location.lng);
    for (const phase of phases) {
      const win = windowForPhase(times, phase);
      if (win && win.start.getTime() <= now.getTime()) candidates.push(win);
    }
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.start.getTime() - a.start.getTime());
  return candidates[0];
}

export function isInWindowNow(window: ExpectedWindow | null, now: Date): boolean {
  if (!window) return false;
  const t = now.getTime();
  return t >= window.start.getTime() && t <= window.end.getTime();
}
