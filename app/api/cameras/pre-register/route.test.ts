// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getClaimCodeMock = vi.fn();
const sqlMock = vi.fn();
const isOwnerMock = vi.fn();
const upsertMock = vi.fn();
vi.mock('@/app/lib/cameraClaimCode', () => ({
  getClaimCode: (...args: unknown[]) => getClaimCodeMock(...args),
}));
vi.mock('@/app/lib/db', () => ({
  sql: (...args: unknown[]) => sqlMock(...args),
}));
vi.mock('@/auth', () => ({ auth: async () => ({ user: { email: 'x' } }) }));
vi.mock('@/app/lib/owner', () => ({ isOwner: (...a: unknown[]) => isOwnerMock(...a) }));
vi.mock('@/app/lib/cameraDeployment', () => ({
  upsertActiveDeployment: (...a: unknown[]) => upsertMock(...a),
  derivePlacementStatus: () => 'ready',
}));
vi.mock('@/app/lib/cameraRegistration', () => ({
  PHASE_VALUES: ['sunrise', 'sunset', 'both'],
}));

import { POST } from './route';

beforeEach(() => {
  getClaimCodeMock.mockReset();
  sqlMock.mockReset();
  isOwnerMock.mockReset();
  upsertMock.mockReset();
  upsertMock.mockResolvedValue({ id: 99, state: 'testing' });
});

const VALID_CLAIM = {
  code: 'SUNSET-AAAA-BBBB',
  expires_at: new Date('2099-01-01'),
  consumed_at: null,
  consumed_by_camera_id: null,
};

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

// ── validation failures (happen BEFORE camera resolution — no sql mock needed) ──

