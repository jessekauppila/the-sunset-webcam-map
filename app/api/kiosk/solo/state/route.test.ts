// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const requireOwner = vi.fn();
const listActiveEntries = vi.fn();
const getScreenState = vi.fn();
const countAdmittedSince = vi.fn();
const getLiveSettingsCached = vi.fn();
const getProfileSettings = vi.fn();
const getSweptZone = vi.fn();
vi.mock('server-only', () => ({}));
// sweepGeometry's module pulls in the Neon client; the route only uses its pure half.
vi.mock('@/app/lib/db', () => ({ sql: vi.fn() }));
vi.mock('@/app/lib/runtimeFlags', () => ({ isFlagEnabled: async () => false, SWEEP_FORCE_DAY_RING: 'x' }));
vi.mock('@/app/lib/owner', () => ({ requireOwner: () => requireOwner() }));
vi.mock('@/app/lib/solo/store', () => ({
  listActiveEntries: (...a: unknown[]) => listActiveEntries(...a),
  getScreenState: (...a: unknown[]) => getScreenState(...a),
  countAdmittedSince: (...a: unknown[]) => countAdmittedSince(...a),
  getSweptZone: (...a: unknown[]) => getSweptZone(...a),
}));
vi.mock('@/app/lib/settings/liveSettings', () => ({ getLiveSettingsCached: () => getLiveSettingsCached() }));
vi.mock('@/app/lib/settings/store', () => ({ getProfileSettings: (p: string) => getProfileSettings(p) }));

import { GET } from './route';

const get = (qs: string) => GET(new NextRequest(`http://t/api/kiosk/solo/state${qs}`));

beforeEach(() => {
  vi.clearAllMocks();
  requireOwner.mockResolvedValue(null);
  listActiveEntries.mockResolvedValue([]);
  getScreenState.mockResolvedValue(null);
  countAdmittedSince.mockResolvedValue({ sunset: 0, nonSunset: 0 });
  getSweptZone.mockResolvedValue(null);
  getLiveSettingsCached.mockResolvedValue({ namespaces: { solo: { dwellS: 30 } }, revision: 1 });
  getProfileSettings.mockResolvedValue({ namespaces: { solo: { dwellS: 7 } }, revision: 1 });
});

describe('GET /api/kiosk/solo/state', () => {
  it('shows the zone the cron last aged entries against', async () => {
    getSweptZone.mockResolvedValue({ minDeg: -39.75, maxDeg: 13.75 });
    const body = await (await get('?feed=sunrise')).json();
    expect(body.zone).toEqual({ minDeg: -39.75, maxDeg: 13.75 });
  });
  it('rejects a missing or unknown feed', async () => {
    expect((await get('')).status).toBe(400);
    expect((await get('?feed=noon')).status).toBe(400);
  });
  it('live profile by default, no owner check; guaranteed-rings zone until the cron has recorded one', async () => {
    const res = await get('?feed=sunset');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.dials.dwellS).toBe(30);
    expect(body.zone).toEqual({ minDeg: -24, maxDeg: -2 });
    expect(requireOwner).not.toHaveBeenCalled();
  });
  it('studio profile is owner-gated and projects with studio dials', async () => {
    requireOwner.mockResolvedValue(NextResponse.json({ error: 'no' }, { status: 403 }));
    expect((await get('?feed=sunset&profile=studio')).status).toBe(403);
    requireOwner.mockResolvedValue(null);
    const res = await get('?feed=sunset&profile=studio');
    expect((await res.json()).dials.dwellS).toBe(7);
    expect(getProfileSettings).toHaveBeenCalledWith('studio');
  });
});
