import { cameraGroups, capFor, compareCapture, peakOf, qualityRank, roomOf, runOf, windowAround, type RunEntry } from './run';
import type { Role, Solo2Dials } from './types';

export { peakOf, thinClimb, windowAround } from './run';

/**
 * The rendezvous (beat-and-rendezvous spec §3): both screens land on their
 * best frame on the same tick. Pure: no clock, no I/O. The server calls
 * `fitNext` once per advance with its own side and the other screen's
 * pinned peak; the replay calls it the same way over recorded pools. The
 * count of frames is the only knob — a peak moves one beat for every frame
 * dropped ahead of it or added ahead of it; nothing holds, nothing changes
 * rate (§3.5).
 */

export type RendezvousDials = Pick<Solo2Dials,
  'beatS' | 'changeBeats' | 'transition' | 'cameraRun' | 'runFramesSunset' | 'runFramesOther' | 'runShape'
  | 'rendezvous' | 'rendezvousWindow'>;

export interface MySide<T extends RunEntry> {
  /** The tick this draw would start on: the previous dwell's end. */
  t0Ms: number;
  /**
   * The rules' order, head first (engine `queue2`), each entry a camera's
   * newest frame. `queue[0]` is the draw the engine would make on its own;
   * the rendezvous may choose deeper into it (scheduler spec §3.1). Never
   * empty — a caller with no pick has nothing to ask about.
   */
  queue: T[];
  /** This screen's whole pool. */
  entries: T[];
  /** The rhythm role of this draw; a valley is never eligible. */
  role: Role;
  /** The dwell that is ending on this screen, if any: its camera and the last frame it played. */
  ending: { webcamId: number; lastShownId: number } | null;
}

export interface TheirSide {
  /** The other screen's pinned landing, ms, or null. */
  peakAtMs: number | null;
}

/**
 * Every drawing decision carries `pick`: the camera it chose. The rendezvous
 * may draw something other than the queue's head (scheduler spec §3), and the
 * screen row, the pool tallies and the sunset streak all have to describe what
 * actually went on glass — so the decision says, rather than the caller
 * assuming it already knows. `grow` has none: it draws nothing.
 */
export type Decision<T> =
  | { kind: 'plain'; pick: T; frames: T[]; dropped: T[]; peakAtMs: null }
  | { kind: 'pin'; pick: T; frames: T[]; dropped: T[]; peakAtMs: number }
  | { kind: 'fit'; pick: T; frames: T[]; dropped: T[]; peakAtMs: number }
  /** Do not draw yet: extend the ending dwell by these frames of its own camera, in order. */
  | { kind: 'grow'; add: T[] }
  | { kind: 'nofit'; pick: T; why: 'too soon' | 'nothing to add'; frames: T[]; dropped: T[]; peakAtMs: null };

const changeBeats = (d: RendezvousDials) => (d.transition === 'cut' ? 0 : Math.max(0, Math.floor(d.changeBeats)));

/**
 * The greedy fit (§3.4), one seam for the search version to replace later
 * (§3.9): whoever draws first pins, the other fits.
 */
