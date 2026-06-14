// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getClaimCodeMock = vi.fn();
const sqlMock = vi.fn();
const endActiveDeploymentMock = vi.fn();

vi.mock('@/app/lib/db', () => ({
  sql: (s: TemplateStringsArray, ...v: unknown[]) => sqlMock(s, ...v),
}));
vi.mock('@/app/lib/cameraClaimCode', async (importActual) => {
  const actual = await importActual<typeof import('@/app/lib/cameraClaimCode')>();
  return { ...actual, getClaimCode: (...a: unknown[]) => getClaimCodeMock(...a) };
});
vi.mock('@/app/lib/cameraDeployment', () => ({
  endActiveDeployment: (...a: unknown[]) => endActiveDeploymentMock(...a),
}));

import { POST } from './route';

beforeEach(() => {
  getClaimCodeMock.mockReset();
  sqlMock.mockReset();
  endActiveDeploymentMock.mockReset();
});

function makeRequest(body: unknown) {
  return new Request('http://test/api/cameras/x/decommission', {
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

describe('POST /api/cameras/[id]/decommission', () => {
  it('claim-code-scoped (no Bearer) ends the active deployment', async () => {
    getClaimCodeMock.mockResolvedValueOnce(VALID_CLAIM);
    sqlMock.mockResolvedValueOnce([{ id: 5 }]); // SELECT id by claim_code
    endActiveDeploymentMock.mockResolvedValueOnce({ ended: true });

    const res = await POST(
      makeRequest({ claim_code: 'SUNSET-AAAA-BBBB' }),
      ctx('SUNSET-AAAA-BBBB')
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.camera_id).toBe(5);
    expect(body.ended).toBe(true);
    expect(endActiveDeploymentMock).toHaveBeenCalledWith(5, { relocate: false });
  });

  it('with relocate:true passes relocate flag to endActiveDeployment', async () => {
    getClaimCodeMock.mockResolvedValueOnce(VALID_CLAIM);
    sqlMock.mockResolvedValueOnce([{ id: 5 }]);
    endActiveDeploymentMock.mockResolvedValueOnce({ ended: true });

    const res = await POST(
      makeRequest({ claim_code: 'SUNSET-AAAA-BBBB', relocate: true }),
      ctx('SUNSET-AAAA-BBBB')
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ended).toBe(true);
    expect(endActiveDeploymentMock).toHaveBeenCalledWith(5, { relocate: true });
  });

  it('operator path: numeric id resolves without a claim code', async () => {
    sqlMock.mockResolvedValueOnce([{ id: 7 }]); // SELECT id by numeric id
    endActiveDeploymentMock.mockResolvedValueOnce({ ended: true });

    const res = await POST(makeRequest({}), ctx('7'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.camera_id).toBe(7);
    expect(getClaimCodeMock).not.toHaveBeenCalled();
    expect(endActiveDeploymentMock).toHaveBeenCalledWith(7, { relocate: false });
  });

  it('unknown claim code → 404', async () => {
    getClaimCodeMock.mockResolvedValueOnce(null);
    const res = await POST(
      makeRequest({ claim_code: 'SUNSET-AAAA-BBBB' }),
      ctx('SUNSET-AAAA-BBBB')
    );
    expect(res.status).toBe(404);
    expect(endActiveDeploymentMock).not.toHaveBeenCalled();
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
    expect(endActiveDeploymentMock).not.toHaveBeenCalled();
  });

  it('unknown numeric id → 404', async () => {
    sqlMock.mockResolvedValueOnce([]); // SELECT by id → none
    const res = await POST(makeRequest({}), ctx('999'));
    expect(res.status).toBe(404);
    expect(endActiveDeploymentMock).not.toHaveBeenCalled();
  });
});
