// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sqlMock = vi.fn();
vi.mock('@/app/lib/db', () => ({
  sql: (...args: unknown[]) => sqlMock(...args),
}));

import { classifyCustomCamerasForTick } from './customClassification';

beforeEach(() => {
  sqlMock.mockReset();
});

describe('classifyCustomCamerasForTick', () => {
  const sunriseCoords = [{ lat: 0, lng: 0 }];
  const sunsetCoords = [{ lat: 0, lng: 180 }];

  it('returns rows in sunrise bucket for cams near sunriseCoords', async () => {
    sqlMock.mockResolvedValue([
      { webcam_id: 101, lat: 0.1, lng: 0.1 },
      { webcam_id: 102, lat: -0.1, lng: 0.2 },
    ]);

    const { sunrise, sunset } = await classifyCustomCamerasForTick({
      sunriseCoords,
      sunsetCoords,
      freshnessWindowMinutes: 90,
      now: new Date('2026-05-15T00:00:00Z'),
    });

    expect(sunrise.map((r) => r.webcamId).sort()).toEqual([101, 102]);
    expect(sunset).toEqual([]);
  });

  it('places cams in sunset bucket when nearer sunsetCoords', async () => {
    sqlMock.mockResolvedValue([
      { webcam_id: 200, lat: 0, lng: 179 },
    ]);

    const { sunrise, sunset } = await classifyCustomCamerasForTick({
      sunriseCoords,
      sunsetCoords,
      freshnessWindowMinutes: 90,
      now: new Date('2026-05-15T00:00:00Z'),
    });

    expect(sunrise).toEqual([]);
    expect(sunset.map((r) => r.webcamId)).toEqual([200]);
  });

  it('returns empty arrays when SQL returns no rows', async () => {
    sqlMock.mockResolvedValue([]);

    const { sunrise, sunset } = await classifyCustomCamerasForTick({
      sunriseCoords,
      sunsetCoords,
      freshnessWindowMinutes: 90,
      now: new Date('2026-05-15T00:00:00Z'),
    });

    expect(sunrise).toEqual([]);
    expect(sunset).toEqual([]);
  });

  it('passes freshness threshold into the SQL parameters', async () => {
    sqlMock.mockResolvedValue([]);
    const now = new Date('2026-05-15T12:00:00Z');

    await classifyCustomCamerasForTick({
      sunriseCoords,
      sunsetCoords,
      freshnessWindowMinutes: 90,
      now,
    });

    // sqlMock receives the tagged-template strings + values. The freshness
    // cutoff is a value at position 0 (the only one). It should be a Date
    // 90 minutes before `now`.
    const callValues = sqlMock.mock.calls[0].slice(1) as unknown[];
    const passed = callValues[0] as Date;
    const expected = new Date(now.getTime() - 90 * 60_000);
    expect(passed.getTime()).toBe(expected.getTime());
  });
});