export function fitNext<T extends RunEntry>(mine: MySide<T>, theirs: TheirSide, d: RendezvousDials): Decision<T> {
  const pick = mine.queue[0];
  const series = cameraGroups(mine.entries).get(pick.webcamId) ?? [pick];
  const cap = capFor(pick, d, mine.entries, d.cameraRun);
  const peak = peakOf(series);
  const plain = (): Decision<T> => ({ kind: 'plain', pick, frames: runOf(pick, mine.entries, d.cameraRun, cap), dropped: [], peakAtMs: null });
  // Rank gates nothing (scheduler spec §3): a draw participates when it has a
  // peak to land, whatever that peak is worth. The gate was the whole cadence
  // problem — 18 meetings over six hours at 0.6, 133 with it gone.
  const eligible = d.rendezvous && mine.role === 'peak' && peak !== null && d.cameraRun;
  if (!eligible || peak === null) return plain();

  const beatMs = d.beatS * 1000;
  const change = changeBeats(d);
  const climbMax = Math.min(series.slice().sort(compareCapture).findIndex((e) => e.snapshotId === peak.snapshotId), roomOf(cap));
  const landing = (before: number) => mine.t0Ms + (change + before) * beatMs;

  const T = theirs.peakAtMs;
  if (T == null) {
    const w = windowAround(series, peak, cap);
    return { kind: 'pin', pick, frames: w.frames, dropped: w.dropped, peakAtMs: landing(w.frames.findIndex((e) => e.snapshotId === peak.snapshotId)) };
  }
  const avail = Math.round((T - mine.t0Ms) / beatMs) - change;
  if (avail < 0 || (T - mine.t0Ms) % beatMs !== 0) {
    const w = windowAround(series, peak, cap);
    return { kind: 'nofit', pick, why: 'too soon', frames: w.frames, dropped: w.dropped, peakAtMs: null };
  }
  // The choice window (scheduler spec §3.1): the head of the queue, and only
  // cameras with a peak of their own to land. The queue is already ordered
  // "never shown, then longest since shown", so choosing from its front bounds
  // how far the rotation can bend — a camera that just played is at the back
  // and cannot return however convenient its climb is.
  const groups = cameraGroups(mine.entries);
  const depth = Math.max(1, Math.floor(d.rendezvousWindow));
  const candidates = mine.queue.slice(0, depth).flatMap((c, index) => {
    const cSeries = groups.get(c.webcamId) ?? [c];
    const cPeak = peakOf(cSeries);
    if (cPeak === null) return [];
    const cCap = capFor(c, d, mine.entries, d.cameraRun);
    const cClimb = Math.min(
      cSeries.slice().sort(compareCapture).findIndex((e) => e.snapshotId === cPeak.snapshotId),
      roomOf(cCap),
    );
    return [{ c, index, cSeries, cPeak, cCap, cClimb, rank: qualityRank(c, mine.entries, d.cameraRun) }];
  });

  // Highest rank, then fewest frames dropped, then earlier in the queue. Every
  // camera here can make the meeting, so preferring the best-ranked costs no
  // cadence at all — which is what keeps magnitude and cadence on separate
  // dials (spec §3.2).
  const reaching = candidates
    .filter((x) => avail <= x.cClimb)
    .map((x) => ({ ...x, w: windowAround(x.cSeries, x.cPeak, x.cCap, avail) }))
    .sort((a, b) => b.rank - a.rank || a.w.dropped.length - b.w.dropped.length || a.index - b.index);
  if (reaching.length > 0) {
    const best = reaching[0];
    return { kind: 'fit', pick: best.c, frames: best.w.frames, dropped: best.w.dropped, peakAtMs: T };
  }

  // Nobody reaches. Growing does not draw — it extends the run already ending,
  // and the choice is remade at the later tick against a queue that has not
  // moved — so grow by the LEAST any candidate needs, which is the most
  // conservative delay and leaves that later choice widest.
  const need = candidates.length > 0
    ? Math.min(...candidates.map((x) => avail - x.cClimb))
    : avail - climbMax;
  if (need > 0 && mine.ending) {
    const theirSeries = (cameraGroups(mine.entries).get(mine.ending.webcamId) ?? []).slice().sort(compareCapture);
    const last = theirSeries.findIndex((e) => e.snapshotId === mine.ending!.lastShownId);
    const add = last >= 0 ? theirSeries.slice(last + 1, last + 1 + need) : [];
    if (add.length === need) return { kind: 'grow', add };
  }
  const w = windowAround(series, peak, cap);
  return { kind: 'nofit', pick, why: 'nothing to add', frames: w.frames, dropped: w.dropped, peakAtMs: null };
}
