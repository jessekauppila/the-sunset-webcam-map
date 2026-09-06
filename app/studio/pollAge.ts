/** How long since the settings poll last heard from the kiosk, for the header's status line. */
export function formatPollAge(lastPollAtMs: number | null, nowMs: number): string {
  if (lastPollAtMs === null) return 'never';
  const ageMs = Math.max(0, nowMs - lastPollAtMs);
  const ageSeconds = Math.floor(ageMs / 1000);
  if (ageSeconds < 60) return `${ageSeconds}s ago`;
  const ageMinutes = Math.floor(ageSeconds / 60);
  return `${ageMinutes}m ago`;
}
