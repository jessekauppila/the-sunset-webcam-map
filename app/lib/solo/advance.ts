import { afterShowing } from '@/app/lib/solo/engine';
import type { SoloVersionSpec } from '@/app/lib/solo/versions';
import { commitAdvance, getScreenState, growDwell, type ScreenRow, type StoredEntry } from '@/app/lib/solo/store';
import type { Feed, SoloDials } from '@/app/lib/solo/types';
import type { Solo2Dials } from '@/app/lib/solo2/types';
import type { AdvanceDecision } from '@/app/api/kiosk/solo/view';

export interface DrawInput {
  feed: Feed;
  version: SoloVersionSpec;
  dials: SoloDials;
  /** The pool as read for this draw. MUTATED on success: the frames shown get their tally bumped, as the pool row does. */
  entries: StoredEntry[];
  screenBefore: ScreenRow | null;
  slot: number;
  nowMs: number;
}

export interface DrawResult {
  advanced: boolean;
  /** True only on the keep-going answer: the ending dwell was lengthened and no new frame was drawn. */
  grown: boolean;
  /** What the rendezvous decided, for the studio and the logs; null for a version that has no rendezvous. */
  decision: AdvanceDecision;
  /** The row after this call: the new one on success, otherwise what the caller passed in (or, for advanceIfDue, a fresh read). */
  screen: ScreenRow | null;
}

/**
 * One draw for `slot`: the engine's pick, the rendezvous fit, the frames it
 * plays, the dwell's span and start, committed in one compare-and-set on the
 * screen row — or the keep-going answer, which lengthens the ending dwell and
 * draws nothing. This is the body POST /api/kiosk/solo/advance has always
 * run; it lives here so a GET that finds a dwell over can run the same one
 * (mirror spec §4.1).
 *
 * Idempotent on the slot: the row's own slot is a no-op, and a lost race
 * (`commitAdvance` false) leaves the pool untouched. Whether the dwell has
 * ENDED is the caller's gate — see `isDue` — because the kiosk's POST and
 * advance on read allow different slack.
 */
