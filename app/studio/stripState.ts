/**
 * Pure computation behind the studio status strip (Task 13). Kept
 * dependency-free from React so the priority rules and formatting are
 * covered directly, without a render.
 */

export type StripKind = 'insync' | 'drift' | 'deploying' | 'stale';

export interface StripStateArgs {
  diffCount: number;
  lastPollAtMs: number | null;
  deployedAtMs: number | null;
  nowMs: number;
  pollIntervalMs: number; // pass KIOSK_TICK_INTERVAL_MS
}

export interface StripStateResult {
  kind: StripKind;
  secondsToGlass?: number;
}

/**
 * Priority order (first match wins):
 *   stale     — lastPollAtMs null OR nowMs - lastPollAtMs > 3 * pollIntervalMs
 *   deploying — deployedAtMs set AND lastPollAtMs < deployedAtMs
 *   drift     — diffCount > 0
 *   insync    — otherwise
 */
export function stripState({
  diffCount,
  lastPollAtMs,
  deployedAtMs,
  nowMs,
  pollIntervalMs,
}: StripStateArgs): StripStateResult {
  const isStale =
    lastPollAtMs === null || nowMs - lastPollAtMs > 3 * pollIntervalMs;
  if (isStale) return { kind: 'stale' };

  const isDeploying = deployedAtMs !== null && lastPollAtMs < deployedAtMs;
  if (isDeploying) {
    const secondsToGlass = Math.max(
      0,
      Math.ceil((lastPollAtMs + pollIntervalMs - nowMs) / 1000)
    );
    return { kind: 'deploying', secondsToGlass };
  }

  if (diffCount > 0) return { kind: 'drift' };

  return { kind: 'insync' };
}

/** '32s ago' | '6m ago' | 'never' */
export function formatPollAge(lastPollAtMs: number | null, nowMs: number): string {
  if (lastPollAtMs === null) return 'never';
  const ageMs = Math.max(0, nowMs - lastPollAtMs);
  const ageSeconds = Math.floor(ageMs / 1000);
  if (ageSeconds < 60) return `${ageSeconds}s ago`;
  const ageMinutes = Math.floor(ageSeconds / 60);
  return `${ageMinutes}m ago`;
}
