// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

const requireOwnerMock = vi.fn();
vi.mock('@/app/lib/owner', () => ({
  requireOwner: (...a: unknown[]) => requireOwnerMock(...a),
}));

const sqlMock = vi.fn();
vi.mock('@/app/lib/db', () => ({
  sql: (strings: TemplateStringsArray, ...values: unknown[]) =>
    sqlMock(strings, ...values),
}));

import { GET } from './route';

describe('GET /api/admin/ops-stats', () => {
  beforeEach(() => {
    requireOwnerMock.mockReset();
    sqlMock.mockReset();
  });

  it('returns 403 when requireOwner denies', async () => {
    requireOwnerMock.mockResolvedValueOnce(
      NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    );
    const res = await GET();
    expect(res.status).toBe(403);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('returns daily stats, provider usage, and cost events for the owner', async () => {
    requireOwnerMock.mockResolvedValueOnce(null);
    sqlMock
      .mockResolvedValueOnce([
        {
          date: '2026-07-30',
          model_version: 'v4',
          webcams_scored: 500,
          cache_hits: 400,
          fallbacks: 2,
          score_p50: 0.31,
          score_p90: 0.71,
          source_breakdown: null,
        },
      ])
      .mockResolvedValueOnce([
        {
          day: '2026-07-30',
          project_id: 'noisy-leaf-96391119',
          compute_time_s: '36000',
        },
      ])
      .mockResolvedValueOnce([
        {
          occurred_on: '2026-07-31',
          sha: null,
          description: 'autoscale 0.25-1 CU',
        },
      ]);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.dailyStats).toHaveLength(1);
    expect(body.dailyStats[0].date).toBe('2026-07-30');
    expect(body.providerUsage).toHaveLength(1);
    expect(body.providerUsage[0].project_id).toBe('noisy-leaf-96391119');
    expect(body.costEvents[0].description).toContain('autoscale');
  });

  it('casts the provider-usage lookback interpolation to ::int so Postgres does not parse it as a date', async () => {
    requireOwnerMock.mockResolvedValueOnce(null);
    sqlMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    await GET();
    const providerUsageCall = sqlMock.mock.calls.find(([strings]) =>
      (strings as TemplateStringsArray).join('').includes('provider_usage_daily'),
    );
    expect(providerUsageCall).toBeDefined();
    const [strings] = providerUsageCall as [TemplateStringsArray, ...unknown[]];
    expect(strings.join('')).toContain('::int');
  });
});
