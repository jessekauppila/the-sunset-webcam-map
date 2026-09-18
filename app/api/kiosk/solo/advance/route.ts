import { NextResponse } from 'next/server';
import { getLiveSettingsCached } from '@/app/lib/settings/liveSettings';
import { mergeSettings } from '@/app/lib/settings/schema';
import { drawSlot, isDue, kioskSlackMs } from '@/app/lib/solo/advance';
import { resolveSoloVersion } from '@/app/lib/solo/versions';
import { countAdmittedSince, getScreenState, getSweptZone, listActiveEntries } from '@/app/lib/solo/store';
import { isFlagEnabled } from '@/app/lib/runtimeFlags';
import { SWEEP_FORCE_DAY_RING } from '@/app/lib/runtimeFlagKeys';
import { sweepGeometry } from '@/app/api/cron/update-cameras/lib/sweepGeometry';
import { TERMINATOR_DAY_SIDE_OFFSETS_DEG } from '@/app/lib/masterConfig';
import { buildStateView, parseFeed, toViewEntry, type AdvanceDecision } from '../view';

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
  const slackMs = kioskSlackMs(dials);
  // A dwell that has not ended is not drawn over (rendezvous spec); see kioskSlackMs for why a kiosk-fired request gets half a beat.
  const { advanced, grown, decision, screen } = isDue(screenBefore, nowMs, slackMs)
    ? await drawSlot({ feed, version, dials, entries, screenBefore, slot, nowMs })
    : { advanced: false, grown: false, decision: null as AdvanceDecision, screen: screenBefore };
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
    grown,
    decision,
    ...buildStateView({ feed, dials, entries: entries.map(toViewEntry), screen, nowMs, admitted, zone, version }),
  });
}
