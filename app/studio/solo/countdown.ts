export const CRON_PERIOD_MS = 10 * 60 * 1000;

/** The next 10-minute mark on Unix time: when the cron pulls Windy next. */
export function nextCronMs(nowMs: number): number {
  return (Math.floor(nowMs / CRON_PERIOD_MS) + 1) * CRON_PERIOD_MS;
}

/** `m:ss`, clamped at zero. */
export function formatCountdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
