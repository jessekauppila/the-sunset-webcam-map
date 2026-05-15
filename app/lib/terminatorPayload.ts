import { sql } from '@/app/lib/db';
import type { WindyWebcam } from '@/app/lib/types';

type TerminatorRow = {
  webcam_id: number;
  phase: 'sunrise' | 'sunset';
  rank: number;
  id: number;
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
  images: WindyWebcam['images'] | null;
  urls: WindyWebcam['urls'] | null;
  player: WindyWebcam['player'] | null;
  categories: Array<{ id: string; name: string }> | null;
  last_fetched_at: string;
  created_at: string;
  updated_at: string;
  rating: number | null;
  orientation: string | null;
  ai_rating: number | string | null;
  ai_model_version: string | null;
  ai_rating_binary: number | string | null;
  ai_model_version_binary: string | null;
  ai_rating_regression: number | string | null;
  ai_model_version_regression: string | null;
  // From LEFT JOIN LATERAL on webcam_snapshots (only populated for source='custom')
  latest_snapshot_url: string | null;
  latest_snapshot_captured_at: string | null;
  // From LEFT JOIN cameras (only populated for source='custom')
  device_class: string | null;
  firmware_version: string | null;
  hardware_id: string | null;
};

const toMaybeNumber = (
  value: number | string | null
): number | undefined => {
  if (value === null || value === undefined) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
};

/**
 * For source='custom' rows: synthesize a minimal Windy-shaped `images`
 * payload from a single snapshot URL. Only `current.preview` is populated —
 * we don't have icon/thumbnail/sizes/daylight assets for custom snapshots
 * and refuse to fabricate them.
 */
export function imagesFromCustomSnapshot(
  url: string | null
): WindyWebcam['images'] | undefined {
  if (!url) return undefined;
  return { current: { preview: url } };
}

export async function fetchTerminatorWebcams(): Promise<WindyWebcam[]> {
  const rows = (await sql`
    select s.webcam_id, s.phase, s.rank,
           w.id, w.source, w.external_id, w.title, w.status, w.view_count,
           w.lat, w.lng, w.city, w.region, w.country, w.continent,
           w.images, w.urls, w.player, w.categories,
           w.last_fetched_at, w.created_at, w.updated_at,
           w.rating, w.orientation, w.ai_rating, w.ai_model_version,
           w.ai_rating_binary, w.ai_model_version_binary,
           w.ai_rating_regression, w.ai_model_version_regression,
           ls.firebase_url      as latest_snapshot_url,
           ls.captured_at       as latest_snapshot_captured_at,
           c.device_class,
           c.firmware_version,
           c.hardware_id
    from terminator_webcam_state s
    join webcams w on w.id = s.webcam_id
    left join cameras c on c.id = w.custom_camera_id
    left join lateral (
      select firebase_url, captured_at
      from webcam_snapshots
      where webcam_id = w.id and w.source = 'custom'
      order by captured_at desc
      limit 1
    ) ls on true
    where s.active = true
    order by case s.phase when 'sunrise' then 0 else 1 end, s.rank
    limit 2000
  `) as TerminatorRow[];

  return rows.map((row) => {
    const hasCustomSnapshot =
      row.source === 'custom' && !!row.latest_snapshot_url;

    const liveAssetKind: WindyWebcam['liveAssetKind'] =
      row.source === 'windy'
        ? 'windy_bundle'
        : hasCustomSnapshot
        ? 'custom_snapshot'
        : undefined;

    return {
      webcamId: row.webcam_id,
      title: row.title ?? '',
      viewCount: row.view_count ?? 0,
      status: row.status ?? 'unknown',
      images:
        row.images ??
        (row.source === 'custom'
          ? imagesFromCustomSnapshot(row.latest_snapshot_url)
          : undefined),
      urls: row.urls ?? undefined,
      player: row.player ?? undefined,
      location: {
        city: row.city ?? '',
        region: row.region ?? '',
        longitude: row.lng,
        latitude: row.lat,
        country: row.country ?? '',
        continent: row.continent ?? '',
      },
      categories: row.categories ?? [],
      lastUpdatedOn: row.last_fetched_at,
      phase: row.phase,
      rank: row.rank,
      source: row.source,
      externalId: row.external_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      rating: row.rating ?? undefined,
      orientation:
        (row.orientation as WindyWebcam['orientation']) ?? undefined,
      aiRating: toMaybeNumber(row.ai_rating),
      aiModelVersion: row.ai_model_version ?? undefined,
      aiRatingBinary: toMaybeNumber(row.ai_rating_binary),
      aiModelVersionBinary: row.ai_model_version_binary ?? undefined,
      aiRatingRegression: toMaybeNumber(row.ai_rating_regression),
      aiModelVersionRegression:
        row.ai_model_version_regression ?? undefined,
      liveAssetKind,
      deviceClass: row.device_class ?? undefined,
      firmwareVersion: row.firmware_version ?? undefined,
      hardwareId: row.hardware_id ?? undefined,
      latestSnapshotCapturedAt: hasCustomSnapshot
        ? row.latest_snapshot_captured_at ?? undefined
        : undefined,
    };
  });
}
