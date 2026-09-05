// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const requireOwnerMock = vi.fn();
vi.mock('@/app/lib/owner', () => ({ requireOwner: () => requireOwnerMock() }));
const relabelMock = vi.fn();
vi.mock('@/app/lib/settings/deploys', () => ({
  relabelDeploy: (id: number, l: unknown) => relabelMock(id, l),
}));

import { PATCH } from './route';

const req = (body: unknown) =>
  new NextRequest('http://test/api/kiosk/deploys/7', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe('PATCH /api/kiosk/deploys/[id]', () => {
  beforeEach(() => {
    requireOwnerMock.mockReset();
    relabelMock.mockReset();
    requireOwnerMock.mockResolvedValue(null);
  });
  it('rejects non-owners', async () => {
    requireOwnerMock.mockResolvedValueOnce(NextResponse.json({ error: 'Forbidden' }, { status: 403 }));
    expect((await PATCH(req({ label: 'x' }), params('7'))).status).toBe(403);
  });
  it('400 on a bad id, a non-string label, or a label over 60 chars', async () => {
    expect((await PATCH(req({ label: 'x' }), params('seven'))).status).toBe(400);
    expect((await PATCH(req({ label: 5 }), params('7'))).status).toBe(400);
    expect((await PATCH(req({ label: 'x'.repeat(61) }), params('7'))).status).toBe(400);
    expect(relabelMock).not.toHaveBeenCalled();
  });
  it('renames, and null clears the label', async () => {
    relabelMock.mockResolvedValueOnce(true);
    const res = await PATCH(req({ label: ' opening night ' }), params('7'));
    expect(relabelMock).toHaveBeenCalledWith(7, 'opening night');
    expect(await res.json()).toEqual({ ok: true });
    relabelMock.mockResolvedValueOnce(true);
    await PATCH(req({ label: null }), params('7'));
    expect(relabelMock).toHaveBeenLastCalledWith(7, null);
  });
  it('404 when the deploy does not exist', async () => {
    relabelMock.mockResolvedValueOnce(false);
    expect((await PATCH(req({ label: 'x' }), params('99'))).status).toBe(404);
  });
});
