import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

const requireOwner = vi.fn();
const listScenes = vi.fn();
const createScene = vi.fn();
const reconstructScene = vi.fn();
const captureLiveScene = vi.fn();
vi.mock('@/app/lib/owner', () => ({ requireOwner: () => requireOwner() }));
vi.mock('@/app/lib/scenes/store', () => ({
  listScenes: () => listScenes(), createScene: (i: unknown) => createScene(i),
}));
vi.mock('@/app/lib/scenes/reconstruct', () => ({
  reconstructScene: (...a: unknown[]) => reconstructScene(...a),
}));
vi.mock('@/app/lib/scenes/captureLive', () => ({
  captureLiveScene: () => captureLiveScene(),
}));

import { GET, POST } from './route';

const emptyState = { sunrise: [], sunset: [] };
const post = (body: unknown) =>
  POST(new Request('http://t/api/kiosk/scenes', { method: 'POST', body: JSON.stringify(body) }));

beforeEach(() => {
  vi.clearAllMocks();
  requireOwner.mockResolvedValue(null);
});

describe('GET /api/kiosk/scenes', () => {
  it('denies non-owners without touching the store', async () => {
    requireOwner.mockResolvedValue(NextResponse.json({ error: 'nope' }, { status: 403 }));
    const res = await GET();
    expect(res.status).toBe(403);
    expect(listScenes).not.toHaveBeenCalled();
  });
  it('lists scenes', async () => {
    listScenes.mockResolvedValue([{ id: 1 }]);
    const res = await GET();
    expect((await res.json()).scenes).toEqual([{ id: 1 }]);
  });
});

describe('POST /api/kiosk/scenes', () => {
  it('rejects a missing label', async () => {
    expect((await post({ at: '2026-06-21T11:45:00Z' })).status).toBe(400);
  });
  it('rejects an unparseable at', async () => {
    expect((await post({ label: 'x', at: 'not-a-date' })).status).toBe(400);
  });
  it('reconstructs when at is given', async () => {
    reconstructScene.mockResolvedValue({ state: { sunrise: [{}], sunset: [] }, reconstructed: 1, skipped: 2 });
    createScene.mockResolvedValue(5);
    const res = await post({ label: 'solstice', at: '2026-06-21T11:45:00Z', windowMinutes: 30 });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: 5, source: 'historical', reconstructed: 1, skipped: 2 });
    expect(reconstructScene).toHaveBeenCalledWith(new Date('2026-06-21T11:45:00Z'), 30);
    expect(createScene).toHaveBeenCalledWith(expect.objectContaining({ source: 'historical', provenance: null }));
    expect(captureLiveScene).not.toHaveBeenCalled();
  });
  it('returns 422 when reconstruction finds nothing', async () => {
    reconstructScene.mockResolvedValue({ state: emptyState, reconstructed: 0, skipped: 0 });
    expect((await post({ label: 'x', at: '2001-01-01T00:00:00Z' })).status).toBe(422);
    expect(createScene).not.toHaveBeenCalled();
  });
  it('captures live when at is omitted', async () => {
    captureLiveScene.mockResolvedValue({
      state: { sunrise: [], sunset: [{}] },
      provenance: { activeVersion: 'v1', settings: {} }, pinned: 2, pinFailures: 1,
    });
    createScene.mockResolvedValue(6);
    const res = await post({ label: 'tonight' });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: 6, source: 'live', pinned: 2, pinFailures: 1 });
    expect(createScene).toHaveBeenCalledWith(expect.objectContaining({
      source: 'live',
      provenance: { activeVersion: 'v1', settings: {} },
    }));
  });
});
