// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getClaimCodeMock = vi.fn();
const sqlMock = vi.fn();

vi.mock('@/app/lib/db', () => ({
  sql: (s: TemplateStringsArray, ...v: unknown[]) => sqlMock(s, ...v),
}));
vi.mock('@/app/lib/cameraClaimCode', async (importActual) => {
  const actual = await importActual<typeof import('@/app/lib/cameraClaimCode')>();
  return { ...actual, getClaimCode: (...a: unknown[]) => getClaimCodeMock(...a) };
});

import { POST } from './route';

beforeEach(() => {
  getClaimCodeMock.mockReset();
  sqlMock.mockReset();
});

function makeRequest(body: unknown) {
  return new Request('http://test/api/cameras/x/pause', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

const VALID_CLAIM = {
  code: 'SUNSET-AAAA-BBBB',
  expires_at: new Date('2099-01-01'),
  consumed_at: new Date(),
  consumed_by_camera_id: 5,
};

describe('POST /api/cameras/[id]/pause', () => {
  it('claim-code-scoped pause sets status=paused (camera not ended)', async () => {
    getClaimCodeMock.mockResolvedValueOnce(VALID_CLAIM);
    sqlMock.mockResolvedValueOnce([{ id: 5 }]); // SELECT id by claim_code
    sqlMock.mockResolvedValueOnce([{ id: 5, status: 'paused' }]); // UPDATE

    const res = await POST(
      makeRequest({ claim_code: 'SUNSET-AAAA-BBBB' }),
      ctx('SUNSET-AAAA-BBBB')
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.camera_id).toBe(5);
    expect(body.status).toBe('paused');
    // pause must NOT touch the wipe directive.
    const updateCall = sqlMock.mock.calls[1];
    expect(updateCall[0].join('')).not.toContain('wifi_wipe_requested');
  });

  it('operator path: numeric id resolves without a claim code', async () => {
    sqlMock.mockResolvedValueOnce([{ id: 7 }]);
    sqlMock.mockResolvedValueOnce([{ id: 7, status: 'paused' }]);

    const res = await POST(makeRequest({}), ctx('7'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.camera_id).toBe(7);
    expect(getClaimCodeMock).not.toHaveBeenCalled();
  });

  it('unknown claim code → 404', async () => {
    getClaimCodeMock.mockResolvedValueOnce(null);
    const res = await POST(
      makeRequest({ claim_code: 'SUNSET-AAAA-BBBB' }),
      ctx('SUNSET-AAAA-BBBB')
    );
    expect(res.status).toBe(404);
  });

  it('expired claim code → 410', async () => {
    getClaimCodeMock.mockResolvedValueOnce({
      ...VALID_CLAIM,
      expires_at: new Date('2020-01-01'),
    });
    const res = await POST(
      makeRequest({ claim_code: 'SUNSET-AAAA-BBBB' }),
      ctx('SUNSET-AAAA-BBBB')
    );
    expect(res.status).toBe(410);
  });
});
