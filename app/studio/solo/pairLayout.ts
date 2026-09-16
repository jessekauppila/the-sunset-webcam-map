import type { EntryView, StateView, ViewEntry } from '@/app/api/kiosk/solo/view';
import type { StripFrame } from '@/app/lib/solo/replay';
import { cameraGroups, peakOf } from '@/app/lib/solo2/run';
import { fitPlan } from '@/app/lib/solo2/plan';
import { HELD_AFTER, type TapeDials } from './tapeParts';

/**
 * The pure half of `PairTape` (one-tape spec §4.2): turn one feed's server
 * state plus its projection into `Block[]`, ms boundaries and all — no
 * pixels, no scroll, no click handlers. `PairTape.tsx` walks these to draw
 * three rows on one shared time axis; this file only decides WHEN each
 * block starts and ends and what it carries.
 */

export type BlockKind = 'past' | 'current' | 'next';

/** One block on a strip, in ms. */
export interface Block {
  kind: BlockKind;
  startMs: number;
  endMs: number;
  /** The frame the block is chiefly about: for a run, the frame the dwell actually ends on. Null for a blank. */
  entry: EntryView | null;
  /** The run this block plays, oldest to newest; `[entry]` when the camera-run detail is unknown. Empty for a blank. */
  frames: EntryView[];
  /** This camera's frames the most-frames cap left out entirely (no time on the strip, no time in `dropped` either). */
  cut: EntryView[];
  /** This camera's climb frames the fit thinned before the peak (no time on the strip). */
  dropped: EntryView[];
  /** Frames a rendezvous grow appended to this block; already counted in `frames.length`. */
  grown: number;
  peakAtMs: number | null;
  rendezvous: boolean;
  /** Where this block's peak would have landed without the rendezvous; null when there is nothing to compare. */
  ghostMs: number | null;
  /** A measured past block that stayed on glass past `HELD_AFTER` its own run's expected duration — nothing else was eligible. */
  held: boolean;
  /** This block's own frame was drawn earlier on this strip. */
  repeat: boolean;
  /** The best-rated sunset frame among this block's camera series — the sub-block the ring highlights. Null with no camera, or no sunset frame in the group. */
  peakId: number | null;
  /** This block's `endMs` came from a real boundary (the next draw, or the current frame taking over) rather than the one-nominal-dwell fallback. Only past blocks vary this; the past row's title wording depends on it. */
  measured: boolean;
}

const FALLBACK: EntryView = {
  snapshotId: -1, webcamId: -1, bin: 'non_sunset', quality: null, detection: 0, isNew: false, tally: 0,
  enteredAt: 0, lastShownAt: null, imageUrl: '', title: '', city: '', region: '', country: '', capturedAt: 0,
  timezone: null, sunAltitudeDeg: null, credit: null, eligible: true, rank: 0, stage: { kind: 'inLine', position: null },
};

/**
 * A block's `entry`/`frames` need the full picture (image, title, place); a
 * `StripFrame` (and a past row's `shownSnapshotIds`) only carry the id. The
 * projection's own `entries` is where the full picture lives — the `eligible`
 * /`rank`/`stage` fields `EntryView` adds on top are about the live queue's
 * ordering, meaningless for a frame already drawn or replayed, so they are
 * filled with a neutral placeholder rather than recomputed.
 */
function resolver(view: StateView): (id: number) => EntryView {
  const byId = new Map(view.entries.map((e) => [e.snapshotId, e]));
  return (id: number): EntryView => {
    const found = byId.get(id);
    return found ? { ...found, eligible: true, rank: 0, stage: { kind: 'inLine', position: null } } : { ...FALLBACK, snapshotId: id };
  };
}

/**
 * `ids`, resolved; falls back to `[self]` when the list is empty (a row
 * logged before the shown-frames stamp). `self` is the frame the caller
 * already holds in full (a `TapeEntry`, `current.entry`, or a `StripFrame`
 * turned into one) — used directly for its own id rather than round-tripped
 * through `view.entries`, which need not carry it at all.
 */
function framesOf(resolve: (id: number) => EntryView, ids: number[], self: EntryView): EntryView[] {
  return (ids.length ? ids : [self.snapshotId]).map((id) => (id === self.snapshotId ? self : resolve(id)));
}

