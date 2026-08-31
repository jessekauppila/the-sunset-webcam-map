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

describe('kiosk helpers', () => {
  it('acquireKioskTickLock passes NX+PX and reports acquisition', async () => {
    setMock.mockResolvedValueOnce('OK');
    const { acquireKioskTickLock } = await import('./cache');
    await expect(acquireKioskTickLock()).resolves.toBe(true);
    expect(setMock).toHaveBeenCalledWith(
      'kiosk:tick:lock',
      '1',
      expect.objectContaining({ nx: true, px: 55000 }),
    );
  });

  it('acquireKioskTickLock returns false when the lock is held', async () => {
    setMock.mockResolvedValueOnce(null); // upstash returns null when NX fails
    const { acquireKioskTickLock } = await import('./cache');
    await expect(acquireKioskTickLock()).resolves.toBe(false);
  });

  it('markKioskTickRan sets the lock without NX', async () => {
    const { markKioskTickRan } = await import('./cache');
    await markKioskTickRan();
    expect(setMock).toHaveBeenCalledWith(
      'kiosk:tick:lock',
      '1',
      expect.objectContaining({ px: 55000 }),
    );
    expect(setMock.mock.calls.at(-1)![2]).not.toHaveProperty('nx');
  });

  it('doze flag round-trips', async () => {
    const { setKioskDoze, getKioskDoze } = await import('./cache');
    await setKioskDoze(true);
    expect(setMock).toHaveBeenCalledWith('kiosk:doze', '1');
    getMock.mockResolvedValueOnce('1');
    await expect(getKioskDoze()).resolves.toBe(true);
    await setKioskDoze(false);
    expect(delMock).toHaveBeenCalledWith('kiosk:doze');
    getMock.mockResolvedValueOnce(null);
    await expect(getKioskDoze()).resolves.toBe(false);
  });
});

describe('kiosk live settings cache', () => {
  it('round-trips a ProfileSettings object through kiosk:liveSettings', async () => {
    const { setKioskLiveSettingsCache, getKioskLiveSettingsCache } = await import('./cache');
    await setKioskLiveSettingsCache({ namespaces: { v1: { floorPx: 140 } }, revision: 15 });
    expect(setMock).toHaveBeenCalledWith(
      'kiosk:liveSettings',
      expect.anything(),
    );
    getMock.mockResolvedValueOnce(setMock.mock.calls[0][1]);
    await expect(getKioskLiveSettingsCache()).resolves.toEqual({
      namespaces: { v1: { floorPx: 140 } },
      revision: 15,
    });
  });

  it('returns null on a cache miss', async () => {
    const { getKioskLiveSettingsCache } = await import('./cache');
    getMock.mockResolvedValueOnce(null);
    await expect(getKioskLiveSettingsCache()).resolves.toBeNull();
  });

  it('fails soft to null when redis rejects, so a cache outage never breaks the kiosk', async () => {
    const { getKioskLiveSettingsCache } = await import('./cache');
    getMock.mockRejectedValueOnce(new Error('down'));
    await expect(getKioskLiveSettingsCache()).resolves.toBeNull();
  });

  it('setKioskLiveSettingsCache swallows Redis errors (fire-and-forget safe)', async () => {
    const { setKioskLiveSettingsCache } = await import('./cache');
    setMock.mockRejectedValueOnce(new Error('down'));
    await expect(
      setKioskLiveSettingsCache({ namespaces: {}, revision: 1 }),
    ).resolves.toBeUndefined();
  });

  it('markKioskPoll stores an ISO timestamp readable by getKioskLastPoll', async () => {
    const { markKioskPoll } = await import('./cache');
    await markKioskPoll();
    const written = setMock.mock.calls.at(-1)!;
    expect(written[0]).toBe('kiosk:lastPoll');
    expect(new Date(String(written[1])).toISOString()).toBe(String(written[1]));
  });

  it('getKioskLastPoll returns the stored timestamp, or null on miss/failure', async () => {
    const { getKioskLastPoll } = await import('./cache');
    getMock.mockResolvedValueOnce('2026-08-30T00:00:00.000Z');
    await expect(getKioskLastPoll()).resolves.toBe('2026-08-30T00:00:00.000Z');
    getMock.mockResolvedValueOnce(null);
    await expect(getKioskLastPoll()).resolves.toBeNull();
    getMock.mockRejectedValueOnce(new Error('down'));
    await expect(getKioskLastPoll()).resolves.toBeNull();
  });
});
