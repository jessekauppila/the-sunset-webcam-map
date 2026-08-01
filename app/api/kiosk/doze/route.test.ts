// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

const requireOwnerMock = vi.fn();
vi.mock('@/app/lib/owner', () => ({
  requireOwner: (...a: unknown[]) => requireOwnerMock(...a),
}));
const setKioskDozeMock = vi.fn();
vi.mock('@/app/lib/cache', () => ({
  setKioskDoze: (on: boolean) => setKioskDozeMock(on),
}));

import { POST } from './route';

function req(body: unknown): Request {
  return new Request('http://test/api/kiosk/doze', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/kiosk/doze', () => {
  beforeEach(() => {
    requireOwnerMock.mockReset();
    setKioskDozeMock.mockReset();
  });

  it('rejects non-owners', async () => {
    requireOwnerMock.mockResolvedValueOnce(
      NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    );
    const res = await POST(req({ doze: true }));
    expect(res.status).toBe(403);
    expect(setKioskDozeMock).not.toHaveBeenCalled();
  });

  it('sets the flag for the owner', async () => {
    requireOwnerMock.mockResolvedValueOnce(null);
    const res = await POST(req({ doze: true }));
    expect(res.status).toBe(200);
    expect(setKioskDozeMock).toHaveBeenCalledWith(true);
    expect(await res.json()).toEqual({ doze: true });
  });

  it('400s on a malformed body', async () => {
    requireOwnerMock.mockResolvedValueOnce(null);
    const res = await POST(req({ doze: 'maybe' }));
    expect(res.status).toBe(400);
  });
});
