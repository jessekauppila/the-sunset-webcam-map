import { describe, it, expect } from 'vitest';
import { getOrCreatePhoneId, clockLabel, PHONE_ID_KEY } from './stationHelpers';

function memStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    _map: map,
  };
}

describe('getOrCreatePhoneId', () => {
  it('creates and persists an id when none exists', () => {
    const s = memStorage();
    const id = getOrCreatePhoneId(s, () => 'fixed');
    expect(id).toBe('fixed');
    expect(s.getItem(PHONE_ID_KEY)).toBe('fixed');
  });

  it('returns the existing id without regenerating', () => {
    const s = memStorage({ [PHONE_ID_KEY]: 'existing' });
    const id = getOrCreatePhoneId(s, () => 'new');
    expect(id).toBe('existing');
  });
});

describe('clockLabel', () => {
  it.each([
    [0, "12 o'clock"],
    [90, "3 o'clock"],
    [180, "6 o'clock"],
    [270, "9 o'clock"],
    [360, "12 o'clock"],
    [30, "1 o'clock"],
  ])('maps %i° to %s', (deg, label) => {
    expect(clockLabel(deg)).toBe(label);
  });
});
