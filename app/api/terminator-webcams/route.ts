//Api for fetching webcams from my own database

import { NextResponse } from 'next/server';
import { sql } from '@/app/lib/db';

export async function GET() {
  const rows = (await sql`
    select s.webcam_id, s.phase, s.rank,
           w.lat, w.lng, w.title, w.images, w.source
    from terminator_webcam_state s
    join webcams w on w.id = s.webcam_id
    where s.active = true
    order by case s.phase when 'sunrise' then 0 else 1 end, s.rank
    limit 2000
  `) as Array<{
    webcam_id: number;
    phase: 'sunrise' | 'sunset';
    rank: number;
    lat: number;
    lng: number;
    title: string | null;
    images: unknown | null;
    source: string;
  }>;

  return NextResponse.json(rows);
}
