//Api for fetching webcams from my own database

import { NextResponse } from 'next/server';
import { fetchTerminatorWebcams } from '@/app/lib/terminatorPayload';
import {
  getCachedTerminatorPayload,
  setCachedTerminatorPayload,
} from '@/app/lib/cache';
import type { WindyWebcam } from '@/app/lib/types';

export async function GET() {
  const cached = await getCachedTerminatorPayload<WindyWebcam[]>();
  if (cached) {
    return NextResponse.json(cached);
  }
  const webcams = await fetchTerminatorWebcams();

  setCachedTerminatorPayload(webcams).catch((error) => {
    console.error('Failed to populate terminator cache:', error);
  });

  return NextResponse.json(webcams);
}
