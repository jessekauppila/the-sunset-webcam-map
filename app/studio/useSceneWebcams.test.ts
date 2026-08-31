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
