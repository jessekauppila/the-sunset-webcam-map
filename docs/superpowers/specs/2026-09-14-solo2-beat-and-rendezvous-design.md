# solo2 — the beat, and the rendezvous on it

**Date:** 2026-09-14
**Issue:** #200 (`speced`) — the spine for the build; this doc is its design.
**Status:** designed, not built.
**Amends:** `2026-09-06-solo2-dwell-budget-design.md` §3 (the budget rule is
restated in beats) and `2026-09-05-solo2-camera-run-design.md` §3.2 (the run
window is around the peak, not against the newest frame).
**Supersedes:** `2026-09-10-solo2-step-ceiling-design.md` and issue #198. With a
constant beat there is no step to clamp; the case #198 was written for, a
two-frame run holding ten seconds a picture, is answered by §2.3.
**Applies to `solo2` only.** `solo` keeps its fixed grid.
**Mockup:** https://claude.ai/artifact/LUwr7JrUiqC2JwVU1oNS2F — tonight's live
pool as two filmstrips on one time axis, with the beat and the rendezvous as
toggles. The page is a design aid; nothing in it is code to keep.

## 1. What prompted it

Jesse, after the 2026-09-12 showing: the piece needs a visual opening. Inside a
camera run there is usually one frame that is the best, and the two screens
could land on their best frames at the same instant. Not every run — the good
ones. Between those moments the screens go their own way.

Two measurements over the last ten days of `kiosk_bin_entries`:

| series | count | peak − median quality | peak is the newest frame | peak in the last quarter |
|---|---|---|---|---|
| 10+ frames | 341 | 0.17 | 9 % | 32 % |
| 5–9 frames | 998 | 0.13 | 15 % | 33 % |

So the per-frame rating does pick out one peak, and the peak is almost never
the newest frame. Today's run plays oldest to newest and its window sits
against the newest frame (camera-run spec §3.2), so a long run climbs through
the peak and keeps going onto greyer pictures.

Three decisions came out of the conversation, all Jesse's:

1. **A beat.** Every frame change on both screens lands on one tick of the
   wall clock. Holds and fades are whole beats. Runs can be any number of beats
   long.
2. **Fit by dropping or adding frames, never by changing the rate and never
   by holding.** A frame is a beat; the count of frames is the only knob.
3. **The rendezvous is a tick number.** Both peaks on the same tick.

The first makes the third a one-number problem. That is why they are one spec.

## 2. The beat

### 2.1 The grid

A dial **`beatS`** (seconds, default 4). Ticks are the instants
`t = 60·m + k·beatS` for whole `k`, i.e. seconds 0, 4, 8 … of every minute, so
`beatS` is restricted to divisors of 60: 2, 3, 4, 5, 6, 10, 12, 15, 20, 30.
Both screens read the same clock (the Pi's tabs share one machine; the studio
uses its own), so staying in step needs no message.

`beatS` replaces **`minStepS`**. It is not a floor on the step. It *is* the
step.

### 2.2 Everything is whole beats

| thing | today | on the beat |
|---|---|---|
| a frame inside a run | `max(minStepS, dwellS / n)` | 1 beat |
| a single image (a run of one) | `dwellS` (13 s) | `dwellBeats` beats (default 3 → 12 s) |
| the camera change | `fadeS` (3 s dip), charged half to each side | 1 beat of veil: the burn-down is the first half, the rise the second. `fadeS` is replaced by **`changeBeats`** (default 1) |
| the dissolve between two frames of one run | `sameCameraFadeS`, capped at half a step | unchanged: it starts on the tick and is capped at `beatS / 2` |
| the dwell floor | `dwellS` as a budget | `dwellBeats`: a run of `n` frames that would total fewer beats **rests on its last frame** (§2.3) |
| the dwell spread by rank | `dwellBoost` / `dwellTrim` percent | unchanged in meaning, applied to `dwellBeats` and rounded to whole beats |

A dwell of `n` frames occupies `changeBeats + n + restBeats` beats.
`restBeats` is §2.3. The dwell **ends on a tick**, and the next dwell begins on that tick,
so every screen change of either screen is on the grid.

### 2.3 The dwell floor rests on the last frame

`restBeats = max(0, dwellBeats − n)`. A run of one frame holds
`dwellBeats`; a run of two holds one beat on the first and `dwellBeats − 1` on
the second. The rate never changes, and the extra time goes to the picture the
run arrived at. This is the step-ceiling spec's §2 kept, with the ceiling
itself made unnecessary.

### 2.4 The plan

`DwellPlan` (`app/lib/solo2/plan.ts`) becomes:

