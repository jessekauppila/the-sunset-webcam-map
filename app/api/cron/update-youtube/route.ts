//http://localhost:3000/api/cron/update-youtube?secret=

//temporarlly disabled from vercel.json
// {
//   "path": "/api/cron/update-youtube",
//   "schedule": " * */1 * * *"
// }

import { NextResponse } from 'next/server';
import { sql } from '@/app/lib/db';
import { subsolarPoint } from '@/app/components/Map/lib/subsolarLocation';
import { createTerminatorRing } from '@/app/components/Map/lib/terminatorRing';
import type { Location } from '@/app/lib/types';
import {
  TERMINATOR_PRECISION_DEG,
  SEARCH_RADIUS_DEG,
} from '@/app/lib/terminatorConfig';

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
  radiusKm: number // Now required - passed from caller using SEARCH_RADIUS_DEG
): Promise<(YTItem & { searchLocation: Location })[]> {
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
  if (!res.ok) {
    console.log(
      `YouTube API error for ${loc.lat},${loc.lng}: ${res.status} ${res.statusText}`
    );
    // Add this to see the actual error response:
    const errorText = await res.text();
    console.log(`YouTube API error details:`, errorText);
    return [];
  }
  const data = await res.json();
  const items = (data.items || []).map((item: YTItem) => ({
    ...item,
    searchLocation: loc,
  }));
  console.log(
    `Found ${items.length} YouTube live streams near ${loc.lat},${loc.lng}`
  );
  return items;
}

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization');
  const isVercelCron =
    authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const { searchParams } = new URL(req.url);
  const secret = searchParams.get('secret');
  const isUrlSecret = secret === process.env.CRON_SECRET;

  console.log('🔍 Debug - Vercel cron header:', authHeader);
  console.log('🔍 Debug - Secret from URL:', secret);
  console.log(
    '🔍 Debug - CRON_SECRET env var:',
    process.env.CRON_SECRET ? 'SET' : 'NOT SET'
  );
  console.log('🔍 Debug - Is Vercel cron:', isVercelCron);
  console.log('🔍 Debug - Is URL secret valid:', isUrlSecret);

  if (!isVercelCron && !isUrlSecret) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  // Check if YouTube API key is configured
  // Check if YouTube API key is configured
  if (!process.env.YOUTUBE_API_KEY) {
    console.log(
      'YouTube API key not configured, skipping YouTube update'
    );
    return NextResponse.json({
      ok: true,
      message: 'YouTube API key not configured',
    });
  }

  console.log(
    `🔍 YouTube API key is configured: ${
      process.env.YOUTUBE_API_KEY ? 'YES' : 'NO'
    }`
  );

  const now = new Date();
  const { raHours, gmstHours } = subsolarPoint(now);
  
  // Use configured precision from terminatorConfig.ts
  const { sunriseCoords, sunsetCoords } = createTerminatorRing(
    now,
    raHours,
    gmstHours,
    TERMINATOR_PRECISION_DEG
  );

  // No midpoint sampling - precision is controlled directly via precisionDeg parameter
  const allCoords = [...sunriseCoords, ...sunsetCoords];

  console.log(`🔍 Total coordinates to search: ${allCoords.length}`);
  console.log(`🔍 First few coordinates:`, allCoords.slice(0, 3));

  // Batch requests to respect quotas
  const batchSize = 5;
  const delayMs = 800; // between batches
  // Convert SEARCH_RADIUS_DEG to km: 1° ≈ 111 km
  const searchRadiusKm = SEARCH_RADIUS_DEG * 111;
  const ytItems: (YTItem & { searchLocation: Location })[] = [];
  for (let i = 0; i < allCoords.length; i += batchSize) {
    const batch = allCoords.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map((c) => searchYouTubeLiveNear(c, searchRadiusKm))
    );
    for (const arr of results) ytItems.push(...arr);
    if (i + batchSize < allCoords.length) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  console.log(`🔍 Total YouTube items collected: ${ytItems.length}`);

  // Dedupe by videoId, keeping the first occurrence (closest to terminator)
  const byId = new Map<
    string,
    YTItem & { searchLocation: Location }
  >();
  for (const it of ytItems) {
    const id = it.id?.videoId;
    if (!id) continue;
    if (!byId.has(id)) byId.set(id, it);
  }

  console.log(
    `Total YouTube items found: ${ytItems.length}, after deduplication: ${byId.size}`
  );

  // Map to DB shape
  const rows = Array.from(byId.values()).map((it) => {
    const id = it.id.videoId;
    return {
      source: 'youtube' as const,
      external_id: id,
      title: it.snippet?.title ?? null,
      status: 'active' as const,
      view_count: null,
      lat: it.searchLocation.lat,
      lng: it.searchLocation.lng,
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

  // Upsert webcams
  console.log(`Upserting ${rows.length} YouTube webcams to database`);
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

  // Add YouTube webcams to terminator_webcam_state so they show up in the app
  console.log(`Adding YouTube webcams to terminator_webcam_state`);
  const youtubeWebcamIds = await sql`
    select id from webcams 
    where source = 'youtube' and external_id = any(${currentIds})
  `;

  // Clear existing YouTube entries from terminator_webcam_state
  await sql`
    delete from terminator_webcam_state 
    where webcam_id in (select id from webcams where source = 'youtube')
  `;

  // Add new YouTube entries to terminator_webcam_state
  if (youtubeWebcamIds.length > 0) {
    const terminatorEntries = (
      youtubeWebcamIds as { id: number }[]
    ).map((row, index: number) => ({
      webcam_id: row.id,
      phase: 'sunset' as const, // YouTube streams are typically sunset-oriented
      rank: index + 1,
      active: true,
    }));

    for (const entry of terminatorEntries) {
      await sql`
        insert into terminator_webcam_state (webcam_id, phase, rank, active)
        values (${entry.webcam_id}, ${entry.phase}, ${entry.rank}, ${entry.active})
        on conflict (webcam_id, phase) do update set
          rank = excluded.rank,
          active = excluded.active
      `;
    }
    console.log(
      `Added ${terminatorEntries.length} YouTube webcams to terminator_webcam_state`
    );
  }

  return NextResponse.json({ ok: true, upserted: rows.length });
}
