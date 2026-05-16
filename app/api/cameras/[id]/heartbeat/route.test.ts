// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const verifyDeviceTokenMock = vi.fn();
const sqlMock = vi.fn();
const derivePlacementStatusMock = vi.fn();

vi.mock('@/app/lib/cameraAuth', () => ({
  verifyDeviceToken: (...a: unknown[]) => verifyDeviceTokenMock(...a),
}));
vi.mock('@/app/lib/cameraRegistration', () => ({
  derivePlacementStatus: (...a: unknown[]) => derivePlacementStatusMock(...a),
}));
vi.mock('@/app/lib/db', () => ({
  sql: (s: TemplateStringsArray, ...v: unknown[]) => sqlMock(s, ...v),
}));

import { POST } from './route';

beforeEach(() => {
  verifyDeviceTokenMock.mockReset();
  sqlMock.mockReset();
  derivePlacementStatusMock.mockReset();
});

function makeRequest(opts: { id?: string; bearer?: string; body?: unknown }) {
  const headers: HeadersInit = { 'content-type': 'application/json' };
  if (opts.bearer) headers['authorization'] = `Bearer ${opts.bearer}`;
  return new Request(`http://test/api/cameras/${opts.id ?? '42'}/heartbeat`, {
    method: 'POST',
    headers,
    body: JSON.stringify(opts.body ?? { uptime_s: 600 }),
  });
}

function makeContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe('POST /api/cameras/[id]/heartbeat', () => {
  it('rejects unauthenticated requests with 401', async () => {
    verifyDeviceTokenMock.mockResolvedValueOnce(null);
    const res = await POST(
      makeRequest({ id: '42', bearer: 'bad' }),
      makeContext('42')
    );
    expect(res.status).toBe(401);
  });

  it('updates last_heartbeat_at and returns 200 with no placement when not requested', async () => {
    verifyDeviceTokenMock.mockResolvedValueOnce({ id: 42, status: 'active' });
    sqlMock.mockResolvedValueOnce([]); // UPDATE last_heartbeat_at (returns nothing meaningful here)
    const res = await POST(
      makeRequest({ id: '42', bearer: 'good', body: { uptime_s: 600 } }),
      makeContext('42')
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.placement).toBeUndefined();
    expect(body.placement_status).toBeUndefined();
  });

  it('returns placement when device requests it and row is ready', async () => {
    verifyDeviceTokenMock.mockResolvedValueOnce({ id: 42, status: 'active' });
    sqlMock.mockResolvedValueOnce([]); // UPDATE
    sqlMock.mockResolvedValueOnce([
      {
        lat: 47.6,
        lng: -122.3,
        elevation_m: 30,
        timezone: 'America/Los_Angeles',
        azimuth_deg: 270,
        tilt_deg: 5,
        horizon_altitude_deg: 2.5,
        horizon_profile: [{ azimuth_deg: 0, altitude_deg: 1.2 }],
        phase_preference: 'sunset',
        delivery_preferences: null,
      },
    ]);
    derivePlacementStatusMock.mockReturnValueOnce('ready');

    const res = await POST(
      makeRequest({
        id: '42',
        bearer: 'good',
        body: { uptime_s: 600, request_placement: true },
      }),
      makeContext('42')
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.placement_status).toBe('ready');
    expect(body.placement).toMatchObject({ azimuth_deg: 270, tilt_deg: 5 });
  });

  it('returns placement_status=pending without placement when not yet ready', async () => {
    verifyDeviceTokenMock.mockResolvedValueOnce({ id: 42, status: 'active' });
    sqlMock.mockResolvedValueOnce([]); // UPDATE
    sqlMock.mockResolvedValueOnce([
      {
        lat: null,
        lng: null,
        elevation_m: null,
        timezone: null,
        azimuth_deg: null,
        tilt_deg: null,
        horizon_altitude_deg: null,
        horizon_profile: null,
        phase_preference: 'both',
        delivery_preferences: null,
      },
    ]);
    derivePlacementStatusMock.mockReturnValueOnce('pending');

    const res = await POST(
      makeRequest({
        id: '42',
        bearer: 'good',
        body: { uptime_s: 600, request_placement: true },
      }),
      makeContext('42')
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.placement_status).toBe('pending');
    expect(body.placement).toBeUndefined();
  });

  it('returns 400 on invalid camera id', async () => {
    const res = await POST(
      makeRequest({ id: 'abc', bearer: 'good' }),
      makeContext('abc')
    );
    expect(res.status).toBe(400);
  });
});
