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
}

export interface Scene extends SceneSummary {
  notes: string;
  state: SceneState;
  provenance: SceneProvenance | null;
}

export interface SceneCreateInput {
  label: string;
  tags: string[];
  notes: string;
  representsAt: Date;
  source: 'live' | 'historical';
  state: SceneState;
  provenance: SceneProvenance | null;
}
