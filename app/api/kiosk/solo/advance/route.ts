import { NextResponse } from 'next/server';
import { getLiveSettingsCached } from '@/app/lib/settings/liveSettings';
import { mergeSettings } from '@/app/lib/settings/schema';
import { afterShowing } from '@/app/lib/solo/engine';
import { resolveSoloVersion } from '@/app/lib/solo/versions';
import { commitAdvance, countAdmittedSince, getScreenState, getSweptZone, listActiveEntries } from '@/app/lib/solo/store';
import { isFlagEnabled, SWEEP_FORCE_DAY_RING } from '@/app/lib/runtimeFlags';
import { sweepGeometry } from '@/app/api/cron/update-cameras/lib/sweepGeometry';
import { TERMINATOR_DAY_SIDE_OFFSETS_DEG } from '@/app/lib/masterConfig';
import { buildStateView, parseFeed, toViewEntry } from '../view';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const LAST_PULL_WINDOW_MS = 10 * 60 * 1000;
/**
 * A slot is a counter now, not a function of the clock (spec §5, step 3), so
 * a posting tab can no longer compute one. The only slot this endpoint will
 * accept is the one after what is stored, which keeps it monotonic per feed
 * for kiosk_draws' (feed, slot) primary key. One behind is the idempotent
 * case: a second tab racing the same advance, which lands as a no-op below.
 */
const SLOT_TOLERANCE = 1;

/**
 * The kiosk's "what's next" at a schedule boundary (spec §6.1, §6.2).
 * Unauthenticated like /api/kiosk/tick: the kiosk page is public and cannot
 * hold a credential. Idempotent on `slot`, so a double-fire or a second tab
 * lands on the same frame.
 */
export async function POST(request: Request) {
  let body: { feed?: unknown; slot?: unknown; version?: unknown };
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
  const version = resolveSoloVersion(typeof body.version === 'string' ? body.version : null);
  if (!version) return NextResponse.json({ error: 'version must be solo or solo2' }, { status: 400 });

  const live = await getLiveSettingsCached();
  const dials = version.dialsFrom(mergeSettings(version.schema, live?.namespaces[version.namespace]));
  const nowMs = Date.now();

  const [entries, screenBefore] = await Promise.all([listActiveEntries(feed), getScreenState(feed)]);
  // Idempotency is now compare-and-set against the observed slot rather than
  // by-value against a clock-derived one. The screen-state upsert below still
  // carries the `is distinct from` guard, so two tabs racing the same advance
  // leave exactly one winner.
  const serverSlot = (screenBefore?.slot ?? -1) + 1;
  if (Math.abs(slot - serverSlot) > SLOT_TOLERANCE) {
    return NextResponse.json({ error: `slot ${slot} is not near ${serverSlot}` }, { status: 400 });
  }
  let advanced = false;
  let screen = screenBefore;
  if (screenBefore?.slot !== slot) {
    const state = {
      lastSnapshotId: screenBefore?.currentSnapshotId ?? null,
      sunsetStreak: screenBefore?.sunsetStreak ?? 0,
    };
    const pick = version.next(entries, dials, state, slot, feed);
    if (pick) {
      const after = afterShowing(pick, state);
      const shown = version.shown(entries, pick, dials);
      // Decided ONCE, here, against the pool this draw actually saw, and
      // stored alongside the start instant. Every surface reads it back
      // rather than working it out again from a pool that has since moved.
      const dwellMs = version.dwellMs(entries, pick, dials);
      advanced = await commitAdvance(feed, slot, pick, after.sunsetStreak, shown, version.name, dwellMs);
      if (advanced) {
        for (const f of shown) {
          const stored = entries.find((e) => e.snapshotId === f.snapshotId)!;
          stored.tally += 1;
          stored.isNew = false;
          stored.lastShownAt = nowMs;
        }
        screen = {
          feed, currentSnapshotId: pick.snapshotId, shownSince: nowMs, slot, sunsetStreak: after.sunsetStreak,
          dwellMs, shownSnapshotIds: shown.map((e) => e.snapshotId),
        };
      }
    }
  }
  const [admitted, sweptZone, forcedDayRing] = await Promise.all([
    countAdmittedSince(feed, nowMs - LAST_PULL_WINDOW_MS),
    getSweptZone(),
    isFlagEnabled(SWEEP_FORCE_DAY_RING),
  ]);
  // Same source as the state route: the zone the cron last used, else the
  // guaranteed rings.
  const geometry = sweepGeometry(forcedDayRing ? TERMINATOR_DAY_SIDE_OFFSETS_DEG : []);
  const zone = sweptZone ?? { minDeg: geometry.coverageMinDeg, maxDeg: geometry.coverageMaxDeg };
  return NextResponse.json({
    advanced,
    ...buildStateView({ feed, dials, entries: entries.map(toViewEntry), screen, nowMs, admitted, zone, version }),
  });
}
