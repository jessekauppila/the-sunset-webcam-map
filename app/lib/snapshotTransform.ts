import type { Snapshot, Orientation } from './types';

// Database row structure from JOIN query
export interface SnapshotRow {
  snapshot_id: number;
  // Nullable for external_images (Flickr) rows in the verification UNION — those
  // have no parent webcam, location, or phase.
  webcam_id: number | null;
  phase: 'sunrise' | 'sunset' | null;
  rank: number | null;
  initial_rating: number | null;
  calculated_rating: number | null;
  ai_rating: number | null;
  firebase_url: string;
  firebase_path: string;
  captured_at: string;
  created_at: string;
  rating_count: number;
  user_rating: number | null;
  // Webcam fields
  w_id: number | null;
  source: string;
  external_id: string | null;
  title: string | null;
  status: string | null;
  view_count: number | null;
  lat: number | null;
  lng: number | null;
  city: string | null;
  region: string | null;
  country: string | null;
  continent: string | null;
  images: unknown;
  urls: unknown;
  player: unknown;
  categories: unknown;
  last_fetched_at: string;
  webcam_rating: number | null;
  orientation: string | null;
  webcam_ai_rating: number | null;
  webcam_ai_model_version: string | null;
  webcam_ai_rating_binary: number | null;
  webcam_ai_model_version_binary: string | null;
  webcam_ai_rating_regression: number | null;
  webcam_ai_model_version_regression: string | null;
  // Hard-example mining columns — only present in hard-examples mode queries.
  // Other mode branches (archive/curated) don't SELECT these columns, so the
  // fields are optional to avoid TypeScript errors on rows that don't include them.
  model_disagreement_kind?: string | null;
  human_sunset_majority?: boolean | null;
  // Verification mode extras: Claude's judge (shown distinctly on the card) and
  // the Flickr owner (part of the source label for external_images rows).
  llm_quality?: number | string | null;
  llm_is_sunset?: boolean | null;
  llm_model?: string | null;
  owner?: string | null;
}

/**
 * Transform database row to Snapshot type
 */
export function transformSnapshot(row: SnapshotRow): Snapshot {
  return {
    // WindyWebcam fields
    webcamId: row.webcam_id ?? 0, // 0 = no parent webcam (Flickr/external row)
    title: row.title || 'Unknown',
    viewCount: row.view_count || 0,
    status: row.status || 'unknown',
    images: row.images
      ? typeof row.images === 'string'
        ? JSON.parse(row.images)
        : row.images
      : null,
    location: {
      city: row.city || '',
      region: row.region || '',
      longitude: row.lng ?? 0,
      latitude: row.lat ?? 0,
      country: row.country || '',
      continent: row.continent || '',
    },
    categories: row.categories
      ? typeof row.categories === 'string'
        ? JSON.parse(row.categories)
        : row.categories
      : [],
    lastUpdatedOn: row.last_fetched_at,
    player: row.player
      ? typeof row.player === 'string'
        ? JSON.parse(row.player)
        : row.player
      : null,
    urls: row.urls
      ? typeof row.urls === 'string'
        ? JSON.parse(row.urls)
        : row.urls
      : null,
    phase: row.phase ?? undefined,
    rank: row.rank ?? undefined,
    source: row.source,
    externalId: row.external_id ?? undefined,
    rating: row.webcam_rating ?? undefined,
    orientation: (row.orientation as Orientation) ?? undefined,
    aiRating: row.webcam_ai_rating ?? undefined,
    aiModelVersion: row.webcam_ai_model_version ?? undefined,
    aiRatingBinary: row.webcam_ai_rating_binary ?? undefined,
    aiModelVersionBinary:
      row.webcam_ai_model_version_binary ?? undefined,
    aiRatingRegression: row.webcam_ai_rating_regression ?? undefined,
    aiModelVersionRegression:
      row.webcam_ai_model_version_regression ?? undefined,

    // Claude (LLM) judge — populated in verification/leaderboard reads; absent
    // (undefined) in archive/curated, which don't SELECT these columns.
    llmQuality:
      row.llm_quality == null ? undefined : Number(row.llm_quality),
    llmIsSunset: row.llm_is_sunset ?? undefined,
    llmModel: row.llm_model ?? undefined,
    // Flickr (external_images) owner — part of the source label on the card.
    owner: row.owner ?? undefined,

    // Snapshot metadata
    snapshot: {
      id: row.snapshot_id,
      webcamId: row.webcam_id ?? 0,
      phase: row.phase ?? 'sunset', // Flickr rows have no phase; default for typing
      rank: row.rank,
      initialRating: row.initial_rating,
      calculatedRating: row.calculated_rating,
      aiRating: row.ai_rating,
      firebaseUrl: row.firebase_url,
      firebasePath: row.firebase_path,
      capturedAt: row.captured_at,
      createdAt: row.created_at,
      ratingCount: row.rating_count,
      userRating: row.user_rating ?? undefined,
    },
  };
}