```ts
interface DwellPlan {
  beatS: number;
  frames: number;
  changeBeats: number;   // the veil at the front; 0 for cut
  restBeats: number;     // extra beats on the last frame (the dwell floor)
  totalBeats: number;    // change + frames + rest
  peakIndex: number | null;  // which frame is the peak, when the run has one
  leadS: number;         // unchanged; capped at the last frame's hold
}
```

`fitPlan` takes the frames and returns this; `planOf(totalMs, …)` (the
backward form the glass renders from) is no longer needed, because the server
publishes `endsAtMs` on a tick and the plan is integers — a client can only
land on the same beats. `stageAt(elapsedMs, plan)` walks beats: the change,
then one beat per frame, the last frame through the rest. `describePlan`
prints `8 frames · 1 beat change · rests 0` or, in a fit, `6 of 21 · dropped 9`
or `grown +3 for the sunset screen`.

### 2.5 What a viewer sees

At `beatS` 4 and the live dials nothing visibly changes inside a run: the
step floor has been 4 s and nearly every run has been playing at it. What
changes is that the two screens now change frames in the same instant, the
camera change is a whole beat (4 s, not 3), and a still holds 12 s (not 13).

### 2.6 Server and glass

- `POST /api/kiosk/solo/advance` computes `dwellMs = totalBeats · beatS · 1000`
  and `endsAtMs = tickAfter(nowMs) + dwellMs`, where `tickAfter` is the next
  grid instant at or after the request. `shownSince` is that tick, not the
  request time. The kiosk already fires the advance at `endsAtMs`
  (`useSoloGlass.ts`), so the boundary lands on the tick and the next dwell
  starts on it. A late advance (network) starts on the next tick after it
  lands; the screen holds the old picture one beat longer, which is on the
  grid too.
- Nothing about idempotency changes: the slot is still a counter.
- `Solo2Frame` / `useStage` render from `stageAt`; their fade code is
  unchanged except that a change is one beat.
- The studio's preview (`useSoloPreview`) plays on the same grid from the
  studio's own clock.

## 3. The rendezvous

### 3.1 Vocabulary

- **Peak** — the best-rated sunset frame of a camera's series.
- **Landing** — the tick a run's peak goes on glass.
- **Rendezvous** — a landing both screens share.
- **Eligible** — a draw whose camera has a peak and whose sunset rank (the
  existing `qualityRank`, 1 for the strongest sunset present, 0 for the
  weakest) clears the gate.

### 3.2 Dials

A new section **rendezvous** in the `solo2` namespace:

| key | kind | default | meaning |
|---|---|---|---|
| `rendezvous` | boolean | off | the mechanism on or off |
| `rendezvousRank` | 0–1, step 0.05 | 0.6 | a draw is eligible when its camera's sunset rank is at least this. 1 = only the best sunset present; 0 = every sunset |

There is no wait dial. A screen never holds a frame to meet the other; it
adds frames (§3.5).

The rhythm dials (`valleys`, `screens`) keep their meaning. A valley draw is
never eligible. The rendezvous is not folded into `screens` after all:
`alternate` is in use on the glass and the two are orthogonal.

### 3.3 One number through the server

`kiosk_screen_state` gains **`peak_at TIMESTAMPTZ NULL`**: the landing of the
current dwell when that draw was eligible, else null. Written by the advance
that starts the dwell, beside `dwell_ms` and `shown_snapshot_ids`, decided
once against the pool the draw saw. The screens never talk; each reads the
other's row on its own advance.

`kiosk_draws` gains `peak_at TIMESTAMPTZ NULL` and `rendezvous BOOLEAN NOT NULL
DEFAULT false` so replay can count what happened.

### 3.4 The draw, in order

