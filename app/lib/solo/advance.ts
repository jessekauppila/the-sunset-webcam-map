import { afterShowing } from '@/app/lib/solo/engine';
import type { SoloVersionSpec } from '@/app/lib/solo/versions';
import { commitAdvance, getScreenState, type ScreenRow, type StoredEntry } from '@/app/lib/solo/store';
import type { Feed, SoloDials } from '@/app/lib/solo/types';

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
  /** The row after this call: the new one on success, otherwise what the caller passed in (or, for advanceIfDue, a fresh read). */
  screen: ScreenRow | null;
}

/**
 * One draw for `slot`: the engine's pick, the frames it plays, the dwell's
 * span and start, committed in one compare-and-set on the screen row. This
 * is the body POST /api/kiosk/solo/advance has always run; it lives here so
 * a GET that finds a dwell over can run the same one (mirror spec §4.1).
 * Idempotent on the slot: the row's own slot is a no-op, and a lost race
 * (`commitAdvance` false) leaves the pool untouched.
 */
export async function drawSlot(input: DrawInput): Promise<DrawResult> {
  const { feed, version, dials, entries, screenBefore, slot, nowMs } = input;
  if (screenBefore?.slot === slot) return { advanced: false, screen: screenBefore };
  const state = {
    lastSnapshotId: screenBefore?.currentSnapshotId ?? null,
    sunsetStreak: screenBefore?.sunsetStreak ?? 0,
  };
  const pick = version.next(entries, dials, state, slot, feed);
  if (!pick) return { advanced: false, screen: screenBefore };
  const after = afterShowing(pick, state);
  const shown = version.shown(entries, pick, dials);
  // Decided ONCE, here, against the pool this draw actually saw, and stored
  // beside the start instant. Every surface reads it back rather than
  // working it out again from a pool that has since moved.
  const dwellMs = version.dwellMs(entries, pick, dials);
  // On the beat the dwell begins on the tick, not when the request landed
  // (beat spec §2.6); solo starts now.
  const startMs = version.startMs(nowMs, dials);
  const advanced = await commitAdvance(feed, slot, pick, after.sunsetStreak, shown, version.name, dwellMs, startMs);
  if (!advanced) return { advanced: false, screen: screenBefore };
  for (const f of shown) {
    const stored = entries.find((e) => e.snapshotId === f.snapshotId)!;
    stored.tally += 1;
    stored.isNew = false;
    stored.lastShownAt = startMs;
  }
  return {
    advanced: true,
    screen: {
      feed, currentSnapshotId: pick.snapshotId, shownSince: startMs, slot, sunsetStreak: after.sunsetStreak,
      dwellMs, shownSnapshotIds: shown.map((e) => e.snapshotId),
    },
  };
}

/** When the stored dwell ends, or null for a row that has no start or no span (which counts as over). */
export function dwellEndMs(screen: ScreenRow | null): number | null {
  if (!screen || screen.shownSince == null || screen.dwellMs == null) return null;
  return screen.shownSince + screen.dwellMs;
}

export function isDue(screen: ScreenRow | null, nowMs: number): boolean {
  const end = dwellEndMs(screen);
  return end == null || end <= nowMs;
}

/**
 * Advance on read (mirror spec §4.1): when the stored dwell is over, draw
 * the next slot. Any number of readers past the same end produce one draw,
 * because the commit is a compare-and-set on the slot; a reader that did
 * not win, or found nothing eligible, answers with the row as it now stands
 * rather than the one it read before trying.
 */
export async function advanceIfDue(input: Omit<DrawInput, 'slot'>): Promise<DrawResult> {
  if (!isDue(input.screenBefore, input.nowMs)) return { advanced: false, screen: input.screenBefore };
  const slot = (input.screenBefore?.slot ?? -1) + 1;
  const result = await drawSlot({ ...input, slot });
  if (result.advanced) return result;
  return { advanced: false, screen: await getScreenState(input.feed) };
}
