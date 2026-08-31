// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const sqlMock = vi.fn();
vi.mock('@/app/lib/db', () => ({
  sql: (strings: TemplateStringsArray, ...values: unknown[]) =>
    sqlMock(strings, ...values),
}));

import { captureProviderUsageDaily } from './providerUsage';

const NOW = new Date('2026-08-02T00:20:00Z');

describe('captureProviderUsageDaily', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    sqlMock.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    process.env.NEON_COST_API = 'test-key';
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.NEON_COST_API;
  });

  it('skips when today already has rows', async () => {
    sqlMock.mockResolvedValueOnce([{ count: 4 }]);
    const result = await captureProviderUsageDaily(NOW);
    expect(result).toEqual({ skipped: 'already-captured' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('skips without the API key', async () => {
    delete process.env.NEON_COST_API;
    const result = await captureProviderUsageDaily(NOW);
    expect(result).toEqual({ skipped: 'no-api-key' });
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('fetches each project and upserts counters', async () => {
    sqlMock.mockResolvedValueOnce([{ count: 0 }]); // guard
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        project: {
          compute_time_seconds: 3600,
          active_time_seconds: 7200,
          data_transfer_bytes: 10,
          synthetic_storage_size: 20,
        },
      }),
    });
    sqlMock.mockResolvedValue([]); // upserts
    const result = await captureProviderUsageDaily(NOW);
    expect(result).toEqual({ captured: 4 }); // 4 configured projects
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const firstUrl = fetchMock.mock.calls[0][0] as string;
    expect(firstUrl).toContain('https://console.neon.tech/api/v2/projects/');
  });

  it('tolerates one project failing (partial rows are fine)', async () => {
    sqlMock.mockResolvedValueOnce([{ count: 0 }]);
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValue({
        ok: true,
        json: async () => ({
          project: {
            compute_time_seconds: 1,
            active_time_seconds: 1,
            data_transfer_bytes: 1,
            synthetic_storage_size: 1,
          },
        }),
      });
    sqlMock.mockResolvedValue([]);
    const result = await captureProviderUsageDaily(NOW);
    expect(result).toEqual({ captured: 3 });
  });
});
