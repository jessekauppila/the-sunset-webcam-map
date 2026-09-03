import 'server-only';
import { sql } from '@/app/lib/db';
import type { WindyWebcam } from '@/app/lib/types';
import type { SceneState } from './types';

export interface HistoricalSnapshotRow {
  webcam_id: number;
  phase: 'sunrise' | 'sunset' | null;
  rank: number | null;
  firebase_url: string;
  snapshot_captured_at: string;
  llm_quality: string | number | null;
  llm_is_sunset: boolean | null;
  llm_model: string | null;
  ai_binary_score: string | number | null;
  ai_regression_score: string | number | null;
  ai_model_version_binary: string | null;
  ai_model_version_regression: string | null;
  title: string | null;
  status: string | null;
  view_count: number | null;
  lat: string | number | null;
  lng: string | number | null;
  city: string | null;
  region: string | null;
  country: string | null;
  continent: string | null;
  categories: unknown;
  urls: unknown;
  player: unknown;
  rating: number | null;
  orientation: string | null;
  webcam_source: string | null;
  external_id: string | null;
}

export interface ReconstructResult {
  state: SceneState;
  reconstructed: number;
  skipped: number;
}

const toMaybeNumber = (v: string | number | null): number | null =>
  v === null || v === undefined ? null : Number(v);

/**
 * Archive columns hold [0,1] probabilities; the webcams table (and therefore
 * everything reading a WindyWebcam, including the mosaic's gate) holds the
 * 1-5 rating those map onto. `rating = 1 + probability * 4`, the same
 * relation qualitySignal.ratingGateFor encodes in the other direction.
 *
 * Handing a raw [0,1] straight through would put every reconstructed frame
 * below even a gate of 0 — the normalized-vs-raw confusion that produced the
 * 35k-rows-zero-positives export bug.
 */
const probabilityToRating = (v: string | number | null): number | undefined => {
  const n = toMaybeNumber(v);
  return n === null ? undefined : 1 + n * 4;
};

export function rowsToSceneState(rows: HistoricalSnapshotRow[]): ReconstructResult {
  const state: SceneState = { sunrise: [], sunset: [] };
  let skipped = 0;
  for (const r of rows) {
    if (!r.phase || !r.firebase_url) { skipped += 1; continue; }
    const cam: WindyWebcam = {
      webcamId: r.webcam_id,
      title: r.title ?? 'Unknown',
      viewCount: r.view_count ?? 0,
      status: r.status ?? 'unknown',
      images: { current: { preview: r.firebase_url } },
      location: {
        city: r.city ?? '', region: r.region ?? '',
        latitude: Number(r.lat), longitude: Number(r.lng),
        country: r.country ?? '', continent: r.continent ?? '',
      },
      categories: (r.categories as WindyWebcam['categories']) ?? [],
      urls: (r.urls as WindyWebcam['urls']) ?? undefined,
      player: (r.player as WindyWebcam['player']) ?? undefined,
      phase: r.phase,
      rank: r.rank ?? undefined,
      source: r.webcam_source ?? undefined,
      externalId: r.external_id ?? undefined,
      rating: r.rating ?? undefined,
      orientation: (r.orientation as WindyWebcam['orientation']) ?? undefined,
      llmQuality: toMaybeNumber(r.llm_quality),
      llmIsSunset: r.llm_is_sunset,
      llmModel: r.llm_model,
      // Both judges, so a replayed scene reacts to the gate dial the way a
      // live one does. Reconstruction used to carry Claude's columns alone,
      // which made the gate inert on every historical scene.
      aiRatingBinary: probabilityToRating(r.ai_binary_score),
      aiRatingRegression: probabilityToRating(r.ai_regression_score),
      aiModelVersionBinary: r.ai_model_version_binary ?? undefined,
      aiModelVersionRegression: r.ai_model_version_regression ?? undefined,
      lastUpdatedOn: r.snapshot_captured_at,
    };
    state[r.phase].push(cam);
  }
  const byRank = (a: WindyWebcam, b: WindyWebcam) =>
    (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER);
  state.sunrise.sort(byRank);
  state.sunset.sort(byRank);
  return { state, reconstructed: state.sunrise.length + state.sunset.length, skipped };
}

export async function reconstructScene(
  at: Date,
  windowMinutes: number
): Promise<ReconstructResult> {
  const windowMs = windowMinutes * 60 * 1000;
  const from = new Date(at.getTime() - windowMs);
  const to = new Date(at.getTime() + windowMs);
  const rows = (await sql`
    SELECT DISTINCT ON (s.webcam_id)
      s.webcam_id, s.phase, s.rank, s.firebase_url,
      s.captured_at AS snapshot_captured_at,
      s.llm_quality, s.llm_is_sunset, s.llm_model,
      s.ai_binary_score, s.ai_regression_score,
      s.ai_model_version_binary, s.ai_model_version_regression,
      w.title, w.status, w.view_count, w.lat, w.lng,
      w.city, w.region, w.country, w.continent,
      w.categories, w.urls, w.player, w.rating, w.orientation,
      w.source AS webcam_source, w.external_id
    FROM webcam_snapshots s
    JOIN webcams w ON w.id = s.webcam_id
    WHERE s.captured_at BETWEEN ${from} AND ${to}
    ORDER BY s.webcam_id,
      ABS(EXTRACT(EPOCH FROM (s.captured_at - ${at})))
  `) as HistoricalSnapshotRow[];
  return rowsToSceneState(rows);
}
