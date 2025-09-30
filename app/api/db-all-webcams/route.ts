//API for fetching ALL webcams from database (not just terminator ones)

import { NextResponse } from 'next/server';
import { sql } from '@/app/lib/db';
import type { WindyWebcam } from '@/app/lib/types';

export async function GET() {
  const rows = (await sql`
    select w.id, w.source, w.external_id, w.title, w.status, w.view_count,
           w.lat, w.lng, w.city, w.region, w.country, w.continent,
           w.images, w.urls, w.player, w.categories,
           w.last_fetched_at, w.created_at, w.updated_at,
           w.rating, w.orientation
    from webcams w
    order by w.updated_at desc
    limit 5000
  `) as Array<{
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
    images: {
      sizes: {
        icon: { width: number; height: number };
        preview: { width: number; height: number };
        thumbnail: { width: number; height: number };
      };
      current: {
        icon: string;
        preview: string;
        thumbnail: string;
      };
      daylight: {
        icon: string;
        preview: string;
        thumbnail: string;
      };
    } | null;
    urls: {
      detail?: string;
      edit?: string;
      provider?: string;
    } | null;
    player: {
      live?: string;
      day?: string;
      month?: string;
      year?: string;
      lifetime?: string;
    } | null;
    categories: Array<{
      id: string;
      name: string;
    }> | null;
    last_fetched_at: string;
    created_at: string;
    updated_at: string;
    rating: number | null;
    orientation: string | null;
  }>;

  // Transform database rows to WindyWebcam format
  const webcams: WindyWebcam[] = rows.map((row) => ({
    webcamId: row.id, // Using internal ID as webcamId for all webcams
    title: row.title ?? '',
    viewCount: row.view_count ?? 0,
    status: row.status ?? 'unknown',
    images: row.images ?? undefined,
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
    source: row.source,
    externalId: row.external_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    rating: row.rating ?? undefined,
    orientation:
      (row.orientation as WindyWebcam['orientation']) ?? undefined,
    // Note: No phase/rank since these aren't terminator-specific
  }));

  return NextResponse.json(webcams);
}
