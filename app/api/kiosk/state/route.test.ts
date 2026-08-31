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

import { NextRequest } from 'next/server';
import { GET } from './route';

function request(url: string) {
  return new NextRequest(new URL(url, 'https://example.com'));
}

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

    const res = await GET(request('/api/kiosk/state?kiosk=1'));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ doze: true, settings });
  });

  it('marks poll freshness when the request carries ?kiosk=1', async () => {
    getKioskDozeMock.mockResolvedValueOnce(false);
    getLiveSettingsCachedMock.mockResolvedValueOnce(null);

    await GET(request('/api/kiosk/state?kiosk=1'));

    expect(markKioskPollMock).toHaveBeenCalledTimes(1);
  });

  it('does not mark poll freshness for a plain request (e.g. the Ops drawer DozeControl)', async () => {
    getKioskDozeMock.mockResolvedValueOnce(false);
    getLiveSettingsCachedMock.mockResolvedValueOnce(null);

    await GET(request('/api/kiosk/state'));

    expect(markKioskPollMock).not.toHaveBeenCalled();
  });

  it('returns settings: null when the settings fetch fails to resolve a value', async () => {
    getKioskDozeMock.mockResolvedValueOnce(false);
    getLiveSettingsCachedMock.mockResolvedValueOnce(null);

    const res = await GET(request('/api/kiosk/state'));

    expect(await res.json()).toEqual({ doze: false, settings: null });
  });
});
