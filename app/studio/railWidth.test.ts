import { describe, it, expect, beforeEach } from 'vitest';
import {
  clampRailWidth,
  RAIL_WIDTH_DEFAULT,
  RAIL_WIDTH_MAX,
  RAIL_WIDTH_MIN,
  RAIL_WIDTH_STORAGE_KEY,
  readStoredRailWidth,
  writeStoredRailWidth,
} from './railWidth';

describe('clampRailWidth', () => {
  it('passes through widths inside the range', () => {
    expect(clampRailWidth(400)).toBe(400);
  });

  it('pins to the min and max', () => {
    expect(clampRailWidth(RAIL_WIDTH_MIN - 50)).toBe(RAIL_WIDTH_MIN);
    expect(clampRailWidth(RAIL_WIDTH_MAX + 500)).toBe(RAIL_WIDTH_MAX);
  });

  it('falls back to the default for non-finite input', () => {
    expect(clampRailWidth(Number.NaN)).toBe(RAIL_WIDTH_DEFAULT);
    expect(clampRailWidth(Number.POSITIVE_INFINITY)).toBe(RAIL_WIDTH_DEFAULT);
  });

  it('rounds to whole pixels', () => {
    expect(clampRailWidth(400.6)).toBe(401);
  });
});

describe('stored rail width', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('returns the default when nothing is stored', () => {
    expect(readStoredRailWidth()).toBe(RAIL_WIDTH_DEFAULT);
  });

  it('round-trips a written width', () => {
    writeStoredRailWidth(480);
    expect(window.localStorage.getItem(RAIL_WIDTH_STORAGE_KEY)).toBe('480');
    expect(readStoredRailWidth()).toBe(480);
  });

  it('clamps garbage and out-of-range stored values', () => {
    window.localStorage.setItem(RAIL_WIDTH_STORAGE_KEY, 'wide');
    expect(readStoredRailWidth()).toBe(RAIL_WIDTH_DEFAULT);
    window.localStorage.setItem(RAIL_WIDTH_STORAGE_KEY, '9999');
    expect(readStoredRailWidth()).toBe(RAIL_WIDTH_MAX);
  });
});
