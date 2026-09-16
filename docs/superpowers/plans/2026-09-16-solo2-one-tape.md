# solo2 — One Tape for Two Screens (phase 2b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The studio shows both screens on one time axis, so a rendezvous reads as one vertical line through both strips, a pin that will go unmet reads as a grey ghost, and a fitted run shows the frames it dropped and a grown run the frames it gained.

**Architecture:** A pure `projectPair` (studio-side) runs the same `replayPair` the CLI uses over both screens' live pools from their current dwell ends, once with the rendezvous dials and once without, producing two strips of `StripFrame`s plus landings and ghosts. A new `PairTape` component lays past blocks (from the draw log), the on-glass blocks (from the published spans) and the projected blocks on an absolute time axis (`x = (t − origin) × px`) in two strips around a ruler, and draws ties, ghosts, dropped and grown marks over them. It replaces the two per-feed tapes; `FeedColumn` keeps the bins and the queue. Shared tape parts (`Thumb`, `SeamMark`, `Playhead`, `seamBetween`, the zoom) move to `tapeParts.tsx` unchanged.

**Tech Stack:** Next.js 15 app router, TypeScript, Vitest + Testing Library. Tests: `npx vitest run <path>`.

**Spec:** `docs/superpowers/specs/2026-09-14-solo2-beat-and-rendezvous-design.md` §4.1 (one tape), §4.2 (the dwell line's landing phrase). The mechanism (§3) shipped in #224; its replay (§5) in #224/#225.

## Global Constraints

- **Time is position.** Every block's left edge is `x(startMs)` and its width is its duration × `px` (`PX_PER_S × zoom`, 4 px/s at zoom 1). Two blocks on different strips with the same instant share the same `x`. Cap-cut frames and dropped frames take no time: they are fixed-width slivers overlaid at the junction they belong to, never widening the strip.
- Past blocks are measured (next draw's `shownAt`, else `currentSince`), the on-glass block is the published span (`endsAtMs − shownSince`), projected blocks are `StripFrame.dwellMs` from `projectPair`. Nothing is derived from a dwell dial.
- **The projection is the CLI's engine**: `projectPair` calls `replayPair` from `app/lib/solo/replay.ts` with each screen's live pool (`StateView.entries`), its draw log (`StateView.tape` + the current draw) as prior draws, its current dwell's end as `fromMs`, and its current pin as the initial pin. What the tape projects is what the server would do, not a second reading.
- A **tie** is one vertical line through both strips and the ruler at a landing's instant, labelled with the time on the ruler. Past ties come from the draw log: a past row with `rendezvous = true` whose `peakAtMs` equals the other screen's row's `peakAtMs`. Projected ties come from `replayPair`'s landings.
- A **ghost** is a grey triangle above a projected block at the instant its peak would land with the rendezvous dial OFF, drawn only when that differs from the block's own `peakAtMs` by at least one beat.
- **Dropped** frames of a fitted block are slivers with an orange top edge overlaid at the junction between the kept frames they sat between; **grown** frames are the block's last `grown` frames with the same orange edge at the tail. A block's label reads `dropped N`, `grew +N`, `peak moved ±S s` (the ghost's instant minus the block's landing), only the parts that apply.
- The beat grid spans all three rows from the axis (no measuring of a seam element).
- The two `FeedColumn`s stay for the bins and the queue; the per-feed `Tape` component is deleted (its parts move). "New surfaces replace something."
- solo (the v1 version) still renders: `projectPair` works with a version that has no `fitNext` (all decisions plain, no ties, no ghosts); the tape then simply has two strips.
- Work in a sibling worktree `feat/solo2-one-tape` (already created from main after #225). Stage explicit paths; verify the branch in the same command as every commit; commit messages end with the session's attribution lines.

---

## File map

| file | change |
|---|---|
| `app/lib/solo/store.ts`, `.test.ts` | `listRecentDraws` selects `peak_at`, `rendezvous`, `shown_snapshot_ids`; `TapeFrame` carries them |
| `app/api/kiosk/solo/view.ts`, `.test.ts` | `TapeEntry` carries `peakAtMs`, `rendezvous`, `shownSnapshotIds` |
| `app/lib/solo/replay.ts`, `.test.ts` | `ReplayOptions.pinnedAtMs` seeds a screen's pin |
| `app/studio/solo/projectPair.ts` + `.test.ts` | create: both screens projected from the live state, with and without the rendezvous |
| `app/studio/solo/tapeParts.tsx` + `.test.tsx` | create: `Thumb`, `SeamMark`, `Playhead`, `TapeDials`, `seamBetween`, `useTapeZoom`, `TAPE_ZOOMS`, `THUMB_H` moved verbatim from `Tape.tsx` |
| `app/studio/solo/PairTape.tsx` + `.test.tsx` | create: the one tape |
| `app/studio/panels/SoloPanel.tsx`, `.test.tsx` | mounts `PairTape` above the columns; passes the projection |
| `app/studio/solo/FeedColumn.tsx`, `.test.tsx` | loses its `Tape`, the tape toggle, `tapeDials`, `tapeList` |
| `app/studio/solo/Tape.tsx`, `.test.tsx` | deleted after the move |
| `app/studio/solo/DwellBudget.tsx`, `.test.tsx`, `app/studio/Rail.tsx`, `app/studio/StudioClient.tsx` | the landing line per screen |

---

### Task 1: The draw log's tape rows carry the landing

**Files:**
- Modify: `app/lib/solo/store.ts` (`TapeFrame`, `listRecentDraws`), `app/lib/solo/store.test.ts`
- Modify: `app/api/kiosk/solo/view.ts` (`TapeEntry`, `toTapeInput`), `app/api/kiosk/solo/view.test.ts`

**Interfaces:**
- Produces: `TapeFrame` gains `peakAtMs: number | null; rendezvous: boolean; shownSnapshotIds: number[]` (the drawn frame alone when the row predates the column); `TapeEntry` gains the same three; `toTapeInput` copies them.

- [ ] **Step 1: Tests** — in `store.test.ts`'s `listRecentDraws` test, make the mocked row carry `peak_at: '2026-09-16T02:00:00Z'`, `rendezvous: true`, `shown_snapshot_ids: ['7', '8']` and assert the mapped frame has `peakAtMs: Date.parse(...)`, `rendezvous: true`, `shownSnapshotIds: [7, 8]`; a row with nulls maps to `null`, `false`, `[snapshotId]`. In `view.test.ts`, a tape input with those fields reaches `StateView.tape[i]` unchanged.

- [ ] **Step 2: Implement** — in `listRecentDraws`'s select add `d.peak_at, d.rendezvous, d.shown_snapshot_ids` (the columns exist after the applied migration), type them on the row (`peak_at: string | null; rendezvous: boolean | null; shown_snapshot_ids: (string | number)[] | null`), and map:
```ts
      peakAtMs: r.peak_at == null ? null : Date.parse(r.peak_at),
      rendezvous: r.rendezvous === true,
      shownSnapshotIds: r.shown_snapshot_ids?.length ? r.shown_snapshot_ids.map(num) : [num(r.snapshot_id)],
```
`TapeFrame` declares the three fields. In `view.ts`, `TapeEntry extends EntryView { slot; shownAt; peakAtMs: number | null; rendezvous: boolean; shownSnapshotIds: number[] }` and `toTapeInput` passes them through (its return type widens to include them).

- [ ] **Step 3: Run** `npx vitest run app/lib/solo/store.test.ts app/api/kiosk/solo` — PASS.

- [ ] **Step 4: Commit**

```bash
git rev-parse --abbrev-ref HEAD | grep -qx feat/solo2-one-tape && git add app/lib/solo/store.ts app/lib/solo/store.test.ts app/api/kiosk/solo/view.ts app/api/kiosk/solo/view.test.ts && git commit -m "feat(studio): the tape's past rows carry the landing and the frames they played"
```

---

### Task 2: A replayed screen can start with a pin (`replay.ts`)

**Files:**
- Modify: `app/lib/solo/replay.ts`, `app/lib/solo/replay.test.ts`

**Interfaces:**
- Produces: `ReplayOptions.pinnedAtMs?: number | null` — "the landing this screen's current dwell already pinned (the live row's `peakAtMs`)". `replayPair` seeds `pins[feed] = { atMs, matched: false, lastFailure: null }` from it when it is a future tick (`> fromMs`); `replay()` ignores it.

- [ ] **Step 1: Test** — in the `replayPair` describe: the sunset screen's options carry `pinnedAtMs = T0 + beat(3)` and no eligible draw of its own in the window; the sunrise screen's first draw (at `T0`) fits it → `made 1`, one landing at `T0 + beat(3)`, the sunrise frame `rendezvous: true`. Same fixture with `pinnedAtMs` in the past → `made 0`.

- [ ] **Step 2: Implement** — in `replayPair`, after the `pins` record is created: `for (const f of ['sunrise', 'sunset'] as const) { const p = o[f].pinnedAtMs; if (p != null && p > o[f].fromMs) pins[f] = { atMs: p, matched: false, lastFailure: null }; }`. Doc the field on `ReplayOptions`.

- [ ] **Step 3: Run** `npx vitest run app/lib/solo/replay.test.ts` — PASS.

- [ ] **Step 4: Commit**

```bash
git rev-parse --abbrev-ref HEAD | grep -qx feat/solo2-one-tape && git add app/lib/solo/replay.ts app/lib/solo/replay.test.ts && git commit -m "feat(replay): a screen can start the pair already pinned"
```

---

### Task 3: `projectPair` — both screens projected from the live state

**Files:**
- Create: `app/studio/solo/projectPair.ts`, `app/studio/solo/projectPair.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface PairProjection {
    sunrise: StripFrame[]; sunset: StripFrame[];
    /** Projected rendezvous, from replayPair. */
    landings: Landing[];
    counts: RendezvousCounts;
    /** Per strip, per block: where the block's peak would land with the rendezvous off (null when the block has no peak). */
    ghosts: Record<Feed, (number | null)[]>;
  }
  export function projectPair(input: {
    sunrise: StateView; sunset: StateView;
    dials: SoloDials; version: SoloVersionSpec; nowMs: number;
    /** How far past now to project, ms. */
    horizonMs: number;
  }): PairProjection
  ```
- Consumes: `replayPair`, `peakOf` (from `app/lib/solo2/run`), `changeBeatsOf` (from `app/lib/solo2/plan`), `StateView`.

- [ ] **Step 1: Tests** — build two small `StateView`s by hand (the file's own `view()` helper: entries with `capturedAt`, a `current` with `shownSince`/`endsAtMs`/`shownSnapshotIds`/`peakAtMs`, `tape` of one past row), the real `SOLO_VERSIONS.solo2` and dials from `schemaDefaults` with `rendezvous: true`, `dwellBoost: 0`, `dwellTrim: 0`:
  1. Each strip's first block starts at that screen's `current.endsAtMs` (not at `nowMs`).
  2. With the sunset `current.peakAtMs` set two beats ahead and an eligible sunrise draw, `landings` has one entry at that tick and the sunrise block has `rendezvous: true`.
  3. `ghosts.sunrise[0]` equals `fromMs + (changeBeats + fullClimbIndex) × beatS × 1000` for a block that was fitted (its peak moved), and `ghosts` is null for a block whose camera has no peak.
  4. With the `solo` version, both strips exist, `landings` is empty, every ghost is null.

- [ ] **Step 2: Implement**

```ts
import { replayPair, type Landing, type ReplayEntry, type RendezvousCounts, type StripFrame } from '@/app/lib/solo/replay';
import type { StateView, ViewEntry } from '@/app/api/kiosk/solo/view';
import type { Feed, SoloDials } from '@/app/lib/solo/types';
import type { SoloVersionSpec } from '@/app/lib/solo/versions';
import { cameraGroups, peakOf } from '@/app/lib/solo2/run';
import { changeBeatsOf } from '@/app/lib/solo2/plan';
import type { Solo2Dials } from '@/app/lib/solo2/types';

/**
 * Both screens projected from the live state (one-tape spec §4.1): the same
 * replayPair the CLI runs, over each screen's live pool and draw log, from the
 * instant its current dwell ends. Once with the dials as given and once with
 * the rendezvous off, so the tape can show where a peak would have landed.
 * Pure: no fetch, no clock.
 */
export interface PairProjection { /* as above */ }

const toReplayEntry = (e: ViewEntry): ReplayEntry => ({
  ...e, removedAt: null, firstShownAt: null, capturedAt: e.capturedAt, title: e.title, imageUrl: e.imageUrl,
});

function options(feed: Feed, v: StateView, dials: SoloDials, version: SoloVersionSpec, nowMs: number, horizonMs: number, pinned: boolean) {
  const cur = v.current;
  const priorDraws = [
    ...v.tape.map((t) => ({ slot: t.slot, shownAt: t.shownAt, snapshotId: t.snapshotId, shownSnapshotIds: t.shownSnapshotIds, bin: t.bin })),
    ...(cur && cur.slot != null && cur.shownSince != null
      ? [{ slot: cur.slot, shownAt: cur.shownSince, snapshotId: cur.entry.snapshotId, shownSnapshotIds: cur.shownSnapshotIds, bin: cur.entry.bin }]
      : []),
  ];
  const fromMs = cur?.endsAtMs ?? nowMs;
  return {
    feed, version, dials, entries: v.entries.map(toReplayEntry), priorDraws, fromMs, toMs: nowMs + horizonMs,
    pinnedAtMs: pinned ? cur?.peakAtMs ?? null : null,
  };
}

export function projectPair(input: { sunrise: StateView; sunset: StateView; dials: SoloDials; version: SoloVersionSpec; nowMs: number; horizonMs: number }): PairProjection {
  const { dials, version, nowMs, horizonMs } = input;
  const withR = replayPair({
    sunrise: options('sunrise', input.sunrise, dials, version, nowMs, horizonMs, true),
    sunset: options('sunset', input.sunset, dials, version, nowMs, horizonMs, true),
  });
  const off = { ...dials, rendezvous: false } as SoloDials;
  const without = replayPair({
    sunrise: options('sunrise', input.sunrise, off, version, nowMs, horizonMs, false),
    sunset: options('sunset', input.sunset, off, version, nowMs, horizonMs, false),
  });
  const d2 = dials as Partial<Solo2Dials>;
  const beatMs = (d2.beatS ?? 0) * 1000;
  const change = d2.changeBeats != null ? changeBeatsOf({ changeBeats: d2.changeBeats, transition: d2.transition }) : 0;
  const ghostsOf = (feed: Feed, v: StateView): (number | null)[] => {
    const groups = cameraGroups(v.entries.map(toReplayEntry));
    // The unfitted landing of each block, matched to the with-rendezvous strip by slot.
    const bySlot = new Map(without[feed].frames.map((f) => [f.slot, f]));
    return withR[feed].frames.map((f) => {
      const u = bySlot.get(f.slot);
      if (!u || u.webcamId == null || beatMs === 0) return null;
      const peak = peakOf(groups.get(u.webcamId) ?? []);
      if (!peak) return null;
      const i = u.shownSnapshotIds.indexOf(peak.snapshotId);
      return i < 0 ? null : u.shownAt + (change + i) * beatMs;
    });
  };
  return {
    sunrise: withR.sunrise.frames, sunset: withR.sunset.frames,
    landings: withR.rendezvous.landings, counts: withR.rendezvous,
    ghosts: { sunrise: ghostsOf('sunrise', input.sunrise), sunset: ghostsOf('sunset', input.sunset) },
  };
}
```
(`replayPair` returns `{ sunrise: Strip, sunset: Strip, rendezvous: RendezvousCounts }`; read its actual shape in `replay.ts` and adapt the property names.) `replay.ts` must stay client-safe: it imports only engine/types today; confirm with `grep -n "server-only\|@/app/lib/db" app/lib/solo/replay.ts` (expected empty).

- [ ] **Step 3: Run** `npx vitest run app/studio/solo/projectPair.test.ts` — PASS.

- [ ] **Step 4: Commit**

```bash
git rev-parse --abbrev-ref HEAD | grep -qx feat/solo2-one-tape && git add app/studio/solo/projectPair.ts app/studio/solo/projectPair.test.ts && git commit -m "feat(studio): project both screens from the live state, with and without the rendezvous"
```

---

### Task 4: Move the tape's parts (`tapeParts.tsx`)

**Files:**
- Create: `app/studio/solo/tapeParts.tsx`, `app/studio/solo/tapeParts.test.tsx`
- Modify: `app/studio/solo/Tape.tsx` (imports from `tapeParts`), `app/studio/solo/FeedColumn.tsx`, `app/studio/panels/SoloPanel.tsx` (import paths), `app/studio/solo/Tape.test.tsx`

**Interfaces:**
- Produces, exported from `tapeParts.tsx`, moved VERBATIM from `Tape.tsx`: `THUMB_H`, `TAPE_ZOOMS`, `useTapeZoom`, `TapeTransition`, `TapeDials`, `Thumb` (now exported), `Seam`, `seamBetween`, `SeamMark` (exported), `Playhead` (exported), the `COLOR`/`REPEAT`/`RING`/`mono`/`MIN_BLOCK_PX`/`CUT_STUB_PX` constants (exported), `clock`/`place`/`secs` helpers (exported). `Tape.tsx` keeps only the `Tape` component, importing everything from `./tapeParts`. Behaviour identical.

- [ ] **Step 1: Move**, update imports (`FeedColumn` imports `TapeDials` from `./tapeParts`; `SoloPanel` imports `useTapeZoom` from `./tapeParts`), move the `seamBetween` and `useTapeZoom` tests from `Tape.test.tsx` into `tapeParts.test.tsx`.
- [ ] **Step 2: Run** `npx vitest run app/studio` — PASS with no assertion changed.
- [ ] **Step 3: Commit**

```bash
git rev-parse --abbrev-ref HEAD | grep -qx feat/solo2-one-tape && git add app/studio/solo/tapeParts.tsx app/studio/solo/tapeParts.test.tsx app/studio/solo/Tape.tsx app/studio/solo/Tape.test.tsx app/studio/solo/FeedColumn.tsx app/studio/panels/SoloPanel.tsx && git commit -m "refactor(studio): the tape's parts move to tapeParts.tsx, unchanged"
```

---

### Task 5: `PairTape` — the one tape

**Files:**
- Create: `app/studio/solo/PairTape.tsx`, `app/studio/solo/PairTape.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  export interface PairTapeProps {
    sunrise: StateView; sunset: StateView;          // server state (past, current, entries)
    projection: PairProjection;                      // from projectPair
    liveDials: Record<Feed, TapeDials>; studioDials: Record<Feed, TapeDials>;
    nowMs: number;
    onSelect: (entry: EntryView, feed: Feed, list: EntryView[]) => void;
    zoom?: number; onZoom?: (z: number) => void;
  }
  export function PairTape(props: PairTapeProps): JSX.Element
  export function layoutStrip(...)  // pure: blocks with startMs/endMs for one feed — exported for tests
  ```

The component, in order:

1. **The axis.** `originMs = min over both feeds of (tape[0]?.shownAt ?? current?.shownSince ?? nowMs) − 8 × beatS × 1000`; `endMs = max over both of the last projected block's `shownAt + dwellMs`; `px = PX_PER_S × zoom`; `x = (ms) => (ms − originMs) / 1000 × px`; the scroll content is `width = x(endMs) + 40`. A `useEffect` on `[nowMs rounded to the minute, zoom]` scrolls so `x(nowMs)` sits at 2/3 of the viewport (same rule as today's seam scroll).
2. **`layoutStrip(feed)`** (pure, exported): returns `Block[]` in time order, `{ kind: 'past' | 'current' | 'next', startMs, endMs, entry, frames: EntryView[] /* the run, by shownSnapshotIds resolved against entries; [entry] when unknown */, cut: EntryView[] /* cap-cut frames before the run, from runOf(entry, entries, true) minus frames */, dropped: EntryView[] /* Task: the camera's series frames between the first and last kept climb frame that are not in `frames` and precede the peak */, grown: number, peakAtMs, rendezvous, ghostMs, held, repeat }`. Past: `endMs` measured as today (next `shownAt`, else `currentSince`), `held` and the 3-dwell cap as today; current: `[shownSince, endsAtMs]`; next: from `projection[feed][i]` (`shownAt`, `+ dwellMs`), with `frames` from `shownSnapshotIds`, `dropped` computed from the camera's series (`cameraGroups(entries)`), `grown` from the frame, `ghostMs` from `projection.ghosts[feed][i]`.
3. **Rows.** Three absolutely-positioned rows inside the scroll content: sunrise strip (height `THUMB_H × zoom + 22` for labels), the ruler (24 px: minute ticks with the clock, the beat grid as faint 1 px lines every `beatS`, the NOW line labelled), sunset strip. Each block is a `Thumb` at `left: x(startMs)`, `width: max(MIN_BLOCK_PX, x(endMs) − x(startMs))`; a run's frames are sub-`Thumb`s each `beatS × px` wide (the last one takes the rest), the current block carries the `Playhead` and the ring, past blocks the `held` tag; cut stubs are `CUT_STUB_PX`-wide `Thumb`s (dim, dashed) overlaid ending at `x(startMs)` (negative offset, `zIndex 1`); dropped stubs are the same width, orange top edge (`borderTopColor '#f5a344'`, `borderTopWidth 3`), centred on the junction between the kept frames they were between; grown frames get the orange top edge. Seams between consecutive blocks of a strip: `SeamMark` positioned at `x(boundary)` (centred). The peak ring on the run's peak frame as today.
4. **Ties.** For each `projection.landings[i]`: a 2 px orange line at `x(atMs)` spanning all three rows (`zIndex 3`, `pointerEvents none`) with the time on the ruler. Past ties: for each sunrise past row with `rendezvous && peakAtMs != null` (and symmetric), if the other feed has a row (past or current) with the same `peakAtMs`, one line at `x(peakAtMs)`.
5. **Ghosts.** For a next block with `ghostMs != null && peakAtMs != null && |ghostMs − peakAtMs| ≥ beatS × 1000`: a grey triangle (`borderTop 7px solid #4b5568`) at `x(ghostMs)` on the strip's top edge, `title` "peak would land here without the rendezvous".
6. **Labels** under a next block: `[dropped N] [grew +N] [peak moved ±S s]` joined by ` · `, 10 px mono, only the parts that apply.
7. **Empty states**: no draws logged → the strip says so at the left as today; nothing on glass → a black `blank` block over the current span (or one still wide).
8. The zoom cell sticks at the left as today.

- [ ] **Step 1: Tests** (`PairTape.test.tsx`, fixtures built with a `view()` helper and a `projection` object by hand; fake `Date`):
  1. **one axis**: a sunrise past block starting at `T` and a sunset projected block starting at `T` have equal `style.left`.
  2. **a tie spans the rows**: with one landing at `L`, exactly three `tape-tie` elements (one per row) all at `x(L)`, and the ruler's one carries the clock text.
  3. **a past tie**: sunrise past row `{ rendezvous: true, peakAtMs: P }`, sunset past row `{ peakAtMs: P }` → one past tie at `x(P)`; a sunrise row with `peakAtMs` but no matching sunset row → none.
  4. **dropped stubs in place**: a projected block whose camera series is ids 1–6, kept `[1, 4, 6]`, peak 6 → two stubs (`tape-dropped-2`, `tape-dropped-3` … one per dropped id) with the orange top edge, positioned between the kept frames' x, and the label `dropped 3`.
  5. **grown edge and label**: a block with `grown: 2` → its last two sub-blocks carry the orange top edge, label `grew +2`.
  6. **ghost**: `ghostMs = peakAtMs + 8_000` → one `tape-ghost` at `x(ghostMs)` and the label `peak moved −8 s`; equal → none.
  7. **beat grid**: with `beatS: 4`, adjacent `tape-beat` lines are `16 px` apart at zoom 1.
  8. **solo**: a projection with no landings and null ghosts renders two strips and no ties/ghosts.
  9. **click**: clicking a projected block's last frame calls `onSelect` with that entry, that feed, and a list containing it.

- [ ] **Step 2: Implement** as described; keep `PairTape.tsx` under ~400 lines by putting `layoutStrip` and the block types in `app/studio/solo/pairLayout.ts` (pure, tested by the layout-specific cases above) if it grows past that.

- [ ] **Step 3: Run** `npx vitest run app/studio/solo/PairTape.test.tsx` — PASS.

- [ ] **Step 4: Commit**

```bash
git rev-parse --abbrev-ref HEAD | grep -qx feat/solo2-one-tape && git add app/studio/solo/PairTape.tsx app/studio/solo/PairTape.test.tsx app/studio/solo/pairLayout.ts app/studio/solo/pairLayout.test.ts && git commit -m "feat(studio): one tape for two screens — ties, ghosts, dropped and grown frames on one time axis"
```
(Omit the `pairLayout` files from the command if they were not created.)

---

### Task 6: Mount it; retire the per-feed tape

**Files:**
- Modify: `app/studio/panels/SoloPanel.tsx`, `app/studio/panels/SoloPanel.test.tsx`
- Modify: `app/studio/solo/FeedColumn.tsx`, `app/studio/solo/FeedColumn.test.tsx`
- Delete: `app/studio/solo/Tape.tsx`, `app/studio/solo/Tape.test.tsx`

**Interfaces:**
- `SoloPanel` computes `projectPair({ sunrise: sunrise.server, sunset: sunset.server, dials: sunrise.projected.dials, version, nowMs, horizonMs: 10 × 60_000 })` in a `useMemo` keyed on the two server views, the studio dials and the minute; renders `<PairTape …>` above the two-column grid, full width, with the tape open/closed toggle (`useTapeOpen`, moved from `FeedColumn`) in its own header line reading `tape · sunrise above, sunset below · now at the white line`; the pop-up list for a tape click is the block's frames.
- `FeedColumn` loses `Tape`, `useTapeOpen`, `tapeDials`, `tapeList`, `tapeZoom`/`onTapeZoom` props and the header's tape button; keeps the "next frame in N s" countdown, the bins and the queue.
- `tapeDials(d, feed)` moves to `SoloPanel` (or `tapeParts`) since the panel builds `liveDials`/`studioDials` per feed for `PairTape`.

- [ ] **Step 1: Tests** — `SoloPanel.test.tsx`: renders one `pair-tape` and two feed columns; the tape toggle hides it; clicking a tape block opens the modal at that frame. `FeedColumn.test.tsx`: remove the tape cases (they moved), keep the rest green.
- [ ] **Step 2: Implement**; delete `Tape.tsx` + its test; `grep -rn "from './Tape'\|solo/Tape'" app` must be empty.
- [ ] **Step 3: Run** `npx vitest run app/studio` — PASS.
- [ ] **Step 4: Commit**

```bash
git rev-parse --abbrev-ref HEAD | grep -qx feat/solo2-one-tape && git add -A app/studio/panels/SoloPanel.tsx app/studio/panels/SoloPanel.test.tsx app/studio/solo/FeedColumn.tsx app/studio/solo/FeedColumn.test.tsx app/studio/solo/Tape.tsx app/studio/solo/Tape.test.tsx && git commit -m "feat(studio): the panel mounts the one tape; the per-feed tapes retire"
```

---

### Task 7: The dwell line names the landing (spec §4.2)

**Files:**
- Modify: `app/studio/solo/DwellBudget.tsx`, `.test.tsx`; `app/studio/Rail.tsx`; `app/studio/StudioClient.tsx`

**Interfaces:**
- `DwellBudget` gains `landings?: Record<Feed, { atMs: number; rendezvous: boolean } | null>`; under the dwell line it prints one line per screen that has one: `sunrise lands 5:41:08 with the sunset screen` when `rendezvous`, `sunrise pins 5:41:08` otherwise; nothing when null. `StudioClient` derives it from `sunrise.server?.current` / `sunset.server?.current` (`peakAtMs`, `rendezvous`) and passes it through `Rail` beside `runFrames`.

- [ ] **Step 1: Test** — two cases in `DwellBudget.test.tsx` with a pinned clock.
- [ ] **Step 2: Implement**; the time formatted with the tape's `clock` from `tapeParts`, plus seconds (`hour: 'numeric', minute: '2-digit', second: '2-digit'`).
- [ ] **Step 3: Run** `npx vitest run app/studio/solo/DwellBudget.test.tsx app/studio/Rail.test.tsx app/studio/StudioClient.test.tsx` — PASS.
- [ ] **Step 4: Commit**

```bash
git rev-parse --abbrev-ref HEAD | grep -qx feat/solo2-one-tape && git add app/studio/solo/DwellBudget.tsx app/studio/solo/DwellBudget.test.tsx app/studio/Rail.tsx app/studio/StudioClient.tsx && git commit -m "feat(studio): the dwell line says where each screen lands"
```

---

### Task 8: Suite, lint, build, PR

- [ ] `npx vitest run && npm run lint && npm run build` — green, no new warnings, `/studio` in the route list.
- [ ] Push with the gh credential helper; PR against `main`: `feat(studio): one tape for two screens — the rendezvous is one line through both`; body: what (three sentences), that the per-feed tapes are gone, what to look for on signed-in /studio (the ties, the ghosts, the dropped stubs, the beat grid, the auto-scroll to now), no migration; attribution lines.
- [ ] Comment on issue #200.

---

## Self-review

**Spec coverage:** §4.1 one axis, two strips, one now, one scroll → Task 5 (1, 3); beat grid → Task 5 (3); rating bar + peak ring → carried by `Thumb` (Task 4) and the run sub-blocks (Task 5); dropped stubs in place with the orange edge, grown at the tail → Task 5 (3, 6) with data from Tasks 2–3; the tie through both strips with the time → Task 5 (4), past ties from Task 1's columns; the ghost and the labels → Task 5 (5, 6) from Task 3's second projection; the bins stay in `FeedColumn` → Task 6. §4.2 the landing line → Task 7. Legibility rule (viewer sees only sunsets): nothing here touches the glass.

**Placeholders:** Task 5 is prose with exact rules and test cases rather than full component code (a ~400-line component); everything it needs is named with exact values. Task 3 carries its code, with one instruction to adapt to `replayPair`'s actual result shape.

**Type consistency:** `PairProjection` (Task 3) is what `PairTape` consumes (Task 5) and `SoloPanel` computes (Task 6); `TapeEntry.peakAtMs/rendezvous/shownSnapshotIds` (Task 1) are read by `projectPair` (Task 3) and `layoutStrip` (Task 5); `ReplayOptions.pinnedAtMs` (Task 2) is set by Task 3's `options()`.
