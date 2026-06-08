// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

const requireOwnerMock = vi.fn();
const upsertMock = vi.fn();
const deleteMock = vi.fn();

vi.mock('@/app/lib/owner', () => ({
  requireOwner: (...a: unknown[]) => requireOwnerMock(...a),
}));
vi.mock('@/app/lib/manualLabels', () => ({
  upsertManualLabel: (...a: unknown[]) => upsertMock(...a),
  deleteManualLabel: (...a: unknown[]) => deleteMock(...a),
}));

import { POST, DELETE } from './route';

const post = (body: unknown) =>
  new Request('http://test/api/manual-labels', {
    method: 'POST',
    body: JSON.stringify(body),
  });

beforeEach(() => {
  requireOwnerMock.mockReset().mockResolvedValue(null);
  upsertMock.mockReset().mockResolvedValue(undefined);
  deleteMock.mockReset().mockResolvedValue(undefined);
});

describe('POST /api/manual-labels', () => {
  it('gates on owner before writing', async () => {
    requireOwnerMock.mockResolvedValue(NextResponse.json({ error: 'no' }, { status: 401 }));
    const res = await POST(post({ source: 'flickr', imageId: 1, isSunset: true }));
    expect(res.status).toBe(401);
    expect(upsertMock).not.toHaveBeenCalled();
  });
  it('upserts a valid label', async () => {
    const res = await POST(post({ source: 'flickr', imageId: 7, isSunset: true, rating: 4 }));
    expect(res.status).toBe(200);
    expect(upsertMock).toHaveBeenCalledWith({ source: 'flickr', imageId: 7, isSunset: true, rating: 4 });
  });
  it('rejects a bad source', async () => {
    const res = await POST(post({ source: 'nope', imageId: 1, isSunset: true }));
    expect(res.status).toBe(400);
    expect(upsertMock).not.toHaveBeenCalled();
  });
  it('rejects an out-of-range rating', async () => {
    const res = await POST(post({ source: 'webcam', imageId: 1, isSunset: true, rating: 9 }));
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/manual-labels', () => {
  it('removes a label (owner-gated)', async () => {
    const req = new Request('http://test/api/manual-labels', {
      method: 'DELETE', body: JSON.stringify({ source: 'webcam', imageId: 9 }),
    });
    const res = await DELETE(req);
    expect(res.status).toBe(200);
    expect(deleteMock).toHaveBeenCalledWith('webcam', 9);
  });
});
