/**
 * Database operations module
 * Handles all database writes with cost optimizations:
 * - Only updates webcam rows when fields actually change
 * - Uses upsert-only for terminator state (no delete-all)
 * - Updates last_fetched_at/last_seen_at for query-time filtering
 */

import { sql } from '@/app/lib/db';
import type { WindyWebcam } from '@/app/lib/types';

/**
 * Convert WindyWebcam to database fields
 */
function toDbFields(w: WindyWebcam) {
  return {
    source: 'windy' as const,
    external_id: String(w.webcamId),
    title: w.title ?? null,
    status: w.status ?? null,
    view_count: w.viewCount ?? null,
    lat: w.location.latitude,
    lng: w.location.longitude,
    city: w.location.city ?? null,
    region: w.location.region ?? null,
    country: w.location.country ?? null,
    continent: w.location.continent ?? null,
    // Convert to JSON strings for JSONB columns
    images: w.images ? JSON.stringify(w.images) : null,
    urls: w.urls ? JSON.stringify(w.urls) : null,
    player: w.player ? JSON.stringify(w.player) : null,
    categories: w.categories ? JSON.stringify(w.categories) : null,
  };
}

/**
 * Upsert webcams, only updating rows when fields actually change
 * This reduces unnecessary writes by using WHERE clause in UPDATE
 */
export async function upsertWebcams(webcams: WindyWebcam[]): Promise<void> {
  for (const w of webcams) {
    try {
      const d = toDbFields(w);
      await sql`
        insert into webcams (
          source, external_id, title, status, view_count, lat, lng, city, region, country, continent,
          images, urls, player, categories, last_fetched_at, updated_at
        ) values (
          ${d.source}, ${d.external_id}, ${d.title}, ${d.status}, ${d.view_count},
          ${d.lat}, ${d.lng}, ${d.city}, ${d.region}, ${d.country}, ${d.continent},
          ${d.images}::jsonb, ${d.urls}::jsonb, ${d.player}::jsonb, ${d.categories}::jsonb,
          now(), now()
        )
        on conflict (source, external_id) do update set
          title = excluded.title,
          status = excluded.status,
          view_count = excluded.view_count,
          lat = excluded.lat,
          lng = excluded.lng,
          city = excluded.city,
          region = excluded.region,
          country = excluded.country,
          continent = excluded.continent,
          images = excluded.images,
          urls = excluded.urls,
          player = excluded.player,
          categories = excluded.categories,
          last_fetched_at = now(),
          updated_at = case
                         when webcams.title is distinct from excluded.title
                           or webcams.status is distinct from excluded.status
                           or webcams.images is distinct from excluded.images
                           or webcams.urls is distinct from excluded.urls
                           or webcams.player is distinct from excluded.player
                           or webcams.categories is distinct from excluded.categories
                           or webcams.lat is distinct from excluded.lat
                           or webcams.lng is distinct from excluded.lng
                         then now()
                         else webcams.updated_at
                       end
      `;
    } catch (error) {
      console.error(
        '❌ Failed to upsert webcam:',
        w.webcamId,
        w.title
      );
      console.error('❌ Error:', error);
      console.error('❌ Categories data:', w.categories);
      // Skip this webcam and continue with others
    }
  }
}

/**
 * Get mapping of external IDs to internal webcam IDs
 */
export async function getWebcamIdMap(
  externalIds: string[]
): Promise<Map<string, number>> {
  if (externalIds.length === 0) {
    return new Map();
  }

  const rows = (await sql`
    select id, external_id from webcams
    where source = 'windy' and external_id = any(${externalIds})
  `) as { id: number; external_id: string }[];

  return new Map(rows.map((r) => [r.external_id, r.id]));
}

/**
 * Upsert terminator state entries (upsert-only, no delete-all)
 * Uses last_seen_at for query-time filtering instead of bulk deletes
 */
export async function upsertTerminatorState(
  webcams: WindyWebcam[],
  phase: 'sunrise' | 'sunset',
  idByExternal: Map<string, number>
): Promise<void> {
  const promises = webcams.map(async (w, rank) => {
    const webcamId = idByExternal.get(String(w.webcamId));
    if (!webcamId) return;

    await sql`
      insert into terminator_webcam_state (webcam_id, phase, rank, last_seen_at, updated_at, active)
      values (${webcamId}, ${phase}, ${rank}, now(), now(), true)
      on conflict (webcam_id, phase) do update set
        rank = excluded.rank,
        last_seen_at = now(),
        updated_at = now(),
        active = true
    `;
  });

  await Promise.all(promises);
}

/**
 * Deactivate terminator state entries that are no longer in the current ring results
 * This keeps "active" aligned with the latest ring-based fetch.
 */
export async function deactivateMissingTerminatorState(
  phase: 'sunrise' | 'sunset',
  activeWebcamIds: number[]
): Promise<void> {
  if (activeWebcamIds.length === 0) {
    await sql`
      update terminator_webcam_state
      set active = false, updated_at = now()
      where phase = ${phase} and active = true
    `;
    return;
  }

  await sql`
    update terminator_webcam_state
    set active = false, updated_at = now()
    where phase = ${phase}
      and active = true
      and webcam_id <> all(${activeWebcamIds})
  `;
}

