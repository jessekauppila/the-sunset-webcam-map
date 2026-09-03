import type { WindyWebcam } from '@/app/lib/types';
import type { SceneState } from '@/app/lib/scenes/types';
import type { SceneSource } from './useSceneWebcams';

/** The live terminator pools, as the store holds them. */
export interface LivePools {
  sunrise: WindyWebcam[];
  sunset: WindyWebcam[];
}

/**
 * Which pool a feed's panel is actually composing right now.
 *
 * One definition for the whole studio: the preview paints it and the status
 * strip counts it. They used to answer this separately — the preview honoured
 * the scene selector while the strip always read the live store — so selecting
 * a scene left the strip describing a different pool than the one on screen.
 *
 * A selected-but-unresolved scene (loading, 404, fetch error) is EMPTY rather
 * than live: falling through would show live tiles under the scene's header.
 */
export function poolFor(
  feed: 'sunrise' | 'sunset',
  source: SceneSource,
  sceneState: SceneState | null,
  live: LivePools
): WindyWebcam[] {
  if (source.kind === 'scene') return sceneState ? sceneState[feed] : [];
  return live[feed];
}
