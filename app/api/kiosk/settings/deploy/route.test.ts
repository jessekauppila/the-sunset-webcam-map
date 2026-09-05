// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

const requireOwnerMock = vi.fn();
vi.mock('@/app/lib/owner', () => ({
  requireOwner: (...a: unknown[]) => requireOwnerMock(...a),
}));

const copyProfileMock = vi.fn();
vi.mock('@/app/lib/settings/store', () => ({
  copyProfile: (f: unknown, t: unknown) => copyProfileMock(f, t),
}));

const recordDeployMock = vi.fn();
vi.mock('@/app/lib/settings/deploys', () => ({
  recordDeploy: (live: unknown, label: unknown) => recordDeployMock(live, label),
}));

const setKioskLiveSettingsCacheMock = vi.fn();
vi.mock('@/app/lib/cache', () => ({
  setKioskLiveSettingsCache: (s: unknown) => setKioskLiveSettingsCacheMock(s),
}));

import { POST } from './route';

function reqPost(): Request {
  return new Request('http://test/api/kiosk/settings/deploy', {
    method: 'POST',
  });
}

describe('POST /api/kiosk/settings/deploy', () => {
  beforeEach(() => {
    requireOwnerMock.mockReset();
    copyProfileMock.mockReset();
    setKioskLiveSettingsCacheMock.mockReset();
    recordDeployMock.mockReset();
  });

  it('rejects non-owners', async () => {
    requireOwnerMock.mockResolvedValueOnce(
      NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    );
    const res = await POST(reqPost());
    expect(res.status).toBe(403);
    expect(copyProfileMock).not.toHaveBeenCalled();
    expect(setKioskLiveSettingsCacheMock).not.toHaveBeenCalled();
  });

  it('copies studio to live and sets cache', async () => {
    const liveSettings = {
      namespaces: { v1: { floorPx: 150 } },
      revision: 1,
    };
    requireOwnerMock.mockResolvedValueOnce(null);
    copyProfileMock.mockResolvedValueOnce(liveSettings);
    recordDeployMock.mockResolvedValueOnce(null);

    const res = await POST(reqPost());
    expect(res.status).toBe(200);
    expect(copyProfileMock).toHaveBeenCalledWith('studio', 'live');
    expect(setKioskLiveSettingsCacheMock).toHaveBeenCalledWith(liveSettings);
    const body = await res.json();
    expect(body).toEqual({ live: liveSettings, deploy: null });
  });

  it('records the copied profile and returns the deploy row', async () => {
    requireOwnerMock.mockResolvedValueOnce(null);
    const live = { namespaces: { v1: { floorPx: 140 } }, revision: 4 };
    copyProfileMock.mockResolvedValueOnce(live);
    recordDeployMock.mockResolvedValueOnce({ id: 7, label: 'opening night', namespaces: live.namespaces, deployedAt: 'T' });
    const res = await POST(new Request('http://test/api/kiosk/settings/deploy', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ label: 'opening night' }),
    }));
    expect(res.status).toBe(200);
    expect(recordDeployMock).toHaveBeenCalledWith(live, 'opening night');
    expect(await res.json()).toEqual({
      live, deploy: { id: 7, label: 'opening night', namespaces: live.namespaces, deployedAt: 'T' },
    });
  });

  it('a bodiless POST still deploys, with no label, and a failed record comes back as null', async () => {
    requireOwnerMock.mockResolvedValueOnce(null);
    const live = { namespaces: {}, revision: 5 };
    copyProfileMock.mockResolvedValueOnce(live);
    recordDeployMock.mockResolvedValueOnce(null);
    const res = await POST(reqPost());
    expect(recordDeployMock).toHaveBeenCalledWith(live, null);
    expect(await res.json()).toEqual({ live, deploy: null });
  });

  it('clips a label to 60 characters', async () => {
    requireOwnerMock.mockResolvedValueOnce(null);
    copyProfileMock.mockResolvedValueOnce({ namespaces: {}, revision: 6 });
    recordDeployMock.mockResolvedValueOnce(null);
    await POST(new Request('http://test/x', { method: 'POST', body: JSON.stringify({ label: 'x'.repeat(80) }) }));
    expect(recordDeployMock.mock.calls[0][1]).toHaveLength(60);
  });
});