export async function drawSlot(input: DrawInput): Promise<DrawResult> {
  const { feed, version, dials, entries, screenBefore, slot, nowMs } = input;
  if (screenBefore?.slot === slot) return { advanced: false, grown: false, decision: null, screen: screenBefore };
  const beatMs = 'beatS' in dials ? (dials as Solo2Dials).beatS * 1000 : 0;
  let advanced = false;
  let grown = false;
  let decision: AdvanceDecision = null;
  let screen = screenBefore;
  const state = {
    lastSnapshotId: screenBefore?.currentSnapshotId ?? null,
    sunsetStreak: screenBefore?.sunsetStreak ?? 0,
  };
  // The queue, not just its head: the rendezvous may choose from the front of
  // it (scheduler spec §3.1). Without the seam, or off the rendezvous, this is
  // one deep and `drawn` stays the engine's own pick.
  const depth = version.queue ? Math.max(1, Math.floor((dials as Solo2Dials).rendezvousWindow ?? 1)) : 1;
  const queue = version.queue ? version.queue(entries, dials, state, slot, feed, depth) : [];
  const pick = queue[0] ?? version.next(entries, dials, state, slot, feed);
  if (!pick) return { advanced: false, grown: false, decision: null, screen: screenBefore };
  // On the beat the dwell begins on the tick the kiosk fired on, not when
  // this request happened to land (beat spec §2.6); solo starts now.
  const startMs = version.startMs(nowMs, dials);
  /**
   * The camera that actually goes on glass. It is the engine's pick until a
   * decision says otherwise; the row, the tallies and the streak are all taken
   * from THIS, never from `pick`, because the rendezvous may have drawn a
   * different camera from the queue's head.
   */
  let drawn = pick;
  let shown = version.shown(entries, pick, dials);
  let peakAtMs: number | null = null;
  let rendezvous = false;
  if (version.fitNext && version.dwellMsFor) {
    // The other screen's pinned landing, and only while it is still ahead
    // of the tick this draw starts on — not of the request instant, which
    // is a few hundred ms either side of it. A landing already past, or on
    // the very tick we start, is nothing this draw can meet.
    // With the dial off there is nothing to fit to, so skip the other
    // screen's row entirely; fitNext still runs, with null to fit against,
    // so `decision` reports 'plain' as it always has off the dial.
    const theirs = (dials as Solo2Dials).rendezvous
      ? await getScreenState(feed === 'sunrise' ? 'sunset' : 'sunrise')
      : null;
    const otherPeak = theirs?.peakAtMs != null && theirs.peakAtMs > startMs ? theirs.peakAtMs : null;
    // The run ending on THIS screen, so a fit needing more room than the
    // climb has can ask that run to play on instead of holding anything.
    // Found by the last frame PLAYED, not the frame drawn: a grown run
    // ends on a frame the draw never named.
    const lastShownId = screenBefore?.shownSnapshotIds?.at(-1) ?? screenBefore?.currentSnapshotId ?? null;
    const endingEntry = lastShownId != null ? entries.find((e) => e.snapshotId === lastShownId) : undefined;
    const dec = version.fitNext(
      {
        t0Ms: startMs,
        queue: queue.length > 0 ? queue : [pick],
        entries,
        role: version.roleAt(slot, feed, dials),
        ending: endingEntry ? { webcamId: endingEntry.webcamId, lastShownId: endingEntry.snapshotId } : null,
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
      drawn = dec.pick;
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
    const after = afterShowing(drawn, state);
    const dwellMs = version.dwellMsFor
      ? version.dwellMsFor(entries, drawn, dials, shown.length)
      : version.dwellMs(entries, drawn, dials);
    advanced = await commitAdvance(
      feed, slot, drawn, after.sunsetStreak, shown, version.name, dwellMs, startMs, peakAtMs, rendezvous,
    );
    if (advanced) {
      for (const f of shown) {
        const stored = entries.find((e) => e.snapshotId === f.snapshotId)!;
        stored.tally += 1;
        stored.isNew = false;
        stored.lastShownAt = startMs;
      }
      screen = {
        feed, currentSnapshotId: drawn.snapshotId, shownSince: startMs, slot, sunsetStreak: after.sunsetStreak,
        dwellMs, shownSnapshotIds: shown.map((e) => e.snapshotId), peakAtMs, rendezvous,
      };
    }
  }
  return { advanced, grown, decision, screen };
}

/** When the stored dwell ends, or null for a row that has no start or no span (which counts as over). */
export function dwellEndMs(screen: ScreenRow | null): number | null {
  if (!screen || screen.shownSince == null || screen.dwellMs == null) return null;
  return screen.shownSince + screen.dwellMs;
}

/**
 * Half a beat, never less than a second (rendezvous spec): the slack a KIOSK-
 * fired advance gets, because the kiosk's clock is not the server's and the
 * request belonging to the ending tick may land just before it. solo has no
 * beat at all, so without the floor a tab running a few milliseconds fast
 * would have EVERY advance refused and the row would stay parked rather than
 * merely be early.
 */
export function kioskSlackMs(dials: SoloDials): number {
  const beatMs = 'beatS' in dials ? (dials as Solo2Dials).beatS * 1000 : 0;
  return Math.max(beatMs / 2, 1_000);
}

/**
 * Due when there is no end, or nowMs >= end - slackMs.
 *
 * A dwell that has not ended is not drawn over (rendezvous spec, global
 * constraint): drawing then would cut a grown dwell short — the very dwell
 * this screen lengthened to meet the other one.
 */
export function isDue(screen: ScreenRow | null, nowMs: number, slackMs = 0): boolean {
  const end = dwellEndMs(screen);
  return end == null || nowMs >= end - slackMs;
}

/**
 * Advance on read (mirror spec §4.1): when the stored dwell is over, draw
 * the next slot. Any number of readers past the same end produce one draw,
 * because the commit is a compare-and-set on the slot; a reader that did
 * not win, or found nothing eligible, answers with the row as it now stands
 * rather than the one it read before trying. A grown answer is already the
 * row this call wrote, so it comes back as it stands rather than re-read.
 *
 * `slackMs` defaults to 0: this runs on the server's own clock, so an early
 * minute refresh must not cut a dwell short. Only the kiosk's POST, whose
 * clock is its own, gets `kioskSlackMs`.
 */
export async function advanceIfDue(input: Omit<DrawInput, 'slot'> & { slackMs?: number }): Promise<DrawResult> {
  const { slackMs = 0, ...draw } = input;
  if (!isDue(draw.screenBefore, draw.nowMs, slackMs)) {
    return { advanced: false, grown: false, decision: null, screen: draw.screenBefore };
  }
  const slot = (draw.screenBefore?.slot ?? -1) + 1;
  const result = await drawSlot({ ...draw, slot });
  if (result.advanced || result.grown) return result;
  return { advanced: false, grown: false, decision: result.decision, screen: await getScreenState(draw.feed) };
}
