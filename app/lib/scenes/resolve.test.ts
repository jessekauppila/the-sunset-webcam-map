import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Scene } from './types';

const reconstructScene = vi.fn();
vi.mock('./reconstruct', () => ({
  reconstructScene: (...a: unknown[]) => reconstructScene(...a),
}));

import { resolveScene } from './resolve';

const scene = (over: Partial<Scene>): Scene => ({
  id: 1, label: 's', tags: [], notes: '',
  representsAt: '2026-06-21T12:00:00.000Z',
  windowMinutes: 45, source: 'historical',
  createdAt: '2026-06-21T12:00:00.000Z',
  state: null, provenance: null,
  ...over,
});

const pool = { sunrise: [{ webcamId: 1 }], sunset: [] };

beforeEach(() => {
  reconstructScene.mockReset();
  reconstructScene.mockResolvedValue({ state: pool, reconstructed: 1, skipped: 0 });
});

describe('resolveScene', () => {
  it('resolves a pointer scene from the archive at its own window', async () => {
    const out = await resolveScene(scene({ windowMinutes: 30 }));
    expect(out.resolvedFrom).toBe('archive');
    expect(out.state).toEqual(pool);
    const [at, window] = reconstructScene.mock.calls[0];
    expect((at as Date).toISOString()).toBe('2026-06-21T12:00:00.000Z');
    expect(window).toBe(30);
  });

  it('replays a legacy frozen scene instead of reconstructing it', async () => {
    // Legacy scenes predate the archive write, so reconstructing one would
    // quietly return a different and much smaller pool.
    const frozen = { sunrise: [], sunset: [{ webcamId: 9 }] } as unknown as Scene['state'];
    const out = await resolveScene(scene({ state: frozen }));
    expect(out.resolvedFrom).toBe('frozen');
    expect(out.state).toEqual(frozen);
    expect(reconstructScene).not.toHaveBeenCalled();
  });

  it('falls back to a 45 minute window when a pointer scene stored none', async () => {
    await resolveScene(scene({ windowMinutes: null }));
    expect(reconstructScene.mock.calls[0][1]).toBe(45);
  });

  it('keeps the scene metadata alongside the resolved pool', async () => {
    const out = await resolveScene(scene({ label: 'equinox' }));
    expect(out.label).toBe('equinox');
    expect(out.representsAt).toBe('2026-06-21T12:00:00.000Z');
  });

  it('reports an empty archive window as an empty pool, not a crash', async () => {
    reconstructScene.mockResolvedValue({
      state: { sunrise: [], sunset: [] }, reconstructed: 0, skipped: 0,
    });
    const out = await resolveScene(scene({}));
    expect(out.state.sunrise).toEqual([]);
    expect(out.resolvedFrom).toBe('archive');
  });
});
