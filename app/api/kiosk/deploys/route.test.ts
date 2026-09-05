// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

const requireOwnerMock = vi.fn();
vi.mock('@/app/lib/owner', () => ({ requireOwner: () => requireOwnerMock() }));
const listDeploysMock = vi.fn();
vi.mock('@/app/lib/settings/deploys', () => ({ listDeploys: () => listDeploysMock() }));

import { GET } from './route';

describe('GET /api/kiosk/deploys', () => {
  beforeEach(() => {
    requireOwnerMock.mockReset();
    listDeploysMock.mockReset();
  });
  it('rejects non-owners', async () => {
    requireOwnerMock.mockResolvedValueOnce(NextResponse.json({ error: 'Forbidden' }, { status: 403 }));
    expect((await GET()).status).toBe(403);
    expect(listDeploysMock).not.toHaveBeenCalled();
  });
  it('returns the list', async () => {
    requireOwnerMock.mockResolvedValueOnce(null);
    listDeploysMock.mockResolvedValueOnce([{ id: 1, label: null, namespaces: {}, deployedAt: 'T' }]);
    expect(await (await GET()).json()).toEqual({
      deploys: [{ id: 1, label: null, namespaces: {}, deployedAt: 'T' }],
    });
  });
});
