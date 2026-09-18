import { after, NextRequest, NextResponse } from 'next/server';
import { getLiveSettingsCached } from '@/app/lib/settings/liveSettings';
import { mergeSettings } from '@/app/lib/settings/schema';
import { SHARED_NAMESPACE, SHARED_SCHEMA } from '@/app/lib/settings/sharedSchema';
import { withCaption } from '@/app/lib/solo/captionSchema';
import { SOLO_VERSIONS, type SoloVersionSpec } from '@/app/lib/solo/versions';
import { getScreenState, listActiveEntries } from '@/app/lib/solo/store';
import { advanceIfDue } from '@/app/lib/solo/advance';
import type { Solo2Dials } from '@/app/lib/solo2/types';
import { BUILD_ID } from '@/app/lib/buildStamp';
import { parseFeed, toViewEntry } from '@/app/api/kiosk/solo/view';
import { buildMirrorView, MIRROR_CACHE_CONTROL } from '../view';
import { countMirrorCall } from '@/app/lib/mirrorTraffic';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * What every follower of one feed reads (mirror spec §4.1): the glass and
 * the public pages alike. Public, no profile, solo2 fixed. Two Neon reads,
 * then advance on read: if the stored dwell is over, this request draws the
 * next slot before answering, idempotently. Only this live path advances;
 * the studio's re-projection never does.
 */
export async function GET(request: NextRequest) {
  const feed = parseFeed(request.nextUrl.searchParams.get('feed'));
  if (!feed) return NextResponse.json({ error: 'feed must be sunrise or sunset' }, { status: 400 });
  // The edge cache keys on the full URL. Any parameter beyond `feed` would be
  // a fresh key and a fresh origin call, and the cost ceiling (one call per
  // second per feed per region) exists only if the key space is two URLs.
  for (const key of request.nextUrl.searchParams.keys()) {
    if (key !== 'feed') return NextResponse.json({ error: 'only feed is accepted' }, { status: 400 });
  }
  // A REPEATED `feed` is the same hole by another door: `get` reads the first
  // value, so `?feed=sunset&feed=x1`, `&feed=x2`, … all answer for sunset while
  // each is a fresh key and a fresh origin call. The key space is two URLs only
  // if `feed` appears exactly once.
  if (request.nextUrl.searchParams.getAll('feed').length !== 1) {
    return NextResponse.json({ error: 'only feed is accepted' }, { status: 400 });
  }
  // The digest's tripwire (#238): counted after the response has gone, so a
  // slow or failing Redis never delays a screen. A 503 is counted too; a
  // follower retrying a failure is still load.
  after(() => countMirrorCall(feed));

  try {
    const version = SOLO_VERSIONS.solo2 as SoloVersionSpec;

    const live = await getLiveSettingsCached();
    const shared = live?.namespaces[SHARED_NAMESPACE];
    // Built exactly as /api/kiosk/solo/state builds them, so a follower needs no settings fetch of its own.
    const dials = version.dialsFrom(withCaption(mergeSettings(version.schema, live?.namespaces[version.namespace]), shared)) as Solo2Dials;
    const panelPreset = String(mergeSettings(SHARED_SCHEMA, shared).panelPreset);
    const activeVersion = String(mergeSettings(SHARED_SCHEMA, shared).activeVersion);

    const nowMs = Date.now();
    const [entries, screenBefore] = await Promise.all([listActiveEntries(feed), getScreenState(feed)]);
    // No slack (the default): this advance runs on the server's own clock, so a
    // refresh landing a moment early must not cut a dwell short. Only the
    // kiosk's POST, whose clock is its own, gets the half-beat (`kioskSlackMs`).
    //
    // Only the live version's engine draws (mirror spec §4.1, "only the live
    // path advances"). With the glass on another version this route still
    // projects, so a follower shows the row, but it never draws over a schedule
    // another engine is driving.
    const { screen } = activeVersion === version.name
      ? await advanceIfDue({ feed, version, dials, entries, screenBefore, nowMs })
      : { screen: screenBefore };
    const body = buildMirrorView({ feed, dials, entries: entries.map(toViewEntry), screen, nowMs, panelPreset, build: BUILD_ID });
    return NextResponse.json(body, { headers: { 'Cache-Control': MIRROR_CACHE_CONTROL } });
  } catch (error) {
    // This route is the only path that advances solo2, and every follower
    // retries once a second for ten seconds when it fails. The 503 is
    // uncached like the success (#238), so during an outage each follower
    // reaches the database once a second; at a handful of viewers that is
    // the accepted price, and the digest shows when it stops being a handful.
    console.error(`[mirror/state] ${feed} failed:`, error);
    return NextResponse.json({ error: 'mirror unavailable' }, { status: 503, headers: { 'Cache-Control': MIRROR_CACHE_CONTROL } });
  }
}
