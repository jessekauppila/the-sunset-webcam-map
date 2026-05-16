// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getClaimCodeMock = vi.fn();
const upsertCameraByClaimCodeMock = vi.fn();
const derivePlacementStatusMock = vi.fn();
vi.mock('@/app/lib/cameraClaimCode', () => ({
  getClaimCode: (...args: unknown[]) => getClaimCodeMock(...args),
}));
vi.mock('@/app/lib/cameraRegistration', () => ({
  upsertCameraByClaimCode: (...args: unknown[]) => upsertCameraByClaimCodeMock(...args),
  derivePlacementStatus: (...args: unknown[]) => derivePlacementStatusMock(...args),
}));

import { POST } from './route';

beforeEach(() => {
  getClaimCodeMock.mockReset();
  upsertCameraByClaimCodeMock.mockReset();
  derivePlacementStatusMock.mockReset();
});

const VALID_BODY = {
  claim_code: 'SUNSET-AAAA-BBBB',
  lat: 47.6062,
  lng: -122.3321,
  elevation_m: 30,
  timezone: 'America/Los_Angeles',
  placement: {
    azimuth_deg: 270,
    tilt_deg: 5,
    horizon_altitude_deg: 2.5,
    horizon_profile: [{ azimuth_deg: 0, altitude_deg: 1.2 }],
  },
  operator_preferences: {
    phase_preference: 'sunset',
    delivery: { type: 'email', target: 'op@example.com', cadence: 'daily' },
  },
};

function makeRequest(body: unknown) {
  return new Request('http://test/api/cameras/pre-register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/cameras/pre-register', () => {
  it('accepts a valid pre-register call and calls upsert', async () => {
    getClaimCodeMock.mockResolvedValueOnce({
      code: 'SUNSET-AAAA-BBBB',
      expires_at: new Date('2099-01-01'),
      consumed_at: null,
      consumed_by_camera_id: null,
    });
    upsertCameraByClaimCodeMock.mockResolvedValueOnce({
      id: 17,
      claim_code: 'SUNSET-AAAA-BBBB',
      lat: 47.6062,
      lng: -122.3321,
      azimuth_deg: 270,
      tilt_deg: 5,
    });
    derivePlacementStatusMock.mockReturnValueOnce('ready');

    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.camera_id).toBe(17);
    expect(body.placement_status).toBe('ready');
    expect(upsertCameraByClaimCodeMock).toHaveBeenCalledOnce();
  });

  it('rejects when claim code is unknown', async () => {
    getClaimCodeMock.mockResolvedValueOnce(null);
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(404);
    expect(upsertCameraByClaimCodeMock).not.toHaveBeenCalled();
  });

  it('rejects when claim code is expired', async () => {
    getClaimCodeMock.mockResolvedValueOnce({
      code: 'SUNSET-AAAA-BBBB',
      expires_at: new Date('2020-01-01'),
      consumed_at: null,
      consumed_by_camera_id: null,
    });
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(410);
    expect(upsertCameraByClaimCodeMock).not.toHaveBeenCalled();
  });

  it('accepts when the device has already registered (either-order)', async () => {
    getClaimCodeMock.mockResolvedValueOnce({
      code: 'SUNSET-AAAA-BBBB',
      expires_at: new Date('2099-01-01'),
      consumed_at: new Date(),
      consumed_by_camera_id: 17,
    });
    upsertCameraByClaimCodeMock.mockResolvedValueOnce({
      id: 17,
      claim_code: 'SUNSET-AAAA-BBBB',
      lat: 47.6062,
      lng: -122.3321,
      azimuth_deg: 270,
      tilt_deg: 5,
    });
    derivePlacementStatusMock.mockReturnValueOnce('ready');

    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(202);
    expect(upsertCameraByClaimCodeMock).toHaveBeenCalledOnce();
  });

  it('rejects when required fields are missing', async () => {
    getClaimCodeMock.mockResolvedValueOnce({
      code: 'SUNSET-AAAA-BBBB',
      expires_at: new Date('2099-01-01'),
      consumed_at: null,
      consumed_by_camera_id: null,
    });
    const bad = { ...VALID_BODY, lat: undefined };
    const res = await POST(makeRequest(bad));
    expect(res.status).toBe(400);
    expect(upsertCameraByClaimCodeMock).not.toHaveBeenCalled();
  });

  it('returns 400 on malformed JSON body', async () => {
    const req = new Request('http://test/api/cameras/pre-register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not-json',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
