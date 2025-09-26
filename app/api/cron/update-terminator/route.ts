//

import { NextResponse } from 'next/server';
import { sql } from '@/app/lib/db';
import { subsolarPoint } from '@/app/components/Map/lib/subsolarLocation';
import { createTerminatorRing } from '@/app/components/Map/lib/terminatorRing';
import type { Location, WindyWebcam } from '@/app/lib/types';

async function fetchWebcamsFor(loc: Location) {
  const url = `https://api.windy.com/webcams/api/v3/map/clusters?lang=en&northLat=${
    loc.lat + 5
  }&southLat=${loc.lat - 5}&eastLon=${loc.lng + 5}&westLon=${
    loc.lng - 5
  }&zoom=4&include=images&include=urls&include=player&include=location&include=categories`;
  const res = await fetch(url, {
    headers: {
      accept: 'application/json',
      'x-windy-api-key':
        process.env.NEXT_PUBLIC_WINDY_ACCESS_TOKEN || '',
    },
    cache: 'no-store',
  });
  if (!res.ok) return [] as WindyWebcam[];
  const data: WindyWebcam[] = await res.json();
  return data ?? [];
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const secret = searchParams.get('secret');
  if (!secret || secret !== process.env.CRON_SECRET)
    return new NextResponse('Unauthorized', { status: 401 });

  console.log('🚀 Starting cron job...');

  const now = new Date();
  const { raHours, gmstHours } = subsolarPoint(now);
  const { sunriseCoords, sunsetCoords } = createTerminatorRing(
    now,
    raHours,
    gmstHours
  );

  console.log('📍 Coords:', {
    sunrise: sunriseCoords.length,
    sunset: sunsetCoords.length,
  });

  // Fetch webcams at coords; de-dup by provider id
  const coords = [...sunriseCoords, ...sunsetCoords];
  console.log(
    '🌐 Fetching webcams for',
    coords.length,
    'coordinates...'
  );

  const batches = await Promise.all(
    coords.map((c) => fetchWebcamsFor(c))
  );
  console.log('📦 Batches received:', batches.length);

  const windyById = new Map<number, WindyWebcam>();
  for (const b of batches) {
    console.log('📹 Batch size:', b.length);
    for (const w of b) windyById.set(w.webcamId, w);
  }

  console.log('🗂️ Total unique webcams:', windyById.size);

  type Json =
    | Record<string, unknown>
    | unknown[]
    | string
    | number
    | boolean
    | null;

  const toDbFields = (w: WindyWebcam) => ({
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
  });

  const upsertWebcam = async (w: WindyWebcam) => {
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
  };

  const windyAll = [...windyById.values()].filter((w) => w.location);
  const sunriseList = [...windyAll].sort(
    (a, b) => b.location.longitude - a.location.longitude
  );
  const sunsetList = [...windyAll].sort(
    (a, b) => a.location.longitude - b.location.longitude
  );

  await Promise.all(windyAll.map(upsertWebcam));

  // Mark webcams not found in current fetch as inactive
  const currentExternalIds = windyAll.map((w) => String(w.webcamId));

  // Mark all Windy webcams as inactive first, then reactivate the ones we found
  await sql`
    update webcams 
    set status = 'inactive', updated_at = now()
    where source = 'windy' and status != 'inactive'
  `;

  // Reactivate the webcams we just found
  if (currentExternalIds.length > 0) {
    await sql`
      update webcams 
      set status = 'active', updated_at = now()
      where source = 'windy' and external_id = any(${currentExternalIds})
    `;
  }

  const ids = windyAll.map((w) => String(w.webcamId));

  // Map external ids -> internal ids
  const rows = (await sql`
    select id, external_id from webcams
    where source = 'windy' and external_id = any(${ids})
  `) as { id: number; external_id: string }[];
  const idByExternal = new Map(
    rows.map((r) => [r.external_id, r.id])
  );

  // Upsert current snapshot state
  const upsertState = async (
    w: WindyWebcam,
    phase: 'sunrise' | 'sunset',
    rank: number
  ) => {
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
  };

  await Promise.all(
    sunriseList.map((w, i) => upsertState(w, 'sunrise', i))
  );
  await Promise.all(
    sunsetList.map((w, i) => upsertState(w, 'sunset', i))
  );

  // Deactivate stale
  const active = (await sql`
    select webcam_id, phase from terminator_webcam_state where active = true
  `) as { webcam_id: number; phase: 'sunrise' | 'sunset' }[];
  const seenSunriseSet = new Set(
    sunriseList.map((w) => idByExternal.get(String(w.webcamId)))
  );
  const seenSunsetSet = new Set(
    sunsetList.map((w) => idByExternal.get(String(w.webcamId)))
  );
  const toDeactivate: number[] = [];
  for (const r of active) {
    if (
      (r.phase === 'sunrise' && !seenSunriseSet.has(r.webcam_id)) ||
      (r.phase === 'sunset' && !seenSunsetSet.has(r.webcam_id))
    ) {
      toDeactivate.push(r.webcam_id);
    }
  }
  if (toDeactivate.length) {
    await sql`
    update terminator_webcam_state
    set active = false, updated_at = now()
    where webcam_id = any(${toDeactivate})
  `;
  }

  return NextResponse.json({
    ok: true,
    sunrise: sunriseList.length,
    sunset: sunsetList.length,
  });
}
