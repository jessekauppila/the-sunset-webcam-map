import { it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

const requireOwner = vi.fn();
const getScene = vi.fn();
const updateSceneMeta = vi.fn();
const deleteScene = vi.fn();
const resolveScene = vi.fn();
vi.mock('@/app/lib/owner', () => ({ requireOwner: () => requireOwner() }));
vi.mock('@/app/lib/scenes/resolve', () => ({
  resolveScene: (scene: unknown) => resolveScene(scene),
}));
vi.mock('@/app/lib/scenes/store', () => ({
  getScene: (id: number) => getScene(id),
  updateSceneMeta: (id: number, p: unknown) => updateSceneMeta(id, p),
  deleteScene: (id: number) => deleteScene(id),
}));

import { GET, PATCH, DELETE } from './route';

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (body?: unknown) =>
  new Request('http://t/api/kiosk/scenes/2', { method: 'PATCH', body: JSON.stringify(body ?? {}) });

beforeEach(() => {
  vi.clearAllMocks();
  requireOwner.mockResolvedValue(null);
  // Default passthrough: GET returns whatever the store held, resolved.
  resolveScene.mockImplementation(async (scene: Record<string, unknown>) => ({
    ...scene, resolvedFrom: scene.state ? 'frozen' : 'archive',
  }));
});

it('GET denies non-owners without touching the store', async () => {
  requireOwner.mockResolvedValue(NextResponse.json({ error: 'nope' }, { status: 403 }));
  const res = await GET(req(), params('2'));
  expect(res.status).toBe(403);
  expect(getScene).not.toHaveBeenCalled();
});

it('GET returns 404 for missing and the scene when found', async () => {
  getScene.mockResolvedValueOnce(null);
  expect((await GET(req(), params('9'))).status).toBe(404);
  getScene.mockResolvedValueOnce({ id: 2, label: 'b' });
  const res = await GET(req(), params('2'));
  expect((await res.json()).label).toBe('b');
});

it('GET rejects a non-numeric id', async () => {
  expect((await GET(req(), params('abc'))).status).toBe(400);
  expect(getScene).not.toHaveBeenCalled();
});

it('PATCH denies non-owners without touching the store', async () => {
  requireOwner.mockResolvedValue(NextResponse.json({ error: 'nope' }, { status: 403 }));
  const res = await PATCH(req({ label: 'x' }), params('2'));
  expect(res.status).toBe(403);
  expect(updateSceneMeta).not.toHaveBeenCalled();
});

it('PATCH updates metadata only', async () => {
  updateSceneMeta.mockResolvedValue(true);
  const res = await PATCH(req({ label: 'renamed', tags: ['grant'] }), params('2'));
  expect(res.status).toBe(200);
  expect(updateSceneMeta).toHaveBeenCalledWith(2, { label: 'renamed', tags: ['grant'] });
});

it('PATCH rejects attempts to modify state', async () => {
  const res = await PATCH(req({ state: { sunrise: [] } }), params('2'));
  expect(res.status).toBe(400);
  expect(updateSceneMeta).not.toHaveBeenCalled();
});

it('PATCH and DELETE 404 on a missing id', async () => {
  updateSceneMeta.mockResolvedValue(false);
  expect((await PATCH(req({ label: 'x' }), params('9'))).status).toBe(404);
  deleteScene.mockResolvedValue(false);
  expect((await DELETE(req(), params('9'))).status).toBe(404);
});

it('DELETE denies non-owners without touching the store', async () => {
  requireOwner.mockResolvedValue(NextResponse.json({ error: 'nope' }, { status: 403 }));
  const res = await DELETE(req(), params('2'));
  expect(res.status).toBe(403);
  expect(deleteScene).not.toHaveBeenCalled();
});

it('DELETE removes a scene', async () => {
  deleteScene.mockResolvedValue(true);
  const res = await DELETE(req(), params('3'));
  expect(await res.json()).toEqual({ ok: true });
});

it('resolves a pointer scene rather than returning its null pool', async () => {
  getScene.mockResolvedValue({ id: 2, label: 'equinox', state: null, windowMinutes: 45 });
  resolveScene.mockResolvedValue({
    id: 2, label: 'equinox', windowMinutes: 45,
    state: { sunrise: [{ webcamId: 1 }], sunset: [] },
    resolvedFrom: 'archive',
  });

  const res = await GET(new Request('http://t'), params('2'));
  const body = await res.json();

  expect(resolveScene).toHaveBeenCalled();
  expect(body.resolvedFrom).toBe('archive');
  expect(body.state.sunrise).toHaveLength(1);
});

it('does not resolve when the scene is missing', async () => {
  getScene.mockResolvedValue(null);
  const res = await GET(new Request('http://t'), params('2'));
  expect(res.status).toBe(404);
  expect(resolveScene).not.toHaveBeenCalled();
});
