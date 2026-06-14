// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getClaimCodeMock = vi.fn();
const sqlMock = vi.fn();
const getActiveDeploymentMock = vi.fn();
const derivePlacementStatusMock = vi.fn();

vi.mock('@/app/lib/cameraClaimCode', () => ({
  getClaimCode: (...a: unknown[]) => getClaimCodeMock(...a),
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
  getClaimCodeMock.mockReset();
  sqlMock.mockReset();
  getActiveDeploymentMock.mockReset();
  derivePlacementStatusMock.mockReset();
});

function makeRequest(body: unknown) {
  return new Request('http://test/api/cameras/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const REGISTER_BODY = {
  claim_code: 'SUNSET-AAAA-BBBB',
  hardware_id: 'rpi-serial-12345',
  capabilities: { mjpeg: false, edge_score: false },
  firmware_version: 'sunset-cam@0.1.0',
};

const VALID_CLAIM = {
  code: 'SUNSET-AAAA-BBBB',
  expires_at: new Date('2099-01-01'),
  consumed_at: new Date('2025-01-01'), // consumed — but that is now normal; should NOT 409
  consumed_by_camera_id: 17,
};

const READY_DEPLOYMENT = {
  id: 5,
  custom_camera_id: 17,
  state: 'deployed',
  paused: false,
  started_at: new Date('2025-06-01'),
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
  delivery_preferences: { type: 'email' },
  azimuth_source: 'phone',
  coarse: false,
  bracket: null,
};

describe('POST /api/cameras/register', () => {
  it('provisioned camera, hardware matches, deployment ready → 200 with placement, no device_token', async () => {
    getClaimCodeMock.mockResolvedValueOnce(VALID_CLAIM);
    // sqlMock #1 — camera resolve SELECT
    sqlMock.mockResolvedValueOnce([{ id: 17, hardware_id: 'rpi-serial-12345' }]);
    // sqlMock #2 — UPDATE cameras
    sqlMock.mockResolvedValueOnce([{ id: 17 }]);
    getActiveDeploymentMock.mockResolvedValueOnce(READY_DEPLOYMENT);
    derivePlacementStatusMock.mockReturnValueOnce('ready');

    const res = await POST(makeRequest(REGISTER_BODY));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.camera_id).toBe(17);
    expect(body.placement_status).toBe('ready');
    expect(body.placement).toBeDefined();
    expect(body.placement).toMatchObject({ azimuth_deg: 270, tilt_deg: 5 });
    // No device_token — provisioning issued it; register must NOT return one
    expect(body.device_token).toBeUndefined();
  });

  it('provisioned camera, hardware matches, no deployment → 200 awaiting_location, no placement', async () => {
    getClaimCodeMock.mockResolvedValueOnce(VALID_CLAIM);
    sqlMock.mockResolvedValueOnce([{ id: 17, hardware_id: 'rpi-serial-12345' }]);
    sqlMock.mockResolvedValueOnce([{ id: 17 }]);
    getActiveDeploymentMock.mockResolvedValueOnce(null);
    derivePlacementStatusMock.mockReturnValueOnce('awaiting_location');

    const res = await POST(makeRequest(REGISTER_BODY));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.camera_id).toBe(17);
    expect(body.placement_status).toBe('awaiting_location');
    expect(body.placement).toBeUndefined();
    expect(body.device_token).toBeUndefined();
  });

  it('unknown claim code → 404', async () => {
    getClaimCodeMock.mockResolvedValueOnce(null);
    const res = await POST(makeRequest(REGISTER_BODY));
    expect(res.status).toBe(404);
  });

  it('expired claim code → 410', async () => {
    getClaimCodeMock.mockResolvedValueOnce({
      code: 'SUNSET-AAAA-BBBB',
      expires_at: new Date('2020-01-01'),
      consumed_at: null,
      consumed_by_camera_id: null,
    });
    const res = await POST(makeRequest(REGISTER_BODY));
    expect(res.status).toBe(410);
  });

  it('camera not provisioned (no cameras row for claim code) → 404', async () => {
    getClaimCodeMock.mockResolvedValueOnce(VALID_CLAIM);
    // sqlMock #1 — camera resolve returns empty
    sqlMock.mockResolvedValueOnce([]);

    const res = await POST(makeRequest(REGISTER_BODY));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/not provisioned/);
  });

  it('hardware_id mismatch → 409 with existing_camera_id', async () => {
    getClaimCodeMock.mockResolvedValueOnce(VALID_CLAIM);
    // Camera resolve finds row with a different hardware_id
    sqlMock.mockResolvedValueOnce([{ id: 99, hardware_id: 'other' }]);

    const res = await POST(makeRequest(REGISTER_BODY)); // request has 'rpi-serial-12345'
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.existing_camera_id).toBe(99);
  });

  it('missing hardware_id → 400', async () => {
    const res = await POST(makeRequest({ ...REGISTER_BODY, hardware_id: '' }));
    expect(res.status).toBe(400);
  });

  it('includes bracket fields in ready placement block', async () => {
    getClaimCodeMock.mockResolvedValueOnce(VALID_CLAIM);
    sqlMock.mockResolvedValueOnce([{ id: 17, hardware_id: 'rpi-serial-12345' }]);
    sqlMock.mockResolvedValueOnce([{ id: 17 }]);
    const bracketDeployment = {
      ...READY_DEPLOYMENT,
      azimuth_source: 'bracket',
      coarse: true,
      bracket: { wedge_angle_deg: 5, lens: 'wide_120' },
    };
    getActiveDeploymentMock.mockResolvedValueOnce(bracketDeployment);
    derivePlacementStatusMock.mockReturnValueOnce('ready');

    const res = await POST(makeRequest(REGISTER_BODY));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.placement_status).toBe('ready');
    expect(body.placement.azimuth_source).toBe('bracket');
    expect(body.placement.coarse).toBe(true);
    expect(body.placement.bracket).toEqual({ wedge_angle_deg: 5, lens: 'wide_120' });
    expect(body.device_token).toBeUndefined();
  });
});
