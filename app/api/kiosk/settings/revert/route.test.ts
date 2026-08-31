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

const setKioskLiveSettingsCacheMock = vi.fn();
vi.mock('@/app/lib/cache', () => ({
  setKioskLiveSettingsCache: (s: unknown) => setKioskLiveSettingsCacheMock(s),
}));

import { POST } from './route';

function reqPost(): Request {
  return new Request('http://test/api/kiosk/settings/revert', {
    method: 'POST',
  });
}

describe('POST /api/kiosk/settings/revert', () => {
  beforeEach(() => {
    requireOwnerMock.mockReset();
    copyProfileMock.mockReset();
    setKioskLiveSettingsCacheMock.mockReset();
  });

  it('rejects non-owners', async () => {
    requireOwnerMock.mockResolvedValueOnce(
      NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    );
    const res = await POST();
    expect(res.status).toBe(403);
    expect(copyProfileMock).not.toHaveBeenCalled();
    expect(setKioskLiveSettingsCacheMock).not.toHaveBeenCalled();
  });

  it('copies live to studio and does not set cache', async () => {
    const studioSettings = {
      namespaces: { v1: { floorPx: 100 } },
      revision: 0,
    };
    requireOwnerMock.mockResolvedValueOnce(null);
    copyProfileMock.mockResolvedValueOnce(studioSettings);

    const res = await POST(reqPost());
    expect(res.status).toBe(200);
    expect(copyProfileMock).toHaveBeenCalledWith('live', 'studio');
    expect(setKioskLiveSettingsCacheMock).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body).toEqual({ studio: studioSettings });
  });
});
