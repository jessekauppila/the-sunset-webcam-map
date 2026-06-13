// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';
const requireOwnerMock = vi.fn();
vi.mock('@/app/lib/owner', () => ({ requireOwner: (...a: unknown[]) => requireOwnerMock(...a) }));
import sharp from 'sharp';
import { GET } from './route';
beforeEach(() => requireOwnerMock.mockReset());

function req(qs: string) {
  return new Request(`http://test/api/admin/label?${qs}`);
}

describe('GET /api/admin/label', () => {
  it('returns the denial when not owner', async () => {
    requireOwnerMock.mockResolvedValueOnce(NextResponse.json({ error: 'Forbidden' }, { status: 403 }));
    const res = await GET(req('claim_code=SUNSET-7K3M-9XQ2&name=Backyard%20West&tape=14x75'));
    expect(res.status).toBe(403);
  });
  it('returns a PNG of the tape size for the owner', async () => {
    requireOwnerMock.mockResolvedValueOnce(null);
    const res = await GET(req('claim_code=SUNSET-7K3M-9XQ2&name=Backyard%20West&tape=14x75'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    const buf = Buffer.from(await res.arrayBuffer());
    const meta = await sharp(buf).metadata();
    expect(meta.format).toBe('png');
    expect(meta.width).toBe(886);
    expect(meta.height).toBe(165);
  });
  it('400 when claim_code missing', async () => {
    requireOwnerMock.mockResolvedValueOnce(null);
    const res = await GET(req('name=X&tape=14x75'));
    expect(res.status).toBe(400);
  });
});
