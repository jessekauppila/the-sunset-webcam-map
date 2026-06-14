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

import { GET } from './route';

beforeEach(() => {
  getClaimCodeMock.mockReset();
  sqlMock.mockReset();
  getActiveDeploymentMock.mockReset();
  derivePlacementStatusMock.mockReset();
});

function makeRequest(code: string) {
  return new Request(`http://test/api/cameras/setup-status/${code}`, { method: 'GET' });
}

function makeContext(claim_code: string) {
  return { params: Promise.resolve({ claim_code }) };
}

describe('GET /api/cameras/setup-status/[claim_code]', () => {
  it('returns 404 when the claim code does not exist', async () => {
    getClaimCodeMock.mockResolvedValueOnce(null);
    const res = await GET(makeRequest('SUNSET-XXXX-YYYY'), makeContext('SUNSET-XXXX-YYYY'));
    expect(res.status).toBe(404);
  });

  it('returns 404 for an expired claim code', async () => {
    getClaimCodeMock.mockResolvedValueOnce({
      code: 'SUNSET-AAAA-BBBB',
      expires_at: new Date('2020-01-01'),
      consumed_at: null,
      consumed_by_camera_id: null,
    });
    const res = await GET(
      makeRequest('SUNSET-AAAA-BBBB'),
      makeContext('SUNSET-AAAA-BBBB')
    );
    expect(res.status).toBe(404);
  });

  it('returns awaiting_wifi when no cameras row exists for the claim code', async () => {
    getClaimCodeMock.mockResolvedValueOnce({
      code: 'SUNSET-AAAA-BBBB',
      expires_at: new Date('2099-01-01'),
      consumed_at: null,
      consumed_by_camera_id: null,
    });
    sqlMock.mockResolvedValueOnce([]); // SELECT cameras → none
    const res = await GET(makeRequest('SUNSET-AAAA-BBBB'), makeContext('SUNSET-AAAA-BBBB'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('awaiting_wifi');
  });

  it('returns registered when camera exists but has no active deployment', async () => {
    getClaimCodeMock.mockResolvedValueOnce({
      code: 'SUNSET-AAAA-BBBB',
      expires_at: new Date('2099-01-01'),
      consumed_at: null,
      consumed_by_camera_id: null,
    });
    sqlMock.mockResolvedValueOnce([{ id: 7 }]);
    getActiveDeploymentMock.mockResolvedValueOnce(null);
    const res = await GET(makeRequest('SUNSET-AAAA-BBBB'), makeContext('SUNSET-AAAA-BBBB'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('registered');
  });

  it('returns ready when camera has an active deployment that is fully placed', async () => {
    getClaimCodeMock.mockResolvedValueOnce({
      code: 'SUNSET-AAAA-BBBB',
      expires_at: new Date('2099-01-01'),
      consumed_at: new Date(),
      consumed_by_camera_id: 7,
    });
    sqlMock.mockResolvedValueOnce([{ id: 7 }]);
    const deployment = { id: 1, lat: 47.6, lng: -122.3, azimuth_deg: 270, tilt_deg: 5 };
    getActiveDeploymentMock.mockResolvedValueOnce(deployment);
    derivePlacementStatusMock.mockReturnValueOnce('ready');
    const res = await GET(makeRequest('SUNSET-AAAA-BBBB'), makeContext('SUNSET-AAAA-BBBB'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ready');
  });

  it('returns awaiting_aim when deployment has location but no aim', async () => {
    getClaimCodeMock.mockResolvedValueOnce({
      code: 'SUNSET-AAAA-BBBB',
      expires_at: new Date('2099-01-01'),
      consumed_at: new Date(),
      consumed_by_camera_id: 7,
    });
    sqlMock.mockResolvedValueOnce([{ id: 7 }]);
    const deployment = { id: 1, lat: 47.6, lng: -122.3, azimuth_deg: null, tilt_deg: null };
    getActiveDeploymentMock.mockResolvedValueOnce(deployment);
    derivePlacementStatusMock.mockReturnValueOnce('awaiting_aim');
    const res = await GET(makeRequest('SUNSET-AAAA-BBBB'), makeContext('SUNSET-AAAA-BBBB'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('awaiting_aim');
  });

  it('returns registered when deployment exists but has awaiting_location placement', async () => {
    getClaimCodeMock.mockResolvedValueOnce({
      code: 'SUNSET-AAAA-BBBB',
      expires_at: new Date('2099-01-01'),
      consumed_at: new Date(),
      consumed_by_camera_id: 7,
    });
    sqlMock.mockResolvedValueOnce([{ id: 7 }]);
    const deployment = { id: 1, lat: null, lng: null, azimuth_deg: null, tilt_deg: null };
    getActiveDeploymentMock.mockResolvedValueOnce(deployment);
    derivePlacementStatusMock.mockReturnValueOnce('awaiting_location');
    const res = await GET(makeRequest('SUNSET-AAAA-BBBB'), makeContext('SUNSET-AAAA-BBBB'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('registered');
  });
});
