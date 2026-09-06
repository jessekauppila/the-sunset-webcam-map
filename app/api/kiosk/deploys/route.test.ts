// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const requireOwnerMock = vi.fn();
vi.mock('@/app/lib/owner', () => ({ requireOwner: () => requireOwnerMock() }));
const listDeploysMock = vi.fn();
const saveTakeMock = vi.fn();
vi.mock('@/app/lib/settings/deploys', () => ({
  listDeploys: () => listDeploysMock(),
  saveTake: (studio: unknown, label: unknown) => saveTakeMock(studio, label),
}));
const getProfileSettingsMock = vi.fn();
vi.mock('@/app/lib/settings/store', () => ({
  getProfileSettings: (profile: string) => getProfileSettingsMock(profile),
}));

import { GET, POST } from './route';

const req = (body: unknown) =>
  new NextRequest('http://test/api/kiosk/deploys', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

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

describe('POST /api/kiosk/deploys', () => {
  beforeEach(() => {
    requireOwnerMock.mockReset();
    saveTakeMock.mockReset();
    getProfileSettingsMock.mockReset();
    requireOwnerMock.mockResolvedValue(null);
    getProfileSettingsMock.mockResolvedValue({ namespaces: {}, revision: 1 });
  });
  it('rejects non-owners', async () => {
    requireOwnerMock.mockResolvedValueOnce(NextResponse.json({ error: 'Forbidden' }, { status: 403 }));
    expect((await POST(req({ label: 'x' }))).status).toBe(403);
    expect(saveTakeMock).not.toHaveBeenCalled();
  });
  it('saves a take with no deployedAt', async () => {
    saveTakeMock.mockResolvedValueOnce({
      id: 1,
      label: 'x',
      namespaces: {},
      deployedAt: null,
      createdAt: 'T',
    });
    const res = await POST(req({ label: 'x' }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.take.deployedAt).toBeNull();
    expect(saveTakeMock).toHaveBeenCalledWith({ namespaces: {}, revision: 1 }, 'x');
  });
  it('400 on a label over 60 chars', async () => {
    const res = await POST(req({ label: 'x'.repeat(61) }));
    expect(res.status).toBe(400);
    expect(saveTakeMock).not.toHaveBeenCalled();
  });
  it('503 when saveTake fails', async () => {
    saveTakeMock.mockResolvedValueOnce(null);
    const res = await POST(req({ label: 'x' }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'take not recorded' });
  });
});
