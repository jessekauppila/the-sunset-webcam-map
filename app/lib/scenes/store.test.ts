import { describe, it, expect, vi, beforeEach } from 'vitest';

const sqlMock = vi.fn();
vi.mock('@/app/lib/db', () => ({ sql: (...args: unknown[]) => sqlMock(...args) }));

import { createScene, listScenes, getScene, updateSceneMeta, deleteScene } from './store';

const state = { sunrise: [], sunset: [] };

beforeEach(() => sqlMock.mockReset());

describe('createScene', () => {
  it('inserts and returns the new id', async () => {
    sqlMock.mockResolvedValueOnce([{ id: 7 }]);
    const id = await createScene({
      label: 'solstice 4:45am', tags: ['edge-case'], notes: '',
      representsAt: new Date('2026-06-21T11:45:00Z'),
      source: 'historical', windowMinutes: 45, state, provenance: null,
    });
    expect(id).toBe(7);
    const query = (sqlMock.mock.calls[0][0] as string[]).join('?');
    expect(query).toContain('INSERT INTO kiosk_scenes');
  });
});

describe('listScenes', () => {
  it('maps rows to summaries, newest represents_at first', async () => {
    sqlMock.mockResolvedValueOnce([{
      id: 1, label: 'a', tags: ['x'], represents_at: '2026-08-30T02:00:00Z',
      source: 'live', created_at: '2026-08-30T02:01:00Z',
    }]);
    const scenes = await listScenes();
    expect(scenes[0]).toEqual({
      windowMinutes: null,
      id: 1, label: 'a', tags: ['x'], representsAt: '2026-08-30T02:00:00Z',
      source: 'live', createdAt: '2026-08-30T02:01:00Z',
    });
    expect((sqlMock.mock.calls[0][0] as string[]).join('?')).toContain('ORDER BY represents_at DESC');
  });
});

describe('getScene', () => {
  it('returns null for a missing id', async () => {
    sqlMock.mockResolvedValueOnce([]);
    expect(await getScene(99)).toBeNull();
  });
  it('returns the full scene', async () => {
    sqlMock.mockResolvedValueOnce([{
      id: 2, label: 'b', tags: [], notes: 'n', represents_at: 't1',
      source: 'historical', windowMinutes: 45, created_at: 't2', state, provenance: null,
    }]);
    const scene = await getScene(2);
    expect(scene?.state).toEqual(state);
    expect(scene?.notes).toBe('n');
  });
});

describe('updateSceneMeta', () => {
  it('updates only provided fields and reports found', async () => {
    sqlMock.mockResolvedValueOnce([{ id: 2 }]);
    expect(await updateSceneMeta(2, { label: 'renamed' })).toBe(true);
    const query = (sqlMock.mock.calls[0][0] as string[]).join('?');
    expect(query).toContain('UPDATE kiosk_scenes');
    expect(query).not.toContain('state');
  });
  it('returns false when nothing matched', async () => {
    sqlMock.mockResolvedValueOnce([]);
    expect(await updateSceneMeta(99, { notes: 'x' })).toBe(false);
  });
});

describe('deleteScene', () => {
  it('returns true when a row was deleted', async () => {
    sqlMock.mockResolvedValueOnce([{ id: 3 }]);
    expect(await deleteScene(3)).toBe(true);
  });
});

describe('listScenes — the resolution window', () => {
  it('reports a legacy scene as having no window, never as NaN', async () => {
    // Legacy rows predate the column, so it comes back null or absent. A
    // NaN here would poison every window computation downstream silently.
    sqlMock.mockResolvedValueOnce([{
      id: 1, label: 'legacy', tags: [], represents_at: '2026-08-30T02:00:00Z',
      source: 'live', created_at: '2026-08-30T02:00:00Z',
    }]);
    const [scene] = await listScenes();
    expect(scene.windowMinutes).toBeNull();
  });

  it('reads the window back as a number when the row has one', async () => {
    sqlMock.mockResolvedValueOnce([{
      id: 2, label: 'pointer', tags: [], represents_at: '2026-08-30T02:00:00Z',
      window_minutes: 45, source: 'historical', created_at: '2026-08-30T02:00:00Z',
    }]);
    const [scene] = await listScenes();
    expect(scene.windowMinutes).toBe(45);
  });
});
