import { describe, it, expect, vi, beforeEach } from 'vitest';

const sqlMock = vi.fn();
vi.mock('@/app/lib/db', () => ({
  sql: (strings: TemplateStringsArray, ...values: unknown[]) =>
    sqlMock(strings, ...values),
}));

import { computeTickStats, upsertDailyStats } from './dailyStats';

beforeEach(() => sqlMock.mockReset());

describe('computeTickStats', () => {
  it('computes count, avg, percentiles, and above-threshold count', () => {
    const scores = [0.1, 0.3, 0.5, 0.6, 0.8, 0.9];
    const stats = computeTickStats({
      windyScores: scores,
      customScores: [],
      cacheHits: 4,
      fallbacks: 1,
      modelVersion: 'v4',
      minScoreToWin: 0.5,
    });
    expect(stats.modelVersion).toBe('v4');
    expect(stats.webcamsScored).toBe(6);
    expect(stats.cacheHits).toBe(4);
    expect(stats.fallbacks).toBe(1);
    expect(stats.scoreAvg).toBeCloseTo(0.5333, 3);
    expect(stats.scoreP50).toBeGreaterThanOrEqual(0.5);
    expect(stats.scoreP50).toBeLessThanOrEqual(0.6);
    expect(stats.aboveMinScoreToWinCount).toBe(4); // 0.5, 0.6, 0.8, 0.9
    expect(stats.sourceBreakdown).toEqual({
      windy: { scored: 6, avg: expect.any(Number) },
      custom: { scored: 0, avg: null },
    });
  });

  it('handles empty score arrays', () => {
    const stats = computeTickStats({
      windyScores: [],
      customScores: [],
      cacheHits: 10,
      fallbacks: 0,
      modelVersion: 'v4',
      minScoreToWin: 0.5,
    });
    expect(stats.webcamsScored).toBe(0);
    expect(stats.scoreAvg).toBeNull();
    expect(stats.scoreP50).toBeNull();
  });
});

describe('upsertDailyStats', () => {
  it('UPSERTs into daily_sunset_stats by UTC date PK', async () => {
    sqlMock.mockResolvedValue([]);
    await upsertDailyStats(new Date('2026-05-15T12:34:56Z'), {
      modelVersion: 'v4',
      webcamsScored: 100,
      cacheHits: 70,
      fallbacks: 2,
      scoreAvg: 0.5,
      scoreP50: 0.5,
      scoreP90: 0.8,
      scoreP99: 0.95,
      aboveMinScoreToWinCount: 30,
      sourceBreakdown: { windy: { scored: 98, avg: 0.5 }, custom: { scored: 2, avg: 0.7 } },
    });
    const [strings, ...values] = sqlMock.mock.calls[0];
    const q = strings.join('?');
    expect(q).toMatch(/insert\s+into\s+daily_sunset_stats/i);
    expect(q).toMatch(/on\s+conflict\s*\(\s*date\s*\)/i);
    // The UTC date should be in the values, formatted as YYYY-MM-DD.
    expect(values).toContain('2026-05-15');
  });
});
