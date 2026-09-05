import { describe, it, expect } from 'vitest';
import { nextCronMs, formatCountdown, CRON_PERIOD_MS } from './countdown';

describe('countdown', () => {
  it('nextCronMs is the next 10-minute mark', () => {
    expect(nextCronMs(0)).toBe(CRON_PERIOD_MS);
    expect(nextCronMs(CRON_PERIOD_MS - 1)).toBe(CRON_PERIOD_MS);
    expect(nextCronMs(CRON_PERIOD_MS)).toBe(2 * CRON_PERIOD_MS);
  });
  it('formatCountdown renders m:ss and clamps at zero', () => {
    expect(formatCountdown(605_000)).toBe('10:05');
    expect(formatCountdown(59_000)).toBe('0:59');
    expect(formatCountdown(-5)).toBe('0:00');
  });
});