On an advance for feed `F` at tick `t0` (the previous dwell's end), with the
other feed `G`:

1. **Pick** as today: `next2` over the pool, the camera as the unit, the beat
   role from the slot. The rendezvous never chooses the camera.
2. **Not eligible** (no peak, rank below the gate, a valley, or the dial off):
   plan the run as §2 over the window of §3.6.
   `peak_at = null`. Done.
3. **Eligible, and `G.peak_at` is a future tick `T`.** Fit:
   `avail = (T − t0) / beatS − changeBeats` beats before the peak.
   - `avail < 0`: too soon. Plan as step 2; leave `G.peak_at` alone (a later
     draw of `F` may still reach it). Label the draw `no fit · too soon`.
   - `avail ≤ min(P, cap − 1)`: `before = avail`, dropping evenly from the
     climb (§3.5), `after = min(A, cap − 1 − before)`. `F.peak_at = T`,
     `rendezvous = true`.
   - `avail > min(P, cap − 1)`: the climb is too short. Do not start this run
     yet. **Grow the run that is ending** instead (§3.5): answer the advance
     with the same dwell extended by `avail − min(P, cap − 1)` frames of its
     camera taken from the series after the last frame it played, and a new
     `endsAtMs`. The eligible run then starts at the right tick and fits with
     its full climb. If the ending run's camera has no more frames, no fit:
     plan as step 2 and label it `no fit · nothing to add`.
4. **Eligible, nothing to meet.** Pin: plan with the full climb of §3.6,
   `before = min(P, cap − 1)`, which is as late as this run's own frames can
   put its landing. `F.peak_at = t0 + (changeBeats + before) · beatS`. (Bending toward `G`'s next eligible draw is not needed: the
   full climb is already the latest landing, and `G` does the fitting.)
5. `G.peak_at` is cleared by `G`'s own next advance, since its dwell is over.
   There is no "matched" flag: a landing is one instant, `F` cannot draw
   twice before it, and `G` has moved on.

Two advances in the same second both pin; the pair is missed and nothing
breaks.

### 3.5 Dropping and adding frames

The count of frames is the only knob. A frame is one beat, so a peak moves
one beat for every frame dropped ahead of it or added ahead of it.

**Dropping.** `before` frames are chosen from the `P` frames of the series that precede the
peak. When `before ≥ P` all of them play. When `before < P`, keep the frame
nearest the peak and spread the rest evenly across the climb:

```
keep index  round((P − 1) − j · (P − 1) / (before − 1))   for j in 0 … before − 1
```

(`before = 1` keeps only the frame before the peak.) Dropped frames stay in
the bin and are not stamped shown. The run is still a timelapse of the whole
climb, thinned; it never plays out of order and never changes its rate.

After the peak the run plays the series forward, up to `cap − 1 − before`
frames, unthinned. Starts and ends are free: only the landing is shared.

**Adding.** When the climb is shorter than the beats to the partner's tick,
the frames are added to the run *before* the eligible one on the same screen:
that run keeps playing its own camera's night past where it would have
stopped, one frame per beat, so the next run starts later. The server does
this at the advance that would have ended it, by answering "keep going"
(§3.8). Those frames come from the same series (frames the cap cut, in
order); a camera with nothing left cannot grow, and the pair is missed.
Growth is not bounded by a dial: it is bounded by the frames the camera has.

### 3.6 The window is around the peak

Camera-run spec §3.2 put the window against the newest frame. For a camera
with a peak the window is now `before` frames ahead of the peak, the peak,
then `after` frames behind it, with `P` and `A` the frames the series has on
each side and `before + 1 + after ≤ cap`.

There is no fixed split. The climb comes first: a run that is not fitting
plays the whole climb the cap allows, `before = min(P, cap − 1)`, and what the
cap leaves goes after the peak, `after = min(A, cap − 1 − before)`. A fit sets
`before` from the beats available (§3.4 step 3), shorter or longer, and
`after` again takes what is left. So a run may be all climb, all descent, or
anything between, whatever the rendezvous needs; the peak always plays.

For a camera with no sunset frame the window is unchanged (the newest `cap`
frames). The representative's identity (§3.1 there) stays the newest frame, so
rule 4 and `isNew` are untouched; only `runOf` changes.

### 3.8 The "keep going" answer

`POST /api/kiosk/solo/advance` today either advances or repeats the current
state. It gains a third answer: `advanced: false` with the current dwell's
`shownSnapshotIds` extended and a later `endsAtMs`. The kiosk plays on from
where it is (`stageAt` over the longer plan; the frame index does not jump),
and fires the next advance at the new end. `kiosk_screen_state.dwell_ms` and
`shown_snapshot_ids` are updated in place; the draw log's row for that slot is
updated too, so replay sees the run as it actually played. The slot does not
change: growing is not a draw.

### 3.9 Greedy now, search later, one seam

§3.4 is a greedy heuristic: whoever draws first pins, the other fits. The
problem it approximates is small and integer once everything is beats: two
screens, a horizon of two or three draws each, a few dozen frame counts per
run. The exact version is a receding-horizon search — at every advance,
enumerate the joint schedules over the projected queues of both screens,
score each by rendezvous made (weighted by rank) minus frames dropped,
commit only the next draw, repeat next advance. It also chooses pairs, by
letting the enumeration consider the next few eligible candidates rather
than the head of each queue.

The build keeps one seam so the swap costs nothing: the fit is a pure
function `fitNext(mine, theirs, dials) → plan` over both feeds' projected
queues. Greedy ships first, because what it does can be read off the tape
and explained on the wall. Replay (§5) runs both over recorded evenings and
reports rendezvous made and frames dropped for each; if greedy makes most of
what search makes, it stays.

Legibility is for Jesse, in the studio and the replay. The viewer should see
only the sunsets, and two screens that sometimes agree.

### 3.7 Which cameras pair

Whichever the engine picks. Rule 3 (never shown, then longest since shown)
already rotates cameras, so pairs vary on their own. Choosing pairs — a
shallow lookahead over the next few eligible candidates on each side, picking
the pair with the least hold — is a later phase and is not designed here.

## 4. The studio

The two feeds today have two tapes with two clocks. The rendezvous needs one.

### 4.1 One tape for two screens

`Tape.tsx` renders both feeds on one time axis: the sunrise strip above the
ruler, the sunset strip below, one `now` line, one scroll. Each run is drawn
as it is today (thumbnails as wide as their time on glass; cap-cut frames as
fixed-width greyed stubs, from #163) with three additions:

- the beat grid as faint verticals;
- a rating bar under every frame, the peak outlined in the ring colour;
- frames dropped by a fit as greyed stubs **in place** with an orange top
  edge, so a thinned timelapse still reads as the whole sunset; frames a run
  grew by with the same edge at its tail.

A rendezvous is one vertical line through both strips with the time on the
ruler. In the projection, a grey triangle above a run marks where its peak
would land without a rendezvous, and the run's label says `dropped 8`,
`grew +3`, `peak moved +12 s`.

The bins stay in `FeedColumn` as they are: sunrise's two bins to the left of
the tape, sunset's two to the right.

### 4.2 The dwell line

`DwellBudget` prints beats: `6 of 21 frames · 1 beat change · rests 0 · lands
5:41:08 with the sunset screen`, or `no fit · too soon`.

### 4.3 The rules lab (#201)

The lab explains which camera a draw picks; this tape explains when its
frames play. Its planned "format clock" is this beat at the hour scale. A
later phase links a run on the tape to that draw's sieve.

## 5. Replay

`scripts/solo-replay.ts` runs both feeds together on the beat and reports,
per evening: rendezvous made, missed (pins that passed unmet), frames
dropped, frames grown, and the same-order fidelity it reports today. `kiosk_draws.
peak_at` and `rendezvous` make the recorded run reconstructible.

## 6. Migration

```sql
ALTER TABLE kiosk_screen_state ADD COLUMN IF NOT EXISTS peak_at TIMESTAMPTZ;
ALTER TABLE kiosk_draws ADD COLUMN IF NOT EXISTS peak_at TIMESTAMPTZ;
ALTER TABLE kiosk_draws ADD COLUMN IF NOT EXISTS rendezvous BOOLEAN NOT NULL DEFAULT false;
```

Applied before the phase-2 code merges (the ledger rule). Phase 1 needs no
migration.

## 7. Phases

1. **The beat.** `beatS`, `dwellBeats`, `changeBeats` replace `minStepS`,
   `dwellS`, `fadeS` in the `solo2` namespace; the plan in beats; tick-aligned
   `endsAtMs`; the one tape with the grid and the rating bars; replay in beats.
   Ships alone and is visible at once: both screens changing frames together.
2. **The rendezvous.** The window around the peak; `peak_at`; the fit and the
   pin; the three dials; ties, ghosts and labels on the tape; the replay
   counts. Flag off by default; turned on from /studio.
3. **Later, not designed:** the search version of the fit (§3.9); a text
   entry point for the piece (parked from the same conversation).

## 8. Testing

- `plan.test.ts`: whole beats only; `restBeats` on a one- and two-frame run;
  `stageAt` walks change → hold → frames → rest; a dwell always ends on a
  tick.
- `run.test.ts`: the window around the peak; `pick` keeps the frame nearest
  the peak and spreads the rest; `before ≥ P` plays everything; a camera with
  no peak keeps today's window.
- `engine.test.ts`: fit on a future tick lands the peak on it by dropping; a
  short climb grows the ending run instead and never holds; too soon leaves
  the pin; a pin is the full climb; a valley is never eligible; two same-tick
  pins both pin.
- `advance.test.ts`: `peak_at` written and cleared; `shownSince` on a tick;
  the keep-going answer extends the dwell without a new slot.
- `Tape.test.tsx`: one axis for two feeds; a tie spans both strips; dropped
  stubs sit in place; the ghost marks the unfitted landing.
- Replay: the counts above on a recorded evening, and same-order fidelity
  unchanged at `rendezvous` off.
