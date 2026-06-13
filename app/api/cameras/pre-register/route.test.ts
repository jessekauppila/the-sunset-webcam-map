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
  PHASE_VALUES: ['sunrise', 'sunset', 'both'],
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

  it('rejects when horizon_profile is not an array', async () => {
    getClaimCodeMock.mockResolvedValueOnce({
      code: 'SUNSET-AAAA-BBBB',
      expires_at: new Date('2099-01-01'),
      consumed_at: null,
      consumed_by_camera_id: null,
    });
    const bad = {
      ...VALID_BODY,
      placement: { ...VALID_BODY.placement, horizon_profile: 'not an array' },
    };
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

const BRACKET_BODY = {
  ...VALID_BODY,
  placement: {
    azimuth_deg: 272.3,
    tilt_deg: 0,
    horizon_altitude_deg: 0,
    horizon_profile: null,
    azimuth_source: 'bracket',
    coarse: true,
    bracket: {
      window_normal_az_true: 277.3,
      window_azimuth_offset_deg: 7.3,
      window_offset_side: 'south',
      wedge_angle_deg: 5,
      flip_direction: 'south',
      residual_aim_error_deg: 2.3,
      lens: 'wide_120',
      material_thickness_mm: 3.0,
    },
  },
};

describe('POST /api/cameras/pre-register (bracket provenance)', () => {
  it('accepts a bracket payload and forwards provenance to upsert', async () => {
    getClaimCodeMock.mockResolvedValueOnce({
      code: 'SUNSET-AAAA-BBBB', expires_at: new Date('2099-01-01'),
      consumed_at: null, consumed_by_camera_id: null,
    });
    upsertCameraByClaimCodeMock.mockResolvedValueOnce({
      id: 31, claim_code: 'SUNSET-AAAA-BBBB', lat: 47.6, lng: -122.3, azimuth_deg: 272.3, tilt_deg: 0,
    });
    derivePlacementStatusMock.mockReturnValueOnce('ready');

    const res = await POST(makeRequest(BRACKET_BODY));
    expect(res.status).toBe(202);
    const arg = upsertCameraByClaimCodeMock.mock.calls[0][1];
    expect(arg.azimuth_source).toBe('bracket');
    expect(arg.coarse).toBe(true);
    expect(arg.bracket.lens).toBe('wide_120');
    expect(arg.bracket.wedge_angle_deg).toBe(5);
  });

  it('rejects an invalid lens', async () => {
    getClaimCodeMock.mockResolvedValueOnce({
      code: 'SUNSET-AAAA-BBBB', expires_at: new Date('2099-01-01'),
      consumed_at: null, consumed_by_camera_id: null,
    });
    const bad = {
      ...BRACKET_BODY,
      placement: { ...BRACKET_BODY.placement, bracket: { ...BRACKET_BODY.placement.bracket, lens: 'fisheye' } },
    };
    const res = await POST(makeRequest(bad));
    expect(res.status).toBe(400);
    expect(upsertCameraByClaimCodeMock).not.toHaveBeenCalled();
  });

  it('rejects an invalid window_offset_side', async () => {
    getClaimCodeMock.mockResolvedValueOnce({
      code: 'SUNSET-AAAA-BBBB', expires_at: new Date('2099-01-01'),
      consumed_at: null, consumed_by_camera_id: null,
    });
    const bad = {
      ...BRACKET_BODY,
      placement: { ...BRACKET_BODY.placement, bracket: { ...BRACKET_BODY.placement.bracket, window_offset_side: 'sideways' } },
    };
    const res = await POST(makeRequest(bad));
    expect(res.status).toBe(400);
  });

  it('still accepts a legacy payload with no bracket fields', async () => {
    getClaimCodeMock.mockResolvedValueOnce({
      code: 'SUNSET-AAAA-BBBB', expires_at: new Date('2099-01-01'),
      consumed_at: null, consumed_by_camera_id: null,
    });
    upsertCameraByClaimCodeMock.mockResolvedValueOnce({
      id: 32, claim_code: 'SUNSET-AAAA-BBBB', lat: 47.6, lng: -122.3, azimuth_deg: 270, tilt_deg: 5,
    });
    derivePlacementStatusMock.mockReturnValueOnce('ready');

    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(202);
    const arg = upsertCameraByClaimCodeMock.mock.calls[0][1];
    expect(arg.azimuth_source).toBeNull();
    expect(arg.coarse).toBeNull();
    expect(arg.bracket).toBeNull();
  });

  it('defaults azimuth_source/coarse to bracket/true when a bracket is present but they are omitted', async () => {
    getClaimCodeMock.mockResolvedValueOnce({
      code: 'SUNSET-AAAA-BBBB', expires_at: new Date('2099-01-01'),
      consumed_at: null, consumed_by_camera_id: null,
    });
    upsertCameraByClaimCodeMock.mockResolvedValueOnce({
      id: 33, claim_code: 'SUNSET-AAAA-BBBB', lat: 47.6, lng: -122.3, azimuth_deg: 272.3, tilt_deg: 0,
    });
    derivePlacementStatusMock.mockReturnValueOnce('ready');
    const noSignals = {
      ...BRACKET_BODY,
      placement: { ...BRACKET_BODY.placement, azimuth_source: undefined, coarse: undefined },
    };
    const res = await POST(makeRequest(noSignals));
    expect(res.status).toBe(202);
    const arg = upsertCameraByClaimCodeMock.mock.calls[0][1];
    expect(arg.azimuth_source).toBe('bracket');
    expect(arg.coarse).toBe(true);
  });

  it('rejects a bracket payload that contradicts azimuth_source/coarse (400)', async () => {
    getClaimCodeMock.mockResolvedValueOnce({
      code: 'SUNSET-AAAA-BBBB', expires_at: new Date('2099-01-01'),
      consumed_at: null, consumed_by_camera_id: null,
    });
    const contradictory = {
      ...BRACKET_BODY,
      placement: { ...BRACKET_BODY.placement, azimuth_source: 'sun', coarse: false },
    };
    const res = await POST(makeRequest(contradictory));
    expect(res.status).toBe(400);
    expect(upsertCameraByClaimCodeMock).not.toHaveBeenCalled();
  });

  it('accepts a consumed-but-unexpired claim code (register-first norm) and still upserts (202)', async () => {
    getClaimCodeMock.mockResolvedValueOnce({
      code: 'SUNSET-AAAA-BBBB', expires_at: new Date('2099-01-01'),
      consumed_at: new Date('2026-06-13T00:00:00Z'), consumed_by_camera_id: 17,
    });
    upsertCameraByClaimCodeMock.mockResolvedValueOnce({
      id: 17, claim_code: 'SUNSET-AAAA-BBBB', lat: 47.6, lng: -122.3, azimuth_deg: 272.3, tilt_deg: 0,
    });
    derivePlacementStatusMock.mockReturnValueOnce('ready');
    const res = await POST(makeRequest(BRACKET_BODY));
    expect(res.status).toBe(202);
    expect(upsertCameraByClaimCodeMock).toHaveBeenCalled();
  });
});
