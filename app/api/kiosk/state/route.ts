import { NextResponse } from 'next/server';
import { getKioskDoze, markKioskPoll } from '@/app/lib/cache';
import { getLiveSettingsCached } from '@/app/lib/settings/liveSettings';

export const dynamic = 'force-dynamic';

// Redis-first read: this is the endpoint dozing kiosks poll once a minute, so
// the hot path must never touch Neon. Live settings ride the same response via
// a Redis mirror (written on Deploy); Neon is read ONLY on a cold cache miss,
// and the result immediately re-warms the mirror.
export async function GET() {
  const [doze, settings] = await Promise.all([
    getKioskDoze(),
    getLiveSettingsCached(),
  ]);
  void markKioskPoll();
  return NextResponse.json({ doze, settings });
}
