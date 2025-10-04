import { NextResponse } from 'next/server';
import { sql } from '@/app/lib/db';
import { subsolarPoint } from '@/app/components/Map/lib/subsolarLocation';
import { createTerminatorRing } from '@/app/components/Map/lib/terminatorRing';
import type { Location } from '@/app/lib/types';

type YTItem = {
  id: { videoId: string };
  snippet: {
    title: string;
    liveBroadcastContent?: string;
    // location details are only present if uploader set them
    // we'll keep lat/lng optional
    // channelTitle, thumbnails, etc. ignored
  };
};

async function searchYouTubeLiveNear(
  loc: Location,
  radiusKm = 400
): Promise<YTItem[]> {
  const key = process.env.YOUTUBE_API_KEY || '';
  if (!key) return [];

  const params = new URLSearchParams({
    part: 'snippet',
    eventType: 'live',
    type: 'video',
    location: `${loc.lat},${loc.lng}`,
    locationRadius: `${radiusKm}km`,
    maxResults: '50',
    key,
  });

  const url = `https://www.googleapis.com/youtube/v3/search?${params.toString()}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.items || []) as YTItem[];
}

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization');
  const isVercelCron =
    authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const { searchParams } = new URL(req.url);
  const secret = searchParams.get('secret');
  const isUrlSecret = secret === process.env.CRON_SECRET;
  if (!isVercelCron && !isUrlSecret) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const now = new Date();
  const { raHours, gmstHours } = subsolarPoint(now);
  const { sunriseCoords, sunsetCoords } = createTerminatorRing(
    now,
    raHours,
    gmstHours
  );

  const coords: Location[] = [...sunriseCoords, ...sunsetCoords];
  // Keep midpoint sampling to improve recall
  const additional: Location[] = [];
  for (let i = 0; i < coords.length; i++) {
    const a = coords[i];
    const b = coords[(i + 1) % coords.length];
    additional.push({
      lat: (a.lat + b.lat) / 2,
      lng: (a.lng + b.lng) / 2,
    });
  }
  const allCoords = [...coords, ...additional];

  // Batch requests to respect quotas
  const batchSize = 5;
  const delayMs = 800; // between batches
  const ytItems: YTItem[] = [];
  for (let i = 0; i < allCoords.length; i += batchSize) {
    const batch = allCoords.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map((c) => searchYouTubeLiveNear(c, 400))
    );
    for (const arr of results) ytItems.push(...arr);
    if (i + batchSize < allCoords.length) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  // Dedupe by videoId
  const byId = new Map<string, YTItem>();
  for (const it of ytItems) {
    const id = it.id?.videoId;
    if (!id) continue;
    if (!byId.has(id)) byId.set(id, it);
  }

  // Map to DB shape
  const rows = Array.from(byId.values()).map((it) => {
    const id = it.id.videoId;
    return {
      source: 'youtube' as const,
      external_id: id,
      title: it.snippet?.title ?? null,
      status: 'active' as const,
      view_count: null,
      lat: null,
      lng: null,
      city: null,
      region: null,
      country: null,
      continent: null,
      images: null,
      urls: JSON.stringify({
        detail: `https://youtube.com/watch?v=${id}`,
      }),
      player: JSON.stringify({
        hls: `https://www.youtube.com/watch?v=${id}`,
      }),
      categories: null,
    };
  });

  // Upsert
  for (const d of rows) {
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
  }

  // Reactivate current YouTube entries, deactivate stale
  const currentIds = rows.map((r) => r.external_id);
  await sql`
    update webcams
    set status = 'inactive', updated_at = now()
    where source = 'youtube' and status != 'inactive'
  `;
  if (currentIds.length > 0) {
    await sql`
      update webcams
      set status = 'active', updated_at = now()
      where source = 'youtube' and external_id = any(${currentIds})
    `;
  }

  return NextResponse.json({ ok: true, upserted: rows.length });
}
