import { describe, it, expect, vi, beforeEach } from 'vitest';

const getMock = vi.fn();
const setMock = vi.fn();
const delMock = vi.fn();

vi.mock('@upstash/redis', () => ({
  Redis: { fromEnv: () => ({ get: getMock, set: setMock, del: delMock }) },
}));

beforeEach(() => {
  // Pretend Upstash env vars exist so the real getClient() path runs.
  process.env.KV_REST_API_URL = 'https://example.upstash.io';
  process.env.KV_REST_API_TOKEN = 'token';
  process.env.USE_KV_CACHE = 'true';
  getMock.mockReset();
  setMock.mockReset();
  delMock.mockReset();
});

describe('terminator payload cache', () => {
  it('getCachedTerminatorPayload reads the terminator:current key', async () => {
    const { getCachedTerminatorPayload } = await import('./cache');
    getMock.mockResolvedValue([{ id: 1 }]);

    const result = await getCachedTerminatorPayload();

    expect(getMock).toHaveBeenCalledWith('terminator:current');
    expect(result).toEqual([{ id: 1 }]);
  });

  it('setCachedTerminatorPayload writes with a 300s TTL', async () => {
    const { setCachedTerminatorPayload } = await import('./cache');
    const payload = [{ id: 7 }];

    await setCachedTerminatorPayload(payload);

    expect(setMock).toHaveBeenCalledWith('terminator:current', payload, {
      ex: 300,
    });
  });

  it('invalidateTerminatorPayload deletes the terminator:current key', async () => {
    const { invalidateTerminatorPayload } = await import('./cache');

    await invalidateTerminatorPayload();

    expect(delMock).toHaveBeenCalledWith('terminator:current');
  });

  it('getCachedTerminatorPayload returns null when Redis is unavailable', async () => {
    delete process.env.KV_REST_API_URL;
    // Force re-import so the cached client is rebuilt without env vars.
    vi.resetModules();
    const { getCachedTerminatorPayload } = await import('./cache');
    const result = await getCachedTerminatorPayload();
    expect(result).toBeNull();
  });

  it('setCachedTerminatorPayload swallows Redis errors (cache is non-fatal)', async () => {
    setMock.mockRejectedValueOnce(new Error('upstash down'));
    const { setCachedTerminatorPayload } = await import('./cache');
    await expect(
      setCachedTerminatorPayload([{ id: 1 }]),
    ).resolves.toBeUndefined();
  });
});
