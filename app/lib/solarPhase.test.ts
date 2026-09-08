import { describe, it, expect } from 'vitest';
import { solarPhaseAt, solarPhaseOf, sunAltitudeDeg } from './solarPhase';

// Kasane, Botswana — the camera that started this: "Kasane: Chobe Savanna
// Lodge". Both frames below are real archive rows, and the two labels we used
// to trust disagree about them, which is the point of computing it instead.
const KASANE = { lat: -17.8306, lng: 25.05327 };
const utc = (iso: string) => new Date(iso);

describe('solarPhaseAt', () => {
  it('calls a climbing sun a sunrise', () => {
    // Snapshot 82891, 06:27 local, sun on the horizon. Claude scored it 0.82
    // and it ranks 8th on a board titled Best Sunsets.
    const at = utc('2026-03-14T04:27:24Z');
    expect(sunAltitudeDeg(at, KASANE.lat, KASANE.lng)).toBeCloseTo(0.3, 0);
    expect(solarPhaseAt(at, KASANE.lat, KASANE.lng)).toBe('sunrise');
  });

  it('calls a falling sun a sunset', () => {
    const at = utc('2026-03-14T15:44:35Z'); // snapshot 85701, sun at +11°
    expect(solarPhaseAt(at, KASANE.lat, KASANE.lng)).toBe('sunset');
  });

  it('disagrees with the stored phase column when the column is wrong', () => {
    // Snapshot 119355 is stored as phase 'sunset'; the sun was below the
    // horizon and climbing, so it is a pre-dawn frame.
    const at = utc('2026-07-31T04:15:56Z');
    expect(sunAltitudeDeg(at, KASANE.lat, KASANE.lng)).toBeLessThan(0);
    expect(solarPhaseAt(at, KASANE.lat, KASANE.lng)).toBe('sunrise');
  });

  it('holds inside the polar circle, where the sun can climb without rising', () => {
    // Longyearbyen in midsummer: the sun never sets, so an azimuth-crossing
    // test has nothing to cross. Local midnight is still the sunrise half.
    const svalbard = { lat: 78.22, lng: 15.65 };
    // Solar midnight there is ~22:52 UTC; half an hour past it the sun is
    // climbing again, 11.8° up and never having touched the horizon.
    const midnight = utc('2026-06-21T23:30:00Z');
    const afternoon = utc('2026-06-21T13:00:00Z');
    expect(sunAltitudeDeg(midnight, svalbard.lat, svalbard.lng)).toBeGreaterThan(0);
    expect(solarPhaseAt(midnight, svalbard.lat, svalbard.lng)).toBe('sunrise');
    expect(solarPhaseAt(afternoon, svalbard.lat, svalbard.lng)).toBe('sunset');
  });
});

describe('solarPhaseOf', () => {
  it('accepts the shapes a database row arrives in', () => {
    expect(solarPhaseOf('2026-03-14T04:27:24Z', KASANE.lat, KASANE.lng)).toBe('sunrise');
    expect(solarPhaseOf(utc('2026-03-14T15:44:35Z'), KASANE.lat, KASANE.lng)).toBe('sunset');
    expect(solarPhaseOf(Date.parse('2026-03-14T15:44:35Z'), KASANE.lat, KASANE.lng)).toBe('sunset');
  });

  it('says nothing rather than guessing when the row cannot answer', () => {
    expect(solarPhaseOf(null, KASANE.lat, KASANE.lng)).toBeNull();
    expect(solarPhaseOf('2026-03-14T04:27:24Z', null, KASANE.lng)).toBeNull();
    expect(solarPhaseOf('2026-03-14T04:27:24Z', KASANE.lat, undefined)).toBeNull();
    expect(solarPhaseOf('not a date', KASANE.lat, KASANE.lng)).toBeNull();
    expect(solarPhaseOf('2026-03-14T04:27:24Z', Number.NaN, KASANE.lng)).toBeNull();
  });
});
