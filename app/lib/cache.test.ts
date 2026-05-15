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

describe('camera image hash helpers', () => {
  it('getCameraImageHash reads from camera:hash:<source>:<webcamId>', async () => {
    const { getCameraImageHash } = await import('./cache');
    getMock.mockResolvedValue('abc123');

    const result = await getCameraImageHash('windy', 4242);

    expect(getMock).toHaveBeenCalledWith('camera:hash:windy:4242');
    expect(result).toBe('abc123');
  });

  it('setCameraImageHash writes with a 24h TTL', async () => {
    const { setCameraImageHash } = await import('./cache');

    await setCameraImageHash('custom', 99, 'sha256hex');

    expect(setMock).toHaveBeenCalledWith(
      'camera:hash:custom:99',
      'sha256hex',
      { ex: 60 * 60 * 24 }
    );
  });

  it('getCameraImageHash returns null when Redis is unavailable', async () => {
    delete process.env.KV_REST_API_URL;
    // Force re-import so the cached client is rebuilt without env vars.
    vi.resetModules();
    const { getCameraImageHash } = await import('./cache');
    const result = await getCameraImageHash('windy', 1);
    expect(result).toBeNull();
  });

  it('setCameraImageHash swallows Redis errors (cache is non-fatal)', async () => {
    setMock.mockRejectedValueOnce(new Error('upstash down'));
    const { setCameraImageHash } = await import('./cache');
    await expect(setCameraImageHash('windy', 1, 'h')).resolves.toBeUndefined();
  });
});
