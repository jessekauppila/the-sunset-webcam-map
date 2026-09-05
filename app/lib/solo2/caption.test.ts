import { describe, it, expect } from 'vitest';
import { captionLines, formatTime } from './caption';

// 02:42 UTC on 2026-09-05 is 7:42 pm the evening before in Mazatlán (UTC−7).
const AT = Date.UTC(2026, 8, 5, 2, 42);
const TZ = 'America/Mazatlan';

describe('formatTime', () => {
  it('renders each style', () => {
    expect(formatTime('off', AT, TZ, 1.23)).toBeNull();
    expect(formatTime('12h', AT, TZ, 1.23)).toBe('7:42 pm');
    expect(formatTime('12h-there', AT, TZ, 1.23)).toBe('7:42 pm there');
    expect(formatTime('24h', AT, TZ, 1.23)).toBe('19:42');
    expect(formatTime('sun', AT, TZ, 1.23)).toBe('sun 1.2° above the horizon');
    expect(formatTime('12h-sun', AT, TZ, -2.15)).toBe('7:42 pm · sun 2.1° below the horizon');
  });
  it('a morning time reads am', () => {
    expect(formatTime('12h', Date.UTC(2026, 8, 5, 13, 5), TZ, 0)).toBe('6:05 am');
  });
  it('without a timezone the clock styles say nothing and the sun still can', () => {
    expect(formatTime('12h', AT, null, 1)).toBeNull();
    expect(formatTime('24h', AT, null, 1)).toBeNull();
    expect(formatTime('12h-sun', AT, null, 1)).toBe('sun 1.0° above the horizon');
    expect(formatTime('sun', AT, TZ, null)).toBeNull();
  });
  it('an unknown zone name is treated as no zone', () => {
    expect(formatTime('12h', AT, 'Mars/Olympus', 1)).toBeNull();
  });
});

describe('captionLines', () => {
  const e = { title: 'Pier', region: 'Baja California Sur', country: 'Mexico', capturedAt: AT, timezone: TZ, sunAltitudeDeg: 1.2 };
  it('joins place and time with a middle dot', () => {
    expect(captionLines(e, { showPlace: true, timeStyle: '12h' })).toEqual({ title: 'Pier', sub: 'Baja California Sur, Mexico · 7:42 pm' });
  });
  it('omits the dot when there is no time, and everything when the place is off', () => {
    expect(captionLines(e, { showPlace: true, timeStyle: 'off' })!.sub).toBe('Baja California Sur, Mexico');
    expect(captionLines({ ...e, region: '', country: '' }, { showPlace: true, timeStyle: '12h' })!.sub).toBe('7:42 pm');
    expect(captionLines(e, { showPlace: false, timeStyle: '12h' })).toBeNull();
  });
});
