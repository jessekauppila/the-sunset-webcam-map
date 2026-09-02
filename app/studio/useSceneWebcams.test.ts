import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

import { useSceneWebcams } from './useSceneWebcams';

const listPayload = {
  scenes: [{ id: 1, label: 'solstice', tags: [], representsAt: 't', source: 'historical', createdAt: 't' }],
};
const scenePayload = {
  id: 1, label: 'solstice', tags: [], notes: '', representsAt: 't', source: 'historical',
  createdAt: 't', provenance: null,
  state: { sunrise: [{ webcamId: 9 }], sunset: [] },
};

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation((url: string) =>
    Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve(String(url).endsWith('/1') ? scenePayload : listPayload),
    })
  );
});

describe('useSceneWebcams', () => {
  it('serves the scene list and null state for live', async () => {
    const { result } = renderHook(() => useSceneWebcams({ kind: 'live' }));
    await waitFor(() => expect(result.current.scenes).toHaveLength(1));
    expect(result.current.sceneState).toBeNull();
  });

  it('serves the selected scene state', async () => {
    const { result } = renderHook(() => useSceneWebcams({ kind: 'scene', id: 1 }));
    await waitFor(() => expect(result.current.sceneState).not.toBeNull());
    expect(result.current.sceneState?.sunrise[0].webcamId).toBe(9);
    expect(result.current.sceneLabel).toBe('solstice');
  });
});

describe('useSceneWebcams — scene moment', () => {
  // Reuses the file's top-level fetchMock rather than a second vi.stubGlobal
  // — this nested beforeEach runs after the file's outer one and overrides
  // its mockImplementation for just these tests. The scene id (2) differs
  // from the other describe block's (1) so the SWR cache keys don't collide.
  beforeEach(() => {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve(
            String(url) === '/api/kiosk/scenes'
              ? { scenes: [] }
              : {
                  id: 2,
                  label: 'Equinox full glass',
                  tags: [],
                  notes: '',
                  representsAt: '2026-03-14T17:30:00.000Z',
                  source: 'historical',
                  createdAt: '2026-03-14T18:00:00.000Z',
                  state: { sunrise: [], sunset: [] },
                  provenance: null,
                }
          ),
      })
    );
  });

  it("exposes the selected scene's representsAt", async () => {
    const { result } = renderHook(() => useSceneWebcams({ kind: 'scene', id: 2 }));
    await waitFor(() =>
      expect(result.current.sceneRepresentsAt).toBe('2026-03-14T17:30:00.000Z')
    );
  });

  it('has no moment when the source is live', async () => {
    const { result } = renderHook(() => useSceneWebcams({ kind: 'live' }));
    await waitFor(() => expect(result.current.sceneRepresentsAt).toBeNull());
  });
});
