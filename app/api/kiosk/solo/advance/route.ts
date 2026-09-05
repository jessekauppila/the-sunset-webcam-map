import { NextResponse } from 'next/server';
import { getLiveSettingsCached } from '@/app/lib/settings/liveSettings';
import { mergeSettings } from '@/app/lib/settings/schema';
import { afterShowing, next } from '@/app/lib/solo/engine';
import { slotFor } from '@/app/lib/solo/schedule';
import { SOLO_NAMESPACE, SOLO_SETTINGS_SCHEMA, dialsFrom } from '@/app/lib/solo/settingsSchema';
import { commitAdvance, countAdmittedSince, getScreenState, listActiveEntries } from '@/app/lib/solo/store';
import { buildStateView, parseFeed } from '../view';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const LAST_PULL_WINDOW_MS = 10 * 60 * 1000;
/** A tab's clock may drift a little; anything further off is a bug, not a boundary. */
const SLOT_TOLERANCE = 1;

/**
 * The kiosk's "what's next" at a schedule boundary (spec §6.1, §6.2).
 * Unauthenticated like /api/kiosk/tick: the kiosk page is public and cannot
 * hold a credential. Idempotent on `slot`, so a double-fire or a second tab
 * lands on the same frame.
 */
export async function POST(request: Request) {
  let body: { feed?: unknown; slot?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }
  const feed = parseFeed(typeof body.feed === 'string' ? body.feed : null);
  const slot = typeof body.slot === 'number' && Number.isInteger(body.slot) ? body.slot : null;
  if (!feed || slot === null) {
    return NextResponse.json({ error: 'feed and integer slot required' }, { status: 400 });
  }

  const live = await getLiveSettingsCached();
  const dials = dialsFrom(mergeSettings(SOLO_SETTINGS_SCHEMA, live?.namespaces[SOLO_NAMESPACE]));
  const nowMs = Date.now();
  const serverSlot = slotFor(nowMs, feed, dials.dwellS, dials.offsetS);
  if (Math.abs(slot - serverSlot) > SLOT_TOLERANCE) {
    return NextResponse.json({ error: `slot ${slot} is not near ${serverSlot}` }, { status: 400 });
  }

  const [entries, screenBefore] = await Promise.all([listActiveEntries(feed), getScreenState(feed)]);
  let advanced = false;
  let screen = screenBefore;
  if (screenBefore?.slot !== slot) {
    const state = {
      lastSnapshotId: screenBefore?.currentSnapshotId ?? null,
      sunsetStreak: screenBefore?.sunsetStreak ?? 0,
    };
    const pick = next(entries, dials, state);
    if (pick) {
      const after = afterShowing(pick, state);
      advanced = await commitAdvance(feed, slot, pick, after.sunsetStreak);
      if (advanced) {
        const stored = entries.find((e) => e.snapshotId === pick.snapshotId)!;
        stored.tally += 1;
        stored.isNew = false;
        screen = { feed, currentSnapshotId: pick.snapshotId, shownSince: nowMs, slot, sunsetStreak: after.sunsetStreak };
      }
    }
  }
  const admitted = await countAdmittedSince(feed, nowMs - LAST_PULL_WINDOW_MS);
  return NextResponse.json({
    advanced,
    ...buildStateView({ feed, dials, entries, screen, nowMs, admitted }),
  });
}
