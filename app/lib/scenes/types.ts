import type { WindyWebcam } from '@/app/lib/types';

export interface SceneState {
  sunrise: WindyWebcam[];
  sunset: WindyWebcam[];
}

export interface SceneProvenance {
  activeVersion: string;
  settings: Record<string, Record<string, unknown>>; // namespace -> deviations
}

export interface SceneSummary {
  id: number;
  label: string;
  tags: string[];
  representsAt: string;
  source: 'live' | 'historical';
  createdAt: string;
  /**
   * Half-width of the window this scene resolves from, in minutes. Null on
   * the legacy scenes that froze their own pool into `state` instead.
   */
  windowMinutes: number | null;
}

export interface Scene extends SceneSummary {
  notes: string;
  /**
   * The frozen pool, on legacy scenes only. Null means the scene is a
   * pointer: resolve it from the archive over `representsAt ± windowMinutes`.
   */
  state: SceneState | null;
  provenance: SceneProvenance | null;
}

export interface SceneCreateInput {
  label: string;
  tags: string[];
  notes: string;
  representsAt: Date;
  windowMinutes: number;
  source: 'live' | 'historical';
  /**
   * Legacy frozen pool. New scenes pass null and resolve from the archive by
   * time window, so a re-rating or a newer model shows up on replay instead
   * of being invisible behind a copy taken at save time.
   */
  state: SceneState | null;
  provenance: SceneProvenance | null;
}
