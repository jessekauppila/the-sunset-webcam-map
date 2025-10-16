import type { Snapshot } from './types';

// Database row structure from JOIN query
export interface SnapshotRow {
  snapshot_id: number;
  webcam_id: number;
  phase: 'sunrise' | 'sunset';
  rank: number | null;
  initial_rating: number;
  calculated_rating: number | null;
  ai_rating: number | null;
  firebase_url: string;
  firebase_path: string;
  captured_at: string;
  created_at: string;
  rating_count: number;
  user_rating: number | null;
  // Webcam fields
  w_id: number;
  source: string;
  external_id: string;
  title: string | null;
  status: string | null;
  view_count: number | null;
  lat: number;
  lng: number;
  city: string | null;
  region: string | null;
  country: string | null;
  continent: string | null;
  images: any;
  urls: any;
  player: any;
  categories: any;
  last_fetched_at: string;
  webcam_rating: number | null;
  orientation: string | null;
}

/**
 * Transform database row to Snapshot type
 */
export function transformSnapshot(row: SnapshotRow): Snapshot {
  return {
    // WindyWebcam fields
    webcamId: row.webcam_id,
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
      longitude: row.lng,
      latitude: row.lat,
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
    phase: row.phase,
    rank: row.rank,
    source: row.source,
    externalId: row.external_id,
    rating: row.webcam_rating || undefined,
    orientation: row.orientation as any,

    // Snapshot metadata
    snapshot: {
      id: row.snapshot_id,
      webcamId: row.webcam_id,
      phase: row.phase,
      rank: row.rank,
      initialRating: row.initial_rating,
      calculatedRating: row.calculated_rating,
      aiRating: row.ai_rating,
      firebaseUrl: row.firebase_url,
      firebasePath: row.firebase_path,
      capturedAt: row.captured_at,
      createdAt: row.created_at,
      ratingCount: row.rating_count,
      userRating: row.user_rating || undefined,
    },
  };
}
