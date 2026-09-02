import { describe, it, expect } from 'vitest';
import { poolFor } from './previewPool';
import type { WindyWebcam } from '@/app/lib/types';
import type { SceneState } from '@/app/lib/scenes/types';

const cam = (id: string) => ({ webcamId: id } as unknown as WindyWebcam);
const live = { sunrise: [cam('lr')], sunset: [cam('ls')] };
const scene = { sunrise: [cam('sr')], sunset: [cam('ss')] } as unknown as SceneState;

describe('poolFor', () => {
  it('reads the live store when no scene is selected', () => {
    expect(poolFor('sunrise', { kind: 'live' }, null, live)).toEqual(live.sunrise);
    expect(poolFor('sunset', { kind: 'live' }, null, live)).toEqual(live.sunset);
  });

  it('reads the scene once it resolves', () => {
    expect(poolFor('sunrise', { kind: 'scene', id: 1 }, scene, live)).toEqual(scene.sunrise);
    expect(poolFor('sunset', { kind: 'scene', id: 1 }, scene, live)).toEqual(scene.sunset);
  });

  it('is empty for a selected-but-unresolved scene, never the live pool', () => {
    // Falling through to live would print live counts and paint live tiles
    // under the scene's header — the exact lie this helper exists to stop.
    expect(poolFor('sunrise', { kind: 'scene', id: 1 }, null, live)).toEqual([]);
    expect(poolFor('sunset', { kind: 'scene', id: 1 }, null, live)).toEqual([]);
  });
});
