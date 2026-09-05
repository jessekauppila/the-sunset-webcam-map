import { NextRequest, NextResponse } from 'next/server';
import { requireOwner } from '@/app/lib/owner';
import { getLiveSettingsCached } from '@/app/lib/settings/liveSettings';
import { getProfileSettings } from '@/app/lib/settings/store';
import { mergeSettings } from '@/app/lib/settings/schema';
import { SOLO_NAMESPACE, SOLO_SETTINGS_SCHEMA, dialsFrom } from '@/app/lib/solo/settingsSchema';
import { countAdmittedSince, getScreenState, listActiveEntries } from '@/app/lib/solo/store';
import { buildStateView, parseFeed } from '../view';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** "Last pull added": the cron runs every 10 min; count what entered in that window. */
const LAST_PULL_WINDOW_MS = 10 * 60 * 1000;

/**
 * One feed's bins, queue, and what is on glass (spec §6.1). The kiosk reads
 * it with the live profile; the studio passes ?profile=studio (owner-gated)
 * so the "next up" column reflects dials that are not deployed yet.
 */
export async function GET(request: NextRequest) {
  const feed = parseFeed(request.nextUrl.searchParams.get('feed'));
  if (!feed) return NextResponse.json({ error: 'feed must be sunrise or sunset' }, { status: 400 });

  const studio = request.nextUrl.searchParams.get('profile') === 'studio';
  if (studio) {
    const denied = await requireOwner();
    if (denied) return denied;
  }
  const profile = studio ? await getProfileSettings('studio') : await getLiveSettingsCached();
  const dials = dialsFrom(mergeSettings(SOLO_SETTINGS_SCHEMA, profile?.namespaces[SOLO_NAMESPACE]));

  const nowMs = Date.now();
  const [entries, screen, admitted] = await Promise.all([
    listActiveEntries(feed),
    getScreenState(feed),
    countAdmittedSince(feed, nowMs - LAST_PULL_WINDOW_MS),
  ]);
  return NextResponse.json(buildStateView({ feed, dials, entries, screen, nowMs, admitted }));
}
