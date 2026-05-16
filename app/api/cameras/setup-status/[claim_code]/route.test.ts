// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getClaimCodeMock = vi.fn();
const sqlMock = vi.fn();
const derivePlacementStatusMock = vi.fn();

vi.mock('@/app/lib/cameraClaimCode', () => ({
  getClaimCode: (...a: unknown[]) => getClaimCodeMock(...a),
}));
vi.mock('@/app/lib/cameraRegistration', () => ({
  derivePlacementStatus: (...a: unknown[]) => derivePlacementStatusMock(...a),
}));
vi.mock('@/app/lib/db', () => ({
  sql: (s: TemplateStringsArray, ...v: unknown[]) => sqlMock(s, ...v),
}));

import { GET } from './route';

beforeEach(() => {
  getClaimCodeMock.mockReset();
  sqlMock.mockReset();
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

  it('returns awaiting_wifi when no cameras row exists for the claim code yet', async () => {
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

  it('returns awaiting_wifi when a pre-register-only row exists (no real device_token_hash)', async () => {
    getClaimCodeMock.mockResolvedValueOnce({
      code: 'SUNSET-AAAA-BBBB',
      expires_at: new Date('2099-01-01'),
      consumed_at: null,
      consumed_by_camera_id: null,
    });
    sqlMock.mockResolvedValueOnce([
      {
        id: 17,
        hardware_id: 'pending-SUNSET-AAAA-BBBB',
        device_token_hash: 'pending-SUNSET-AAAA-BBBB',
        lat: 47.6,
        lng: -122.3,
        azimuth_deg: 270,
        tilt_deg: 5,
      },
    ]);
    const res = await GET(makeRequest('SUNSET-AAAA-BBBB'), makeContext('SUNSET-AAAA-BBBB'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('awaiting_wifi');
  });

  it('returns registered when device has registered but placement is still pending', async () => {
    getClaimCodeMock.mockResolvedValueOnce({
      code: 'SUNSET-AAAA-BBBB',
      expires_at: new Date('2099-01-01'),
      consumed_at: new Date(),
      consumed_by_camera_id: 17,
    });
    sqlMock.mockResolvedValueOnce([
      {
        id: 17,
        hardware_id: 'rpi-real-serial',
        device_token_hash: 'real-hash-abc',
        lat: null,
        lng: null,
        azimuth_deg: null,
        tilt_deg: null,
      },
    ]);
    derivePlacementStatusMock.mockReturnValueOnce('pending');
    const res = await GET(makeRequest('SUNSET-AAAA-BBBB'), makeContext('SUNSET-AAAA-BBBB'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('registered');
  });

  it('returns ready when device is registered AND placement is populated', async () => {
    getClaimCodeMock.mockResolvedValueOnce({
      code: 'SUNSET-AAAA-BBBB',
      expires_at: new Date('2099-01-01'),
      consumed_at: new Date(),
      consumed_by_camera_id: 17,
    });
    sqlMock.mockResolvedValueOnce([
      {
        id: 17,
        hardware_id: 'rpi-real-serial',
        device_token_hash: 'real-hash-abc',
        lat: 47.6,
        lng: -122.3,
        azimuth_deg: 270,
        tilt_deg: 5,
      },
    ]);
    derivePlacementStatusMock.mockReturnValueOnce('ready');
    const res = await GET(makeRequest('SUNSET-AAAA-BBBB'), makeContext('SUNSET-AAAA-BBBB'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ready');
  });
});
