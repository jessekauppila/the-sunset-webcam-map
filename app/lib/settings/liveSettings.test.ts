// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getKioskLiveSettingsCacheMock = vi.fn();
const setKioskLiveSettingsCacheMock = vi.fn();
vi.mock('@/app/lib/cache', () => ({
  getKioskLiveSettingsCache: () => getKioskLiveSettingsCacheMock(),
  setKioskLiveSettingsCache: (s: unknown) => setKioskLiveSettingsCacheMock(s),
}));

const getProfileSettingsMock = vi.fn();
vi.mock('@/app/lib/settings/store', () => ({
  getProfileSettings: (p: unknown) => getProfileSettingsMock(p),
}));

import { getLiveSettingsCached } from './liveSettings';

describe('getLiveSettingsCached', () => {
  beforeEach(() => {
    getKioskLiveSettingsCacheMock.mockReset();
    setKioskLiveSettingsCacheMock.mockReset();
    getProfileSettingsMock.mockReset();
  });

  it('returns the cached value without touching the store on a cache hit', async () => {
    const cached = { namespaces: { v1: { floorPx: 150 } }, revision: 2 };
    getKioskLiveSettingsCacheMock.mockResolvedValueOnce(cached);

    expect(await getLiveSettingsCached()).toEqual(cached);
    expect(getProfileSettingsMock).not.toHaveBeenCalled();
    expect(setKioskLiveSettingsCacheMock).not.toHaveBeenCalled();
  });

  it('reads the store once and re-warms the cache on a miss', async () => {
    const fromStore = { namespaces: { v1: { floorPx: 150 } }, revision: 3 };
    getKioskLiveSettingsCacheMock.mockResolvedValueOnce(null);
    getProfileSettingsMock.mockResolvedValueOnce(fromStore);

    expect(await getLiveSettingsCached()).toEqual(fromStore);
    expect(getProfileSettingsMock).toHaveBeenCalledTimes(1);
    expect(getProfileSettingsMock).toHaveBeenCalledWith('live');
    expect(setKioskLiveSettingsCacheMock).toHaveBeenCalledWith(fromStore);
  });

  it('returns null without throwing when both the cache and the store fail', async () => {
    getKioskLiveSettingsCacheMock.mockResolvedValueOnce(null);
    getProfileSettingsMock.mockRejectedValueOnce(new Error('neon down'));

    await expect(getLiveSettingsCached()).resolves.toBeNull();
    expect(setKioskLiveSettingsCacheMock).not.toHaveBeenCalled();
  });
});
