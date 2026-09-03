'use client';

import useSWR from 'swr';
import type { Scene, SceneState, SceneSummary } from '@/app/lib/scenes/types';

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
    error: (list.error ?? scene.error)?.message ?? null,
    // A scene saved from the rail must appear in the selector without a
    // reload, or the operator cannot tell the capture worked.
    refreshScenes: () => void list.mutate(),
  };
}
