// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getKioskDozeMock = vi.fn();
const markKioskPollMock = vi.fn();
vi.mock('@/app/lib/cache', () => ({
  getKioskDoze: () => getKioskDozeMock(),
  markKioskPoll: () => markKioskPollMock(),
}));

const getLiveSettingsCachedMock = vi.fn();
vi.mock('@/app/lib/settings/liveSettings', () => ({
  getLiveSettingsCached: () => getLiveSettingsCachedMock(),
}));

import { GET } from './route';

describe('GET /api/kiosk/state', () => {
  beforeEach(() => {
    getKioskDozeMock.mockReset();
    markKioskPollMock.mockReset();
    getLiveSettingsCachedMock.mockReset();
    markKioskPollMock.mockResolvedValue(undefined);
  });

  it('returns the doze flag and live settings', async () => {
    const settings = { namespaces: { v1: { floorPx: 150 } }, revision: 2 };
    getKioskDozeMock.mockResolvedValueOnce(true);
    getLiveSettingsCachedMock.mockResolvedValueOnce(settings);

    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ doze: true, settings });
  });

  it('fires markKioskPoll without awaiting it', async () => {
    getKioskDozeMock.mockResolvedValueOnce(false);
    getLiveSettingsCachedMock.mockResolvedValueOnce(null);

    await GET();

    expect(markKioskPollMock).toHaveBeenCalledTimes(1);
  });

  it('returns settings: null when the settings fetch fails to resolve a value', async () => {
    getKioskDozeMock.mockResolvedValueOnce(false);
    getLiveSettingsCachedMock.mockResolvedValueOnce(null);

    const res = await GET();

    expect(await res.json()).toEqual({ doze: false, settings: null });
  });
});