/** A `StripFrame`'s own picture, turned into an `EntryView` shape — enough to draw the block without a `view.entries` lookup. */
function fromStrip(f: StripFrame): EntryView {
  return {
    snapshotId: f.snapshotId!, webcamId: f.webcamId!, bin: f.bin!, quality: f.quality, detection: f.detection ?? 0,
    isNew: false, tally: 0, enteredAt: f.capturedAt ?? f.shownAt, lastShownAt: null,
    imageUrl: f.imageUrl, title: f.title, city: '', region: '', country: '',
    capturedAt: f.capturedAt ?? f.shownAt, timezone: null, sunAltitudeDeg: null, credit: null,
    eligible: true, rank: 0, stage: { kind: 'inLine', position: null },
  };
}

/** The series' peak snapshot id (item 2), or null with nothing to peak on — no camera, or no sunset frame in the group. */
function peakIdOf(groups: Map<number, ViewEntry[]>, webcamId: number | null | undefined): number | null {
  if (webcamId == null) return null;
  return peakOf(groups.get(webcamId) ?? [])?.snapshotId ?? null;
}

/**
 * This camera's series split around its peak (run.ts's own rule): frames
 * before the peak, the peak, frames after. `null` peak (no sunset frame in
 * the group) leaves `climb` empty — nothing to have thinned. `groups` is
 * `cameraGroups(view.entries)`, built once per `layoutStrip` call by the
 * caller — grouping every entry is an O(n) pass over the whole pool, and a
 * strip with several projected runs must not repeat it once per block.
 */
function climbOf(groups: Map<number, ViewEntry[]>, webcamId: number): { series: ViewEntry[]; climb: ViewEntry[] } {
  const series = groups.get(webcamId) ?? [];
  const peak = peakOf(series);
  if (!peak) return { series, climb: [] };
  const i = series.findIndex((s) => s.snapshotId === peak.snapshotId);
  return { series, climb: series.slice(0, i) };
}

/**
 * `next` block only: `cut` is this camera's whole series minus what actually
 * played (the most-frames cap, uncapped by comparison — cap.ts's callers
 * apply the real cap to `frames`, so whatever the series has beyond that is
 * what the cap cut); `dropped` is the climb frames a rendezvous fit thinned
 * before it ever got the chance to be capped. The two must not double-count
 * the same frame as both a dim cut stub and an orange-edged dropped stub, so
 * `cut` excludes anything `dropped` already claims.
 */
function cutAndDropped(
  resolve: (id: number) => EntryView, groups: Map<number, ViewEntry[]>, webcamId: number, keptIds: Set<number>,
): { cut: EntryView[]; dropped: EntryView[] } {
  const { series, climb } = climbOf(groups, webcamId);
  const dropped = climb.filter((c) => !keptIds.has(c.snapshotId));
  const droppedIds = new Set(dropped.map((d) => d.snapshotId));
  const cut = series.filter((s) => !keptIds.has(s.snapshotId) && !droppedIds.has(s.snapshotId));
  return { cut: cut.map((f) => resolve(f.snapshotId)), dropped: dropped.map((f) => resolve(f.snapshotId)) };
}

/**
 * One feed's blocks, past through projected, in time order (one-tape spec
 * §4.2, task 5 step 2). `repeat` is threaded across the whole call so a
 * frame's second appearance — past, current, or projected — carries the
 * red top edge exactly once (its first appearance does not).
 */
