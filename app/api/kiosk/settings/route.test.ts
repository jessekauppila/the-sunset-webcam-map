// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

const requireOwnerMock = vi.fn();
vi.mock('@/app/lib/owner', () => ({
  requireOwner: (...a: unknown[]) => requireOwnerMock(...a),
}));

const getProfileSettingsMock = vi.fn();
const putStudioNamespaceMock = vi.fn();
vi.mock('@/app/lib/settings/store', () => ({
  getProfileSettings: (p: string) => getProfileSettingsMock(p),
  putStudioNamespace: (n: string, d: unknown) => putStudioNamespaceMock(n, d),
}));

const getKioskLastPollMock = vi.fn();
vi.mock('@/app/lib/cache', () => ({
  getKioskLastPoll: () => getKioskLastPollMock(),
}));

vi.mock('@/app/components/mosaic/registry', () => ({
  MOSAIC_VERSIONS: { v1: {} },
  DEFAULT_MOSAIC_VERSION: 'v1',
  MOSAIC_SETTINGS_SCHEMAS: {
    v1: [
      {
        key: 'floorPx',
        kind: 'number',
        min: 20,
        max: 800,
        step: 10,
        default: 100,
        label: 'floor (px)',
        description: 'Minimum tile size',
        section: 'sizing',
      },
    ] as const,
  },
}));

import { GET, PATCH } from './route';

function reqGet(): Request {
  return new Request('http://test/api/kiosk/settings', {
    method: 'GET',
  });
}

function reqPatch(body: unknown): Request {
  return new Request('http://test/api/kiosk/settings', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('GET /api/kiosk/settings', () => {
  beforeEach(() => {
    requireOwnerMock.mockReset();
    getProfileSettingsMock.mockReset();
    getKioskLastPollMock.mockReset();
  });

  it('rejects non-owners', async () => {
    requireOwnerMock.mockResolvedValueOnce(
      NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    );
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it('returns studio, live, and lastPollAt', async () => {
    requireOwnerMock.mockResolvedValueOnce(null);
    getProfileSettingsMock.mockResolvedValueOnce({
      namespaces: { v1: { floorPx: 150 } },
      revision: 1,
    });
    getProfileSettingsMock.mockResolvedValueOnce({
      namespaces: { v1: { floorPx: 100 } },
      revision: 0,
    });
    getKioskLastPollMock.mockResolvedValueOnce('2026-08-30T12:00:00Z');

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      studio: { namespaces: { v1: { floorPx: 150 } }, revision: 1 },
      live: { namespaces: { v1: { floorPx: 100 } }, revision: 0 },
      lastPollAt: '2026-08-30T12:00:00Z',
    });
  });
});

describe('PATCH /api/kiosk/settings', () => {
  beforeEach(() => {
    requireOwnerMock.mockReset();
    putStudioNamespaceMock.mockReset();
  });

  it('rejects non-owners', async () => {
    requireOwnerMock.mockResolvedValueOnce(
      NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    );
    const res = await PATCH(reqPatch({ namespace: 'v1', values: {} }));
    expect(res.status).toBe(403);
    expect(putStudioNamespaceMock).not.toHaveBeenCalled();
  });

  it('400s on invalid JSON', async () => {
    requireOwnerMock.mockResolvedValueOnce(null);
    const req = new Request('http://test/api/kiosk/settings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: '{invalid json}',
    });
    const res = await PATCH(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid JSON');
  });

  it('400s on missing namespace', async () => {
    requireOwnerMock.mockResolvedValueOnce(null);
    const res = await PATCH(reqPatch({ values: {} }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('namespace must be a string');
  });

  it('400s on non-string namespace', async () => {
    requireOwnerMock.mockResolvedValueOnce(null);
    const res = await PATCH(reqPatch({ namespace: 123, values: {} }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('namespace must be a string');
  });

  it('400s on unknown namespace', async () => {
    requireOwnerMock.mockResolvedValueOnce(null);
    const res = await PATCH(reqPatch({ namespace: 'unknown', values: {} }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('unknown namespace: unknown');
  });

  it('sanitizes values: clamps numbers, drops unknown keys', async () => {
    requireOwnerMock.mockResolvedValueOnce(null);
    putStudioNamespaceMock.mockResolvedValueOnce(2);

    const res = await PATCH(
      reqPatch({ namespace: 'v1', values: { floorPx: 5000, ghost: 1 } }),
    );
    expect(res.status).toBe(200);
    expect(putStudioNamespaceMock).toHaveBeenCalledWith('v1', { floorPx: 800 });
    const body = await res.json();
    expect(body).toEqual({ revision: 2 });
  });

  it('strips defaults: omits values equal to schema defaults', async () => {
    requireOwnerMock.mockResolvedValueOnce(null);
    putStudioNamespaceMock.mockResolvedValueOnce(1);

    const res = await PATCH(reqPatch({ namespace: 'v1', values: { floorPx: 100 } }));
    expect(res.status).toBe(200);
    expect(putStudioNamespaceMock).toHaveBeenCalledWith('v1', {});
    const body = await res.json();
    expect(body).toEqual({ revision: 1 });
  });

  it('returns the new revision', async () => {
    requireOwnerMock.mockResolvedValueOnce(null);
    putStudioNamespaceMock.mockResolvedValueOnce(42);

    const res = await PATCH(
      reqPatch({ namespace: 'v1', values: { floorPx: 200 } }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ revision: 42 });
  });
});
