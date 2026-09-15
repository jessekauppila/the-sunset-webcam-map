import { NextResponse } from 'next/server';
import { getLiveSettingsCached } from '@/app/lib/settings/liveSettings';
import { mergeSettings } from '@/app/lib/settings/schema';
import { afterShowing } from '@/app/lib/solo/engine';
import { resolveSoloVersion } from '@/app/lib/solo/versions';
import { commitAdvance, countAdmittedSince, getScreenState, getSweptZone, growDwell, listActiveEntries } from '@/app/lib/solo/store';
import type { Solo2Dials } from '@/app/lib/solo2/types';
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
  const beatMs = 'beatS' in dials ? (dials as Solo2Dials).beatS * 1000 : 0;
  /**
   * A dwell that has not ended is not drawn over (rendezvous spec, global
   * constraint): the kiosk fires at the end, so only a racing second tab or a
   * stale tab arrives early, and drawing then would cut a grown dwell short —
   * the very dwell this screen lengthened to meet the other one. Half a beat
   * of slack, because the request belonging to the ending tick may land just
   * before it. solo has no beat, so its guard is the end exactly.
   */
  const ending = screenBefore?.shownSince != null && screenBefore.dwellMs != null
    ? screenBefore.shownSince + screenBefore.dwellMs
    : null;
  const notYet = ending != null && nowMs < ending - beatMs / 2;
  let advanced = false;
  /** True only on the keep-going answer: the ending dwell was lengthened and no new frame was drawn. */
  let grown = false;
  /** What the rendezvous decided, for the studio and the logs; null for a version that has no rendezvous. */
  let decision: string | null = null;
  let screen = screenBefore;
  if (notYet) {
    // Nothing to decide: fall through to the state view with advanced=false,
    // and the kiosk comes back at the end this response publishes.
  } else if (screenBefore?.slot !== slot) {
    const state = {
      lastSnapshotId: screenBefore?.currentSnapshotId ?? null,
      sunsetStreak: screenBefore?.sunsetStreak ?? 0,
    };
    const pick = version.next(entries, dials, state, slot, feed);
    if (pick) {
      const after = afterShowing(pick, state);
      // On the beat the dwell begins on the tick the kiosk fired on, not when
      // this request happened to land (beat spec §2.6); solo starts now.
      const startMs = version.startMs(nowMs, dials);
      let shown = version.shown(entries, pick, dials);
      let peakAtMs: number | null = null;
      let rendezvous = false;
      if (version.fitNext && version.dwellMsFor) {
        // The other screen's pinned landing, and only while it is still ahead
        // of the clock: a landing already past is nothing to meet.
        const theirs = await getScreenState(feed === 'sunrise' ? 'sunset' : 'sunrise');
        const otherPeak = theirs?.peakAtMs != null && theirs.peakAtMs > nowMs ? theirs.peakAtMs : null;
        // The run ending on THIS screen, so a fit needing more room than the
        // climb has can ask that run to play on instead of holding anything.
        const currentId = screenBefore?.currentSnapshotId ?? null;
        const currentEntry = currentId != null ? entries.find((e) => e.snapshotId === currentId) : undefined;
        const lastShownId = screenBefore?.shownSnapshotIds?.at(-1) ?? currentId;
        const dec = version.fitNext(
          {
            t0Ms: startMs,
            pick,
            entries,
            role: version.roleAt(slot, feed, dials),
            ending: currentEntry && lastShownId != null ? { webcamId: currentEntry.webcamId, lastShownId } : null,
          },
          { peakAtMs: otherPeak },
          dials,
        );
        if (dec.kind === 'grow' && screenBefore?.slot != null && screenBefore.shownSince != null && screenBefore.dwellMs != null) {
          // Keep going rather than draw: the ending run plays more of its own
          // camera, one beat each, and the slot does not move. The frame this
          // draw would have shown is drawn at the new, later end instead.
          decision = 'grow';
          const newDwellMs = screenBefore.dwellMs + dec.add.length * beatMs;
          grown = await growDwell(feed, screenBefore.slot, dec.add, newDwellMs);
          if (grown) {
            for (const f of dec.add) {
              const stored = entries.find((e) => e.snapshotId === f.snapshotId)!;
              stored.tally += 1;
              stored.isNew = false;
              stored.lastShownAt = nowMs;
            }
            screen = {
              ...screenBefore,
              dwellMs: newDwellMs,
              shownSnapshotIds: [...(screenBefore.shownSnapshotIds ?? []), ...dec.add.map((e) => e.snapshotId)],
            };
          }
          // A refused grow (the row moved under us) falls through as
          // advanced:false, grown:false, and the kiosk retries at the end the
          // row now holds.
        } else if (dec.kind !== 'grow') {
          shown = dec.frames;
          peakAtMs = dec.peakAtMs;
          rendezvous = dec.kind === 'fit';
          decision = dec.kind === 'nofit' ? `nofit · ${dec.why}` : dec.kind;
        }
      }
      if (decision !== 'grow') {
        // Decided ONCE, here, against the pool this draw actually saw and the
        // frames the fit left it, and stored alongside the start instant.
        // Every surface reads it back rather than working it out again from a
        // pool that has since moved.
        const dwellMs = version.dwellMsFor
          ? version.dwellMsFor(entries, pick, dials, shown.length)
          : version.dwellMs(entries, pick, dials);
        advanced = await commitAdvance(
          feed, slot, pick, after.sunsetStreak, shown, version.name, dwellMs, startMs, peakAtMs, rendezvous,
        );
        if (advanced) {
          for (const f of shown) {
            const stored = entries.find((e) => e.snapshotId === f.snapshotId)!;
            stored.tally += 1;
            stored.isNew = false;
            stored.lastShownAt = startMs;
          }
          screen = {
            feed, currentSnapshotId: pick.snapshotId, shownSince: startMs, slot, sunsetStreak: after.sunsetStreak,
            dwellMs, shownSnapshotIds: shown.map((e) => e.snapshotId), peakAtMs, rendezvous,
          };
        }
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
    grown,
    decision,
    ...buildStateView({ feed, dials, entries: entries.map(toViewEntry), screen, nowMs, admitted, zone, version }),
  });
}
