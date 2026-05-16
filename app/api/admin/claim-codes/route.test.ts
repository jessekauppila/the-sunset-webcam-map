// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mintClaimCodeMock = vi.fn();
vi.mock('@/app/lib/cameraClaimCode', () => ({
  mintClaimCode: (...args: unknown[]) => mintClaimCodeMock(...args),
}));

import { POST } from './route';

beforeEach(() => {
  mintClaimCodeMock.mockReset();
  process.env.CRON_SECRET = 'test-secret-12345';
});

function makeRequest(body: unknown, bearer?: string) {
  const headers: HeadersInit = { 'content-type': 'application/json' };
  if (bearer) headers['authorization'] = `Bearer ${bearer}`;
  return new Request('http://test/api/admin/claim-codes', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

describe('POST /api/admin/claim-codes', () => {
  it('mints a claim code when authorized', async () => {
    mintClaimCodeMock.mockResolvedValueOnce({
      code: 'SUNSET-AAAA-BBBB',
      expires_at: new Date('2026-06-15T00:00:00Z'),
    });
    const res = await POST(makeRequest({ label: 'rooftop-1' }, 'test-secret-12345'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.code).toBe('SUNSET-AAAA-BBBB');
    expect(typeof body.expires_at).toBe('string');
    expect(mintClaimCodeMock).toHaveBeenCalledWith({ label: 'rooftop-1' });
  });

  it('rejects when bearer is missing', async () => {
    const res = await POST(makeRequest({ label: 'rooftop-1' }));
    expect(res.status).toBe(401);
    expect(mintClaimCodeMock).not.toHaveBeenCalled();
  });

  it('rejects when bearer is wrong', async () => {
    const res = await POST(makeRequest({ label: 'rooftop-1' }, 'wrong'));
    expect(res.status).toBe(401);
    expect(mintClaimCodeMock).not.toHaveBeenCalled();
  });

  it('accepts a missing label (label is optional)', async () => {
    mintClaimCodeMock.mockResolvedValueOnce({
      code: 'SUNSET-XXXX-YYYY',
      expires_at: new Date('2026-06-15T00:00:00Z'),
    });
    const res = await POST(makeRequest({}, 'test-secret-12345'));
    expect(res.status).toBe(200);
    expect(mintClaimCodeMock).toHaveBeenCalledWith({ label: null });
  });

  it('returns 400 when body is not valid JSON', async () => {
    const req = new Request('http://test/api/admin/claim-codes', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer test-secret-12345',
      },
      body: 'not-json',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
