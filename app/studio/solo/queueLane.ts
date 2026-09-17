import { cameraGroups, capFor, compareCapture, peakOf, roomOf, runOf, type RunEntry } from '@/app/lib/solo2/run';
import type { Solo2Dials } from '@/app/lib/solo2/types';

/**
 * One camera's place in the queue lane (scheduler spec §6). A camera is one
 * box holding its whole series in capture order, with `playedIds` saying which
 * of those frames a draw would put on glass — the rest draw dim, which is the
 * convention `FeedColumn` already uses for the frames a cap cuts.
 */
export interface LaneItem<T extends RunEntry> {
  /** The camera's representative: the entry the queue holds. */
  entry: T;
  /** Its whole series, oldest first. */
  frames: T[];
  /** The frames a draw of this camera would play; everything else draws dim. */
  playedIds: Set<number>;
  /** Its place in the rules' order, 1-based. */
  position: number;
  /** Could land its peak on the landing outstanding on the other screen. */
  reaches: boolean;
  /** This is the camera the draw actually chose. */
  took: boolean;
  x: number;
  width: number;
}

/**
 * A camera in the queue joined to where it reached the glass. Lines that cross
 * are the rendezvous pulling a camera out of turn — the mechanism in one mark,
 * and the warning sign when they pile onto the same camera.
 */
export interface Link {
  fromX: number;
  toX: number;
  took: boolean;
}

export interface Lane<T extends RunEntry> {
  items: LaneItem<T>[];
  links: Link[];
  width: number;
}

export interface LaneInput<T extends RunEntry> {
  /** The rules' order, head first — the same array `queue2` returned for this draw. */
  queue: T[];
  /** The whole pool, so a camera's series and cap can be worked out. */
  entries: T[];
  dials: Solo2Dials;
  /** The landing outstanding on the other screen at this draw, or null. */
  outstandingMs: number | null;
  /** The tick this draw starts on. */
  t0Ms: number;
  /** The snapshot id the draw chose, or null for a draw not yet made. */
  chosenId: number | null;
  /** Where each camera's block sits on the strip, by webcamId: the link's other end. */
  blockX: Map<number, number>;
  framePx: number;
  gapPx: number;
}

/** Can this camera's peak land on the outstanding tick, by thinning its climb? */
function reachesTick<T extends RunEntry>(
  frames: T[], cap: number,
  o: Pick<LaneInput<T>, 'outstandingMs' | 't0Ms' | 'dials'>,
): boolean {
  if (o.outstandingMs == null) return false;
  const peak = peakOf(frames);
  if (peak === null) return false;
  const beatMs = o.dials.beatS * 1000;
  const change = o.dials.transition === 'cut' ? 0 : Math.max(0, Math.floor(o.dials.changeBeats));
  const avail = Math.round((o.outstandingMs - o.t0Ms) / beatMs) - change;
  // The same two bounds `fitNext` uses: the climb the series has, and the room
  // the cap leaves. Kept here rather than imported so the picture cannot claim
  // a reach the engine would refuse.
  const climbMax = Math.min(frames.findIndex((e) => e.snapshotId === peak.snapshotId), roomOf(cap));
  return avail >= 0 && (o.outstandingMs - o.t0Ms) % beatMs === 0 && avail <= climbMax;
}

/**
 * The queue lane: the queue in the rules' OWN order — 1st, 2nd, 3rd — not in
 * time order, with a line from each camera to wherever it reached the glass.
 * Pure, so the picture is testable without a browser.
 */
export function layoutQueueLane<T extends RunEntry>(o: LaneInput<T>): Lane<T> {
  const groups = cameraGroups(o.entries);
  const items: LaneItem<T>[] = [];
  let x = 0;
  o.queue.forEach((entry, i) => {
    const frames = (groups.get(entry.webcamId) ?? [entry]).slice().sort(compareCapture);
    const cap = capFor(entry, o.dials, o.entries, o.dials.cameraRun);
    const playedIds = new Set(runOf(entry, o.entries, o.dials.cameraRun, cap).map((e) => e.snapshotId));
    const width = frames.length * o.framePx;
    items.push({
      entry,
      frames,
      playedIds,
      position: i + 1,
      reaches: reachesTick(frames, cap, o),
      took: o.chosenId != null && o.chosenId === entry.snapshotId,
      x,
      width,
    });
    x += width + o.gapPx;
  });
  // A camera with no block has not reached the glass in this window, so it has
  // no line — an unplayed camera is not a missing link, it is simply still
  // waiting.
  const links = items.flatMap((it): Link[] => {
    const toX = o.blockX.get(it.entry.webcamId);
    return toX == null ? [] : [{ fromX: it.x + it.width / 2, toX, took: it.took }];
  });
  return { items, links, width: Math.max(0, x - o.gapPx) };
}

/**
 * How many links cross: pairs whose queue order and glass order disagree. Zero
 * means the queue was taken in turn; a rising count is the rendezvous bending
 * the rotation, which is what the choice-window dial trades against.
 */
export function crossings(links: Link[]): number {
  let n = 0;
  for (let i = 0; i < links.length; i++) {
    for (let j = i + 1; j < links.length; j++) {
      if ((links[i].fromX - links[j].fromX) * (links[i].toX - links[j].toX) < 0) n += 1;
    }
  }
  return n;
}
