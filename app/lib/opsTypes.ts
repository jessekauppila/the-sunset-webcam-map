// Shared shapes for the owner-only Ops tab. Kept out of the route file so the
// client component can import types without pulling server code.
export interface DailyStatsRow {
  date: string; // 'YYYY-MM-DD'
  model_version: string;
  webcams_scored: number;
  cache_hits: number;
  fallbacks: number;
  score_p50: number | null;
  score_p90: number | null;
  source_breakdown: Record<
    string,
    { scored: number; avg: number | null }
  > | null;
}

export interface ProviderUsageRow {
  day: string; // 'YYYY-MM-DD'
  project_id: string;
  compute_time_s: number;
}

export interface CostEventRow {
  occurred_on: string; // 'YYYY-MM-DD'
  sha: string | null;
  description: string;
}

export interface OpsStatsResponse {
  dailyStats: DailyStatsRow[];
  providerUsage: ProviderUsageRow[];
  costEvents: CostEventRow[];
  calibrationCameras: CalibrationCameraRow[];
  calibrationHistory: CalibrationHistoryRow[];
}

/** A tempered camera and the evidence behind it. */
export interface CalibrationCameraRow {
  webcam_id: number;
  title: string | null;
  multiplier: number;
  false_shows: number;
  negative_frames: number;
  false_show_days: number;
  computed_at: string | null;
}

/** One multiplier change, for the over-time view. */
export interface CalibrationHistoryRow {
  webcam_id: number;
  computed_at: string;
  multiplier: number;
  previous_multiplier: number | null;
}

/**
 * One false-show frame behind a camera's tempering — the "was this camera
 * fairly tempered?" check. Fetched per-camera on expand, never bulk-loaded:
 * the evidence table holds ~9k rows and grows.
 */
export interface CalibrationFrameRow {
  snapshot_id: number;
  captured_on: string;
  p_sunset: number;
  tile: number | null;
  firebase_url: string;
}
