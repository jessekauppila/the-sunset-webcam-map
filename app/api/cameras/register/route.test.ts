// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getClaimCodeMock = vi.fn();
const consumeClaimCodeMock = vi.fn();
const sqlMock = vi.fn();
const mintDeviceTokenMock = vi.fn();
const derivePlacementStatusMock = vi.fn();

vi.mock('@/app/lib/cameraClaimCode', () => ({
  getClaimCode: (...a: unknown[]) => getClaimCodeMock(...a),
  consumeClaimCode: (...a: unknown[]) => consumeClaimCodeMock(...a),
}));
vi.mock('@/app/lib/cameraRegistration', () => ({
  mintDeviceToken: (...a: unknown[]) => mintDeviceTokenMock(...a),
  derivePlacementStatus: (...a: unknown[]) => derivePlacementStatusMock(...a),
}));
vi.mock('@/app/lib/db', () => ({
  sql: (s: TemplateStringsArray, ...v: unknown[]) => sqlMock(s, ...v),
}));

import { POST } from './route';

beforeEach(() => {
  getClaimCodeMock.mockReset();
  consumeClaimCodeMock.mockReset();
  sqlMock.mockReset();
  mintDeviceTokenMock.mockReset();
  derivePlacementStatusMock.mockReset();
  mintDeviceTokenMock.mockReturnValue({
    plaintext: 'plain-token-abc',
    hash: 'hash-abc',
  });
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

describe('POST /api/cameras/register', () => {
  it('returns placement=ready when pre-register populated placement first', async () => {
    getClaimCodeMock.mockResolvedValueOnce({
      code: 'SUNSET-AAAA-BBBB',
      expires_at: new Date('2099-01-01'),
      consumed_at: null,
      consumed_by_camera_id: null,
    });
    // SELECT existing camera by claim_code → found (pre-register created it)
    sqlMock.mockResolvedValueOnce([
      {
        id: 17,
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
      },
    ]);
    // UPDATE cameras: fill in hardware_id, device_token_hash, capabilities
    sqlMock.mockResolvedValueOnce([{ id: 17 }]);
    consumeClaimCodeMock.mockResolvedValueOnce({ consumed_by_camera_id: 17 });
    derivePlacementStatusMock.mockReturnValueOnce('ready');

    const res = await POST(makeRequest(REGISTER_BODY));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.camera_id).toBe(17);
    expect(body.device_token).toBe('plain-token-abc');
    expect(body.placement_status).toBe('ready');
    expect(body.placement).toMatchObject({
      azimuth_deg: 270,
      tilt_deg: 5,
    });
  });

  it('returns placement=pending when device registers first (no prior pre-register)', async () => {
    getClaimCodeMock.mockResolvedValueOnce({
      code: 'SUNSET-AAAA-BBBB',
      expires_at: new Date('2099-01-01'),
      consumed_at: null,
      consumed_by_camera_id: null,
    });
    // SELECT existing camera by claim_code → none
    sqlMock.mockResolvedValueOnce([]);
    // SELECT cameras by hardware_id (collision check) → none
    sqlMock.mockResolvedValueOnce([]);
    // INSERT cameras with sentinel placement
    sqlMock.mockResolvedValueOnce([{ id: 18 }]);
    consumeClaimCodeMock.mockResolvedValueOnce({ consumed_by_camera_id: 18 });
    derivePlacementStatusMock.mockReturnValueOnce('pending');

    const res = await POST(makeRequest(REGISTER_BODY));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.camera_id).toBe(18);
    expect(body.device_token).toBe('plain-token-abc');
    expect(body.placement_status).toBe('pending');
    expect(body.placement).toBeUndefined();
  });

  it('rejects unknown claim codes with 404', async () => {
    getClaimCodeMock.mockResolvedValueOnce(null);
    const res = await POST(makeRequest(REGISTER_BODY));
    expect(res.status).toBe(404);
  });

  it('rejects expired claim codes with 410', async () => {
    getClaimCodeMock.mockResolvedValueOnce({
      code: 'SUNSET-AAAA-BBBB',
      expires_at: new Date('2020-01-01'),
      consumed_at: null,
      consumed_by_camera_id: null,
    });
    const res = await POST(makeRequest(REGISTER_BODY));
    expect(res.status).toBe(410);
  });

  it('rejects already-consumed claim codes with 409', async () => {
    getClaimCodeMock.mockResolvedValueOnce({
      code: 'SUNSET-AAAA-BBBB',
      expires_at: new Date('2099-01-01'),
      consumed_at: new Date(),
      consumed_by_camera_id: 1,
    });
    const res = await POST(makeRequest(REGISTER_BODY));
    expect(res.status).toBe(409);
  });

  it('rejects missing hardware_id with 400', async () => {
    getClaimCodeMock.mockResolvedValueOnce({
      code: 'SUNSET-AAAA-BBBB',
      expires_at: new Date('2099-01-01'),
      consumed_at: null,
      consumed_by_camera_id: null,
    });
    const res = await POST(makeRequest({ ...REGISTER_BODY, hardware_id: '' }));
    expect(res.status).toBe(400);
  });

  it('returns 409 with existing_camera_id when hardware_id is already registered', async () => {
    getClaimCodeMock.mockResolvedValueOnce({
      code: 'SUNSET-AAAA-BBBB',
      expires_at: new Date('2099-01-01'),
      consumed_at: null,
      consumed_by_camera_id: null,
    });
    // SELECT existing camera by claim_code → none (register-first path)
    sqlMock.mockResolvedValueOnce([]);
    // NEW: SELECT cameras by hardware_id → found
    sqlMock.mockResolvedValueOnce([{ id: 99 }]);

    const res = await POST(makeRequest(REGISTER_BODY));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.existing_camera_id).toBe(99);
    // Should NOT have called consumeClaimCode
    expect(consumeClaimCodeMock).not.toHaveBeenCalled();
  });

  it('returns 500 when consumeClaimCode races and returns null', async () => {
    getClaimCodeMock.mockResolvedValueOnce({
      code: 'SUNSET-AAAA-BBBB',
      expires_at: new Date('2099-01-01'),
      consumed_at: null,
      consumed_by_camera_id: null,
    });
    // SELECT existing camera → none (register-first path)
    sqlMock.mockResolvedValueOnce([]);
    // SELECT cameras by hardware_id (collision check) → none
    sqlMock.mockResolvedValueOnce([]);
    // INSERT succeeds
    sqlMock.mockResolvedValueOnce([{ id: 19 }]);
    // consumeClaimCode races: returns null instead of the row
    consumeClaimCodeMock.mockResolvedValueOnce(null);

    const res = await POST(makeRequest(REGISTER_BODY));
    expect(res.status).toBe(500);
  });
});
