import { NextRequest, NextResponse } from 'next/server';
import { requireOwner } from '@/app/lib/owner';
import { getLiveSettingsCached } from '@/app/lib/settings/liveSettings';
import { getProfileSettings } from '@/app/lib/settings/store';
import { mergeSettings } from '@/app/lib/settings/schema';
import { resolveSoloVersion } from '@/app/lib/solo/versions';
import { countAdmittedSince, getScreenState, listActiveEntries } from '@/app/lib/solo/store';
import { isFlagEnabled, SWEEP_FORCE_DAY_RING } from '@/app/lib/runtimeFlags';
import { sweepGeometry } from '@/app/api/cron/update-cameras/lib/sweepGeometry';
import { TERMINATOR_DAY_SIDE_OFFSETS_DEG } from '@/app/lib/masterConfig';
import { buildStateView, parseFeed, toViewEntry } from '../view';

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
  // Which version's dials and engine: solo unless told otherwise (solo2 spec §5.2).
  const version = resolveSoloVersion(request.nextUrl.searchParams.get('version'));
  if (!version) return NextResponse.json({ error: 'version must be solo or solo2' }, { status: 400 });

  const studio = request.nextUrl.searchParams.get('profile') === 'studio';
  if (studio) {
    const denied = await requireOwner();
    if (denied) return denied;
  }
  const profile = studio ? await getProfileSettings('studio') : await getLiveSettingsCached();
  const dials = version.dialsFrom(mergeSettings(version.schema, profile?.namespaces[version.namespace]));

  const nowMs = Date.now();
  const [entries, screen, admitted, forcedDayRing] = await Promise.all([
    listActiveEntries(feed),
    getScreenState(feed),
    countAdmittedSince(feed, nowMs - LAST_PULL_WINDOW_MS),
    isFlagEnabled(SWEEP_FORCE_DAY_RING),
  ]);
  // The same zone the cron ages entries against (binAdmission.maintainBins).
  const geometry = sweepGeometry(forcedDayRing ? TERMINATOR_DAY_SIDE_OFFSETS_DEG : []);
  const zone = { minDeg: geometry.coverageMinDeg, maxDeg: geometry.coverageMaxDeg };
  return NextResponse.json(buildStateView({
    feed, dials, entries: entries.map(toViewEntry), screen, nowMs, admitted, zone, version,
  }));
}
