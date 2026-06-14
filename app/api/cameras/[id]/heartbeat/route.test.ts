// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const verifyDeviceTokenMock = vi.fn();
const sqlMock = vi.fn();
const derivePlacementStatusMock = vi.fn();
const getActiveDeploymentMock = vi.fn();

vi.mock('@/app/lib/cameraAuth', () => ({
  verifyDeviceToken: (...a: unknown[]) => verifyDeviceTokenMock(...a),
}));
vi.mock('@/app/lib/cameraDeployment', () => ({
  getActiveDeployment: (...a: unknown[]) => getActiveDeploymentMock(...a),
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
  getActiveDeploymentMock.mockReset();
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
    // CTE UPDATE now only returns wifi_wipe_was_requested
    sqlMock.mockResolvedValueOnce([{ wifi_wipe_was_requested: false }]);
    const res = await POST(
      makeRequest({ id: '42', bearer: 'good', body: { uptime_s: 600 } }),
      makeContext('42')
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.placement).toBeUndefined();
    expect(body.placement_status).toBeUndefined();
    // getActiveDeployment should NOT be called when placement not requested
    expect(getActiveDeploymentMock).not.toHaveBeenCalled();
  });

  it('returns placement when device requests it and deployment is ready', async () => {
    verifyDeviceTokenMock.mockResolvedValueOnce({ id: 42, status: 'active' });
    // CTE UPDATE — only wifi_wipe_was_requested
    sqlMock.mockResolvedValueOnce([{ wifi_wipe_was_requested: false }]);
    // getActiveDeployment returns a full deployment
    getActiveDeploymentMock.mockResolvedValueOnce({
      id: 7,
      custom_camera_id: 42,
      state: 'deployed',
      paused: false,
      started_at: new Date(),
      ended_at: null,
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
      azimuth_source: 'sun',
      coarse: false,
      bracket: null,
    });
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
    expect(body.placement.lat).toBe(47.6);
    expect(body.placement.lng).toBe(-122.3);
    expect(getActiveDeploymentMock).toHaveBeenCalledWith(42);
  });

  it('returns placement_status=awaiting_location without placement when getActiveDeployment returns null', async () => {
    verifyDeviceTokenMock.mockResolvedValueOnce({ id: 42, status: 'active' });
    sqlMock.mockResolvedValueOnce([{ wifi_wipe_was_requested: false }]);
    getActiveDeploymentMock.mockResolvedValueOnce(null);
    derivePlacementStatusMock.mockReturnValueOnce('awaiting_location');

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
    expect(body.placement_status).toBe('awaiting_location');
    expect(body.placement).toBeUndefined();
    expect(body.lat).toBeUndefined();
  });

  it('returns lat/lng with awaiting_aim so the device can aim', async () => {
    verifyDeviceTokenMock.mockResolvedValueOnce({ id: 42 });
    sqlMock.mockResolvedValueOnce([{ wifi_wipe_was_requested: false }]);
    getActiveDeploymentMock.mockResolvedValueOnce({
      id: 8,
      custom_camera_id: 42,
      state: 'testing',
      paused: false,
      started_at: new Date(),
      ended_at: null,
      lat: 48.7519,
      lng: -122.4787,
      elevation_m: null,
      timezone: 'America/Los_Angeles',
      azimuth_deg: null,
      tilt_deg: null,
      horizon_altitude_deg: null,
      horizon_profile: null,
      phase_preference: 'sunset',
      delivery_preferences: null,
      azimuth_source: null,
      coarse: null,
      bracket: null,
    });
    derivePlacementStatusMock.mockReturnValueOnce('awaiting_aim');

    const res = await POST(
      makeRequest({ id: '42', bearer: 'good', body: { request_placement: true } }),
      makeContext('42')
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.placement_status).toBe('awaiting_aim');
    expect(json.lat).toBe(48.7519);
    expect(json.lng).toBe(-122.4787);
    expect(json.placement).toBeUndefined();
  });

  it('surfaces a wipe_wifi directive (and the flag was consumed) when relocation was requested', async () => {
    verifyDeviceTokenMock.mockResolvedValueOnce({ id: 42, status: 'decommissioned' });
    // CTE row: wifi_wipe_was_requested = true, no placement columns
    sqlMock.mockResolvedValueOnce([{ wifi_wipe_was_requested: true }]);
    const res = await POST(
      makeRequest({ id: '42', bearer: 'good', body: { uptime_s: 600 } }),
      makeContext('42')
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.directives).toEqual(['wipe_wifi']);
    // The UPDATE must reset the flag so the directive fires only once.
    expect(sqlMock.mock.calls[0][0].join('')).toContain('wifi_wipe_requested = FALSE');
    // getActiveDeployment NOT called (no request_placement)
    expect(getActiveDeploymentMock).not.toHaveBeenCalled();
  });

  it('omits directives when no relocation was requested', async () => {
    verifyDeviceTokenMock.mockResolvedValueOnce({ id: 42, status: 'active' });
    sqlMock.mockResolvedValueOnce([{ wifi_wipe_was_requested: false }]);
    const res = await POST(
      makeRequest({ id: '42', bearer: 'good', body: { uptime_s: 600 } }),
      makeContext('42')
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.directives).toBeUndefined();
  });

  it('returns 404 when the camera row vanished between auth and update', async () => {
    verifyDeviceTokenMock.mockResolvedValueOnce({ id: 42, status: 'active' });
    sqlMock.mockResolvedValueOnce([]); // UPDATE ... RETURNING — 0 rows
    const res = await POST(
      makeRequest({ id: '42', bearer: 'good' }),
      makeContext('42')
    );
    expect(res.status).toBe(404);
  });

  it('returns 400 on invalid camera id', async () => {
    const res = await POST(
      makeRequest({ id: 'abc', bearer: 'good' }),
      makeContext('abc')
    );
    expect(res.status).toBe(400);
  });

  it('wipe_wifi directive + placement requested: both work together', async () => {
    verifyDeviceTokenMock.mockResolvedValueOnce({ id: 42, status: 'active' });
    sqlMock.mockResolvedValueOnce([{ wifi_wipe_was_requested: true }]);
    getActiveDeploymentMock.mockResolvedValueOnce({
      id: 9,
      custom_camera_id: 42,
      state: 'deployed',
      paused: false,
      started_at: new Date(),
      ended_at: null,
      lat: 47.6,
      lng: -122.3,
      elevation_m: 30,
      timezone: 'UTC',
      azimuth_deg: 270,
      tilt_deg: 5,
      horizon_altitude_deg: 2.5,
      horizon_profile: null,
      phase_preference: 'sunset',
      delivery_preferences: null,
      azimuth_source: null,
      coarse: null,
      bracket: null,
    });
    derivePlacementStatusMock.mockReturnValueOnce('ready');

    const res = await POST(
      makeRequest({ id: '42', bearer: 'good', body: { request_placement: true } }),
      makeContext('42')
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.directives).toEqual(['wipe_wifi']);
    expect(body.placement_status).toBe('ready');
    expect(body.placement).toMatchObject({ azimuth_deg: 270 });
  });
});