export function layoutStrip(input: {
  view: StateView;
  projection: StripFrame[];
  ghosts: (number | null)[];
  liveDials: TapeDials;
  studioDials: TapeDials;
  nowMs: number;
}): Block[] {
  const { view, projection, ghosts, liveDials, studioDials, nowMs } = input;
  const resolve = resolver(view);
  const groups = cameraGroups(view.entries);
  const seen = new Set<number>();
  const repeatOf = (id: number) => {
    const r = seen.has(id);
    seen.add(id);
    return r;
  };

  const blocks: Block[] = [];
  const { tape, current } = view;
  const dwellS = liveDials.dwellS > 0 ? liveDials.dwellS : 1;

  tape.forEach((f, i) => {
    // Measured, never computed (Tape.tsx's own rule, carried over): the next
    // draw's time, else the current frame's start. Unmeasured (nothing
    // followed, no current either) falls back to one nominal dwell so the
    // block still has a real endMs to give the axis.
    const boundaryMs = i + 1 < tape.length ? tape[i + 1].shownAt : current?.shownSince ?? null;
    const measured = boundaryMs != null;
    // Item 4: nothing pushes a block off a time axis, so a held block's
    // endMs is its real measured end, whatever the ratio to the nominal
    // dwell — no MAX_DWELLS cap.
    const onGlassS = measured ? Math.max(0, (boundaryMs! - f.shownAt) / 1000) : dwellS;
    const endMs = f.shownAt + onGlassS * 1000;
    const frames = framesOf(resolve, f.shownSnapshotIds, f);
    // Item 7: a run's own beats can run longer than one nominal dwell
    // (fitPlan: changeBeats + n + restBeats), so "held" compares the
    // measured time against what THIS run should have taken, not the flat
    // still — else any multi-frame solo2 run reads as a false held.
    const expectedS = liveDials.beatS
      ? fitPlan({
        beatS: liveDials.beatS, dwellBeats: liveDials.dwellBeats ?? 0, changeBeats: liveDials.changeBeats ?? 0,
        leadS: 0, transition: liveDials.transition,
      }, frames.length).dwellS
      : dwellS;
    const held = measured && onGlassS > HELD_AFTER * expectedS;
    const entry = frames[frames.length - 1];
    const repeat = repeatOf(entry.snapshotId);
    blocks.push({
      kind: 'past', startMs: f.shownAt, endMs, entry, frames, cut: [], dropped: [], grown: 0,
      peakAtMs: f.peakAtMs, rendezvous: f.rendezvous, ghostMs: null, held, repeat,
      peakId: peakIdOf(groups, entry.webcamId), measured,
    });
  });

  if (current) {
    const startMs = current.shownSince ?? nowMs;
    const endMs = current.endsAtMs ?? startMs + dwellS * 1000;
    const frames = framesOf(resolve, current.shownSnapshotIds, current.entry);
    const entry = frames[frames.length - 1] ?? current.entry;
    const repeat = repeatOf(entry.snapshotId);
    blocks.push({
      kind: 'current', startMs, endMs, entry, frames, cut: [], dropped: [], grown: 0,
      peakAtMs: current.peakAtMs, rendezvous: current.rendezvous, ghostMs: null, held: false, repeat,
      peakId: peakIdOf(groups, entry.webcamId), measured: true,
    });
  } else {
    // Nothing on glass: a blank still wide enough to read, anchored at now
    // (brief §7) so the seam between fact and projection stays legible.
    blocks.push({
      kind: 'current', startMs: nowMs, endMs: nowMs + dwellS * 1000, entry: null, frames: [],
      cut: [], dropped: [], grown: 0, peakAtMs: null, rendezvous: false, ghostMs: null, held: false, repeat: false,
      peakId: null, measured: false,
    });
  }

  const studioDwellS = studioDials.dwellS > 0 ? studioDials.dwellS : 1;
  projection.forEach((f, i) => {
    if (f.snapshotId == null) {
      // Nothing eligible at this tick: a blank projected slot, one nominal dwell wide.
      blocks.push({
        kind: 'next', startMs: f.shownAt, endMs: f.shownAt + (f.dwellMs ?? studioDwellS * 1000), entry: null, frames: [],
        cut: [], dropped: [], grown: f.grown, peakAtMs: f.peakAtMs, rendezvous: f.rendezvous, ghostMs: ghosts[i] ?? null,
        held: false, repeat: false, peakId: null, measured: true,
      });
      return;
    }
    const frames = framesOf(resolve, f.shownSnapshotIds, fromStrip(f));
    const entry = frames[frames.length - 1];
    const repeat = repeatOf(entry.snapshotId);
    const keptIds = new Set(frames.map((fr) => fr.snapshotId));
    const { cut, dropped } = cutAndDropped(resolve, groups, entry.webcamId, keptIds);
    blocks.push({
      kind: 'next', startMs: f.shownAt, endMs: f.shownAt + (f.dwellMs ?? studioDwellS * 1000), entry, frames,
      cut, dropped, grown: f.grown, peakAtMs: f.peakAtMs, rendezvous: f.rendezvous, ghostMs: ghosts[i] ?? null,
      held: false, repeat, peakId: peakIdOf(groups, entry.webcamId), measured: true,
    });
  });

  return blocks;
}
