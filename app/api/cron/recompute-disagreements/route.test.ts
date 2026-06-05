// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const authMock = vi.fn();
const recomputeMock = vi.fn();

vi.mock('../update-cameras/lib/auth', () => ({
  verifyCronAuth: (...a: unknown[]) => authMock(...a),
}));
vi.mock('../update-cameras/lib/recomputeDisagreements', () => ({
  recomputeDisagreements: (...a: unknown[]) => recomputeMock(...a),
}));

import { GET } from './route';

const req = () => new Request('http://test/api/cron/recompute-disagreements');

beforeEach(() => {
  authMock.mockReset();
  recomputeMock.mockReset().mockResolvedValue({ recomputed: 12, flagged: 3 });
});

describe('GET /api/cron/recompute-disagreements', () => {
  it('rejects unauthorized requests with 401 (no recompute runs)', async () => {
    authMock.mockReturnValue(false);
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(recomputeMock).not.toHaveBeenCalled();
  });

  it('runs the recompute and returns its counts when authorized', async () => {
    authMock.mockReturnValue(true);
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, recomputed: 12, flagged: 3 });
    expect(recomputeMock).toHaveBeenCalledTimes(1);
  });

  it('returns 500 when the recompute throws', async () => {
    authMock.mockReturnValue(true);
    recomputeMock.mockRejectedValue(new Error('boom'));
    const res = await GET(req());
    expect(res.status).toBe(500);
  });
});
