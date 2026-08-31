import { NextRequest, NextResponse } from 'next/server';
import { getKioskDoze, markKioskPoll } from '@/app/lib/cache';
import { getLiveSettingsCached } from '@/app/lib/settings/liveSettings';

export const dynamic = 'force-dynamic';

// Redis-first read: this is the endpoint dozing kiosks poll once a minute, so
// the hot path must never touch Neon. Live settings ride the same response via
// a Redis mirror (written on Deploy, TTL'd at 300s); Neon is read ONLY on a
// cold cache miss, and the result immediately re-warms the mirror — so a
// failed or stale write self-heals within minutes rather than staying wrong
// indefinitely.
//
// This route is also hit by callers that aren't the kiosk's own poll loop
// (e.g. the Ops drawer's DozeControl), so "poll freshness" is only marked
// when the request carries ?kiosk=1 — the marker used by useKioskRuntime.
export async function GET(request: NextRequest) {
  const isKioskPoll = request.nextUrl.searchParams.get('kiosk') === '1';
  const [doze, settings] = await Promise.all([
    getKioskDoze(),
    getLiveSettingsCached(),
  ]);
  if (isKioskPoll) void markKioskPoll();
  return NextResponse.json({ doze, settings });
}
