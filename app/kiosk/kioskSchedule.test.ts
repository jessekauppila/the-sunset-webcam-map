import { describe, it, expect } from 'vitest';
import {
  parseQuietParam,
  isInQuietHours,
  isDozing,
  shouldRunTick,
  type KioskGate,
} from './kioskSchedule';

describe('parseQuietParam', () => {
  it('defaults to 1-8', () => {
    expect(parseQuietParam(null)).toEqual({ start: 1, end: 8 });
  });
  it('parses off and custom windows', () => {
    expect(parseQuietParam('off')).toBeNull();
    expect(parseQuietParam('23-9')).toEqual({ start: 23, end: 9 });
  });
  it('falls back to default on garbage', () => {
    expect(parseQuietParam('banana')).toEqual({ start: 1, end: 8 });
  });
});

describe('isInQuietHours', () => {
  it('handles a simple window', () => {
    expect(isInQuietHours(3, { start: 1, end: 8 })).toBe(true);
    expect(isInQuietHours(8, { start: 1, end: 8 })).toBe(false); // half-open
    expect(isInQuietHours(12, { start: 1, end: 8 })).toBe(false);
  });
  it('handles a window crossing midnight', () => {
    expect(isInQuietHours(23, { start: 23, end: 9 })).toBe(true);
    expect(isInQuietHours(2, { start: 23, end: 9 })).toBe(true);
    expect(isInQuietHours(10, { start: 23, end: 9 })).toBe(false);
  });
  it('is always false when disabled', () => {
    expect(isInQuietHours(3, null)).toBe(false);
  });
});

const base: KioskGate = {
  visible: true,
  localDoze: false,
  remoteDoze: false,
  quiet: { start: 1, end: 8 },
  hourLocal: 12,
  msSinceInteraction: null,
  wakeMinutes: 30,
};

describe('isDozing / shouldRunTick', () => {
  it('runs normally in the day', () => {
    expect(isDozing(base)).toBe(false);
    expect(shouldRunTick(base)).toBe(true);
  });
  it('dozes during quiet hours with no interaction', () => {
    const g = { ...base, hourLocal: 3 };
    expect(isDozing(g)).toBe(true);
    expect(shouldRunTick(g)).toBe(false);
  });
  it('a recent interaction wakes it through quiet hours', () => {
    const g = { ...base, hourLocal: 3, msSinceInteraction: 5 * 60_000 };
    expect(isDozing(g)).toBe(false);
    expect(shouldRunTick(g)).toBe(true);
  });
  it('the wake window expires', () => {
    const g = { ...base, hourLocal: 3, msSinceInteraction: 31 * 60_000 };
    expect(isDozing(g)).toBe(true);
  });
  it('local and remote doze are sticky regardless of interaction', () => {
    expect(isDozing({ ...base, localDoze: true, msSinceInteraction: 0 })).toBe(true);
    expect(isDozing({ ...base, remoteDoze: true, msSinceInteraction: 0 })).toBe(true);
  });
  it('never ticks while hidden', () => {
    expect(shouldRunTick({ ...base, visible: false })).toBe(false);
  });
});
