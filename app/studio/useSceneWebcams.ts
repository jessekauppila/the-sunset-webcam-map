'use client';

import useSWR from 'swr';
import type { Scene, SceneProvenance, SceneState, SceneSummary } from '@/app/lib/scenes/types';

export type SceneSource = { kind: 'live' } | { kind: 'scene'; id: number };

const fetcher = (url: string) =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error(`${url}: ${r.status}`);
    return r.json();
  });

export function useSceneWebcams(source: SceneSource): {
  scenes: SceneSummary[];
  sceneState: SceneState | null;
  sceneLabel: string | null;
  sceneRepresentsAt: string | null;
  /** The operator's own words about the scene, or null. */
  sceneNotes: string | null;
  /**
   * The active version and every namespace's dial deviations at save time.
   * Written by captureLive for every scene; read by nobody until now, which
   * made a scene a screenshot of a pool rather than a saved configuration.
   */
  sceneProvenance: SceneProvenance | null;
  error: string | null;
  refreshScenes: () => void;
} {
  const list = useSWR<{ scenes: SceneSummary[] }>('/api/kiosk/scenes', fetcher);
  const sceneId = source.kind === 'scene' ? source.id : null;
  const scene = useSWR<Scene>(
    sceneId === null ? null : `/api/kiosk/scenes/${sceneId}`,
    fetcher
  );
  return {
    scenes: list.data?.scenes ?? [],
    sceneState: scene.data?.state ?? null,
    sceneLabel: scene.data?.label ?? null,
    sceneRepresentsAt: scene.data?.representsAt ?? null,
    sceneNotes: scene.data?.notes ?? null,
    sceneProvenance: scene.data?.provenance ?? null,
    error: (list.error ?? scene.error)?.message ?? null,
    // A scene saved from the rail must appear in the selector without a
    // reload, or the operator cannot tell the capture worked.
    refreshScenes: () => void list.mutate(),
  };
}
