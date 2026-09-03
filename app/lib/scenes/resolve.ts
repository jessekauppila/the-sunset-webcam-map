import 'server-only';
import { reconstructScene } from './reconstruct';
import type { Scene, SceneState } from './types';

export interface ResolvedScene extends Omit<Scene, 'state'> {
  state: SceneState;
  /**
   * How the pool on this scene was obtained. 'frozen' is a legacy scene
   * replaying the copy it took at save time; 'archive' is a pointer scene
   * resolved just now, so a re-rating or a newer model is visible on it.
   */
  resolvedFrom: 'frozen' | 'archive';
}

/** Window to fall back on for a pointer scene that somehow stored none. */
const DEFAULT_WINDOW_MINUTES = 45;

/**
 * Turns a stored scene into a pool to render.
 *
 * A pointer scene resolves from the archive every time it is opened, which
 * is the point: the frames are fixed by the window, and the SCORES move as
 * the model improves. That is what makes "load an old scene and see whether
 * the thing the model got wrong is right now" possible at all — a frozen
 * copy answers with the old model forever.
 *
 * Legacy scenes keep replaying their frozen pool. They predate the archive
 * write, so there is nothing to resolve them from, and reconstructing them
 * would silently return a different and much smaller pool.
 */
export async function resolveScene(scene: Scene): Promise<ResolvedScene> {
  if (scene.state) {
    return { ...scene, state: scene.state, resolvedFrom: 'frozen' };
  }
  const { state } = await reconstructScene(
    new Date(scene.representsAt),
    scene.windowMinutes ?? DEFAULT_WINDOW_MINUTES
  );
  return { ...scene, state, resolvedFrom: 'archive' };
}
