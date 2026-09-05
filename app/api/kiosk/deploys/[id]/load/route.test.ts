// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const requireOwnerMock = vi.fn();
vi.mock('@/app/lib/owner', () => ({ requireOwner: () => requireOwnerMock() }));
const loadMock = vi.fn();
vi.mock('@/app/lib/settings/deploys', () => ({
  loadDeployIntoStudio: (id: number) => loadMock(id),
}));

import { POST } from './route';

const req = () => new NextRequest('http://test/api/kiosk/deploys/7/load', { method: 'POST' });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe('POST /api/kiosk/deploys/[id]/load', () => {
  beforeEach(() => {
    requireOwnerMock.mockReset();
    loadMock.mockReset();
    requireOwnerMock.mockResolvedValue(null);
  });
  it('rejects non-owners', async () => {
    requireOwnerMock.mockResolvedValueOnce(NextResponse.json({ error: 'Forbidden' }, { status: 403 }));
    expect((await POST(req(), params('7'))).status).toBe(403);
    expect(loadMock).not.toHaveBeenCalled();
  });
  it('400 on a bad id', async () => {
    expect((await POST(req(), params('0'))).status).toBe(400);
  });
  it('404 when the deploy does not exist', async () => {
    loadMock.mockResolvedValueOnce(null);
    expect((await POST(req(), params('99'))).status).toBe(404);
  });
  it('loads into the studio and reports the dropped keys', async () => {
    const out = {
      studio: { namespaces: { v1: { floorPx: 140 } }, revision: 2 },
      dropped: [{ namespace: 'v1', key: 'ghost', reason: 'unknown' }],
    };
    loadMock.mockResolvedValueOnce(out);
    const res = await POST(req(), params('7'));
    expect(loadMock).toHaveBeenCalledWith(7);
    expect(await res.json()).toEqual(out);
  });
});