describe('POST /api/cameras/pre-register — validation failures', () => {
  it('returns 400 on malformed JSON body', async () => {
    const req = new Request('http://test/api/cameras/pre-register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not-json',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('rejects when required fields are missing (no lat)', async () => {
    const bad = { ...VALID_BODY, lat: undefined };
    const res = await POST(makeRequest(bad));
    expect(res.status).toBe(400);
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it('rejects when horizon_profile is not an array', async () => {
    const bad = {
      ...VALID_BODY,
      placement: { ...VALID_BODY.placement, horizon_profile: 'not an array' },
    };
    const res = await POST(makeRequest(bad));
    expect(res.status).toBe(400);
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it('rejects an invalid lens in bracket', async () => {
    const bad = {
      ...BRACKET_BODY,
      placement: { ...BRACKET_BODY.placement, bracket: { ...BRACKET_BODY.placement.bracket, lens: 'fisheye' } },
    };
    const res = await POST(makeRequest(bad));
    expect(res.status).toBe(400);
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it('rejects an invalid window_offset_side in bracket', async () => {
    const bad = {
      ...BRACKET_BODY,
      placement: { ...BRACKET_BODY.placement, bracket: { ...BRACKET_BODY.placement.bracket, window_offset_side: 'sideways' } },
    };
    const res = await POST(makeRequest(bad));
    expect(res.status).toBe(400);
  });

  it('rejects a bracket payload that contradicts azimuth_source/coarse (PR-2 invariant)', async () => {
    // getClaimCode check comes after validation, bracket check is before — so no claim mock needed
    const contradictory = {
      ...BRACKET_BODY,
      placement: { ...BRACKET_BODY.placement, azimuth_source: 'sun', coarse: false },
    };
    const res = await POST(makeRequest(contradictory));
    expect(res.status).toBe(400);
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it('rejects when phase_preference is invalid', async () => {
    const bad = {
      ...VALID_BODY,
      operator_preferences: { ...VALID_BODY.operator_preferences, phase_preference: 'midnight' },
    };
    const res = await POST(makeRequest(bad));
    expect(res.status).toBe(400);
  });
});

// ── claim code checks (after field validation, before camera resolution) ──

describe('POST /api/cameras/pre-register — claim code checks', () => {
  it('rejects when claim code is unknown (404)', async () => {
    getClaimCodeMock.mockResolvedValueOnce(null);
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(404);
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it('rejects when claim code is expired (410)', async () => {
    getClaimCodeMock.mockResolvedValueOnce({
      ...VALID_CLAIM,
      expires_at: new Date('2020-01-01'),
    });
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(410);
    expect(upsertMock).not.toHaveBeenCalled();
  });
});

// ── camera resolution (after claim check) ──

describe('POST /api/cameras/pre-register — camera resolution', () => {
  it('returns 404 when no camera is provisioned for the claim code', async () => {
    getClaimCodeMock.mockResolvedValueOnce(VALID_CLAIM);
    sqlMock.mockResolvedValueOnce([]); // no camera row
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/not provisioned/);
    expect(upsertMock).not.toHaveBeenCalled();
  });
});

// ── owner-aware state logic ──

describe('POST /api/cameras/pre-register — owner-aware state', () => {
  it('owner with no publish flag → state: testing', async () => {
    getClaimCodeMock.mockResolvedValueOnce(VALID_CLAIM);
    sqlMock.mockResolvedValueOnce([{ id: 7 }]);
    isOwnerMock.mockReturnValue(true);

    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(202);
    const opts = upsertMock.mock.calls[0][2];
    expect(opts).toEqual({ state: 'testing', mode: 'reaim' });
  });

  it('owner + publish:true in body → state: deployed', async () => {
    getClaimCodeMock.mockResolvedValueOnce(VALID_CLAIM);
    sqlMock.mockResolvedValueOnce([{ id: 7 }]);
    isOwnerMock.mockReturnValue(true);

    const res = await POST(makeRequest({ ...VALID_BODY, publish: true }));
    expect(res.status).toBe(202);
    const opts = upsertMock.mock.calls[0][2];
    expect(opts).toMatchObject({ state: 'deployed' });
  });

  it('non-owner → state: deployed (devices always deploy themselves)', async () => {
    getClaimCodeMock.mockResolvedValueOnce(VALID_CLAIM);
    sqlMock.mockResolvedValueOnce([{ id: 7 }]);
    isOwnerMock.mockReturnValue(false);

    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(202);
    const opts = upsertMock.mock.calls[0][2];
    expect(opts).toMatchObject({ state: 'deployed' });
  });

  it('mode:new in body → upsert called with mode: new', async () => {
    getClaimCodeMock.mockResolvedValueOnce(VALID_CLAIM);
    sqlMock.mockResolvedValueOnce([{ id: 7 }]);
    isOwnerMock.mockReturnValue(true);

    const res = await POST(makeRequest({ ...VALID_BODY, mode: 'new' }));
    expect(res.status).toBe(202);
    const opts = upsertMock.mock.calls[0][2];
    expect(opts).toMatchObject({ mode: 'new' });
  });

  it('mode absent → defaults to reaim', async () => {
    getClaimCodeMock.mockResolvedValueOnce(VALID_CLAIM);
    sqlMock.mockResolvedValueOnce([{ id: 7 }]);
    isOwnerMock.mockReturnValue(true);

    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(202);
    const opts = upsertMock.mock.calls[0][2];
    expect(opts).toMatchObject({ mode: 'reaim' });
  });
});

// ── response shape ──

describe('POST /api/cameras/pre-register — response shape', () => {
  it('202 response includes camera_id, deployment_id, state, placement_status', async () => {
    getClaimCodeMock.mockResolvedValueOnce(VALID_CLAIM);
    sqlMock.mockResolvedValueOnce([{ id: 7 }]);
    isOwnerMock.mockReturnValue(false);
    upsertMock.mockResolvedValue({ id: 99, state: 'deployed' });

    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.camera_id).toBe(7);
    expect(body.deployment_id).toBe(99);
    expect(body.state).toBe('deployed');
    expect(body.placement_status).toBe('ready');
  });
});

// ── bracket provenance forwarded to upsert ──

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

describe('POST /api/cameras/pre-register — bracket provenance', () => {
  it('accepts a bracket payload and forwards provenance to upsert', async () => {
    getClaimCodeMock.mockResolvedValueOnce(VALID_CLAIM);
    sqlMock.mockResolvedValueOnce([{ id: 7 }]);
    isOwnerMock.mockReturnValue(false);

    const res = await POST(makeRequest(BRACKET_BODY));
    expect(res.status).toBe(202);
    const placementArg = upsertMock.mock.calls[0][1];
    expect(placementArg.azimuth_source).toBe('bracket');
    expect(placementArg.coarse).toBe(true);
    expect(placementArg.bracket.lens).toBe('wide_120');
    expect(placementArg.bracket.wedge_angle_deg).toBe(5);
  });

  it('still accepts a legacy payload with no bracket fields', async () => {
    getClaimCodeMock.mockResolvedValueOnce(VALID_CLAIM);
    sqlMock.mockResolvedValueOnce([{ id: 7 }]);
    isOwnerMock.mockReturnValue(false);

    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(202);
    const placementArg = upsertMock.mock.calls[0][1];
    expect(placementArg.azimuth_source).toBeNull();
    expect(placementArg.coarse).toBeNull();
    expect(placementArg.bracket).toBeNull();
  });

  it('defaults azimuth_source/coarse to bracket/true when bracket present but omitted', async () => {
    getClaimCodeMock.mockResolvedValueOnce(VALID_CLAIM);
    sqlMock.mockResolvedValueOnce([{ id: 7 }]);
    isOwnerMock.mockReturnValue(false);
    const noSignals = {
      ...BRACKET_BODY,
      placement: { ...BRACKET_BODY.placement, azimuth_source: undefined, coarse: undefined },
    };
    const res = await POST(makeRequest(noSignals));
    expect(res.status).toBe(202);
    const placementArg = upsertMock.mock.calls[0][1];
    expect(placementArg.azimuth_source).toBe('bracket');
    expect(placementArg.coarse).toBe(true);
  });

  it('accepts a consumed-but-unexpired claim code and still upserts (202)', async () => {
    getClaimCodeMock.mockResolvedValueOnce({
      ...VALID_CLAIM,
      consumed_at: new Date('2026-06-13T00:00:00Z'),
      consumed_by_camera_id: 7,
    });
    sqlMock.mockResolvedValueOnce([{ id: 7 }]);
    isOwnerMock.mockReturnValue(false);

    const res = await POST(makeRequest(BRACKET_BODY));
    expect(res.status).toBe(202);
    expect(upsertMock).toHaveBeenCalled();
  });
});
