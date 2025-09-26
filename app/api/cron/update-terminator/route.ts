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
      'x-windy-api-key': process.env.WINDY_ACCESS_TOKEN || '',
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

  const now = new Date();
  const { raHours, gmstHours } = subsolarPoint(now);
  const { sunriseCoords, sunsetCoords } = createTerminatorRing(
    now,
    raHours,
    gmstHours
  );

  // Fetch webcams at coords; de-dup by provider id
  const coords = [...sunriseCoords, ...sunsetCoords];
  const batches = await Promise.all(
    coords.map((c) => fetchWebcamsFor(c))
  );
  const windyById = new Map<number, WindyWebcam>();
  for (const b of batches)
    for (const w of b) windyById.set(w.webcamId, w);

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
    images: (w.images ?? null) as Json,
    urls: (w.urls ?? null) as Json,
    player: (w.player ?? null) as Json,
    categories: (w.categories ?? null) as Json,
  });

  const upsertWebcam = async (w: WindyWebcam) => {
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
        updated_at = now()
    `;
  };

  const windyAll = [...windyById.values()].filter((w) => w.location);
  const sunriseList = [...windyAll].sort(
    (a, b) => b.location.longitude - a.location.longitude
  );
  const sunsetList = [...windyAll].sort(
    (a, b) => a.location.longitude - b.location.longitude
  );

  await Promise.all(windyAll.map(upsertWebcam));

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
