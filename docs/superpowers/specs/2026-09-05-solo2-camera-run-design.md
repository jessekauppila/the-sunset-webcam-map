# solo2 — the camera run, a playing preview, and the caption locked on centre

**Date:** 2026-09-05
**Status:** built; PR #145 (`feat/solo2-camera-run`), awaiting Jesse's signed-in look and merge.
**Amends:** `2026-09-04-solo2-rhythm-design.md` §4.1, §4.2, §4.4, §5.4;
`2026-09-04-solo-kiosk-design.md` §2 (the unit) for `solo2` only.
**Coordinates with:** `2026-09-05-one-studio-design.md` (branch
`docs/one-studio`, unbuilt). Its §10 lists this branch. Its phase C
("preview plays") is delivered here for solo2 in `GlassPreview`; the one
studio lifts it into `useSoloPreview` when it builds.

## 1. What Jesse saw, and what it was

On 2026-09-05, on `/studio/solo` with the glass on `solo`:

| seen | cause |
|---|---|
| the previews are portrait | the shared `panelPreset` was never set; its default is `dell` (1080 × 1920). A setting, not code: `dell-l` on `/studio`. Noted here so it is not re-diagnosed. |
| frames of one camera are not grouped | grouping is solo2's prelude, off by default, and the page was solo's |
| with the prelude on, not every frame plays | the frames dial caps the run at 3; the budget rule then drops the oldest to keep a 3 s hold; and only frames **older than the chosen** count, so a newer frame stays a separate entry and comes back alone |
| no fading anywhere | the studio preview drew `SoloFrame` with `previous={null} fadeS={0}`: it never showed a transition. The glass was on `solo`, which only has `fade`. |
| `CAM 1/4` on the last row of a group | the tag hangs on the chosen frame, which the prelude puts last |
| the caption gap "goes up then down" as picture height is dragged | the caption is anchored to the panel bottom and the picture grows down from a fixed top offset; the two meet, then the caption is pushed off |

## 2. Decisions

1. **In solo2 the draw unit is the camera.** A camera's frames in the bin
   are one item that moves together. `solo` keeps the frame as its unit and
   is not touched.
2. **A dwell runs the camera's frames oldest to newest, evenly.** Every
   frame plays; no cap, no hold floor. Frames dissolve into each other over
   the same-camera fade. The caption and scores are those of the frame on
   glass, every frame.
3. **Every frame that played counts as shown.** The whole camera rests as
   one; nothing comes back alone.
4. **The studio preview plays the run** with the studio dials, so the
   dissolves and the camera-change transition are visible and dialled from
   the same page.
5. **The picture is locked on centre; the caption hangs a gap below its
   foot.** Two dials go away.
6. **`Sunrise:` / `Sunset:` may prefix the title**, one caption dial.
7. **The frame pop-up steps through its column** with arrows, and says when
   the picture was taken.

## 3. The camera run (engine)

### 3.1 Groups

`cameraGroups(entries)` in `app/lib/solo2/run.ts`: every entry keyed by
`webcamId`, frames sorted by `capturedAt` then `snapshotId`. Pure.

Each group is represented to the rules by **one synthetic `BinEntry`**,
built from its **newest** frame (its `snapshotId`, `webcamId`, `enteredAt`,
`capturedAt`) with these fields aggregated over the group:

| field | value | why |
|---|---|---|
| `bin` | the bin of the group's best-scored frame | a camera with any sunset frame is a sunset camera |
| `quality` | max over the group | the best picture is what earns the turn |
| `detection` | max over the group | same |
| `tally` | max over the group | how often this camera has been on glass |
| `lastShownAt` | max over the group (null if none) | when this camera was last on glass; a new frame must not make a camera read "never shown" |
| `isNew` | any | the promote-new bonus is a camera bonus |

`next2` runs solo's `choosePool` and its own rule-3 comparators over the
synthetic entries, then returns the **real** newest frame of the chosen
group. Rule 4 ("never the same frame twice in a row") compares the
synthetic id, which is the newest frame's, against the screen's
`lastSnapshotId`. When a newer frame arrives for the camera on glass, the
camera is no longer "on glass" by id but rests by `lastShownAt`, which is
the intended behaviour.

With **`camera run` off** every frame is its own group of one, and solo2
behaves exactly as `solo` plus rhythm, lead, transition and local time.

### 3.2 The run

`runOf(entry, entries, dials)`: the frames of `entry`'s camera captured at
or before `entry`, oldest first, `entry` last. `[entry]` when the dial is
off. Pure over what the state endpoint already returns, as the prelude
was; a frame that leaves the bins simply shortens the run.

The `previous` frame no longer trims the run: a camera drawn twice runs
from its oldest frame again, because the group rested in between and the
sun dropping is the point.

### 3.3 Shown

`SoloVersionSpec` gains `shown(entries, pick, dials): BinEntry[]`: the
frames a draw of `pick` puts on glass. `solo` returns `[pick]`; `solo2`
returns `runOf(pick, …)`. `project2` marks every one (tally, isNew,
lastShownAt) after each draw; the advance route passes their ids to
`commitAdvance`, which updates them in one statement. `solo`'s
`commitAdvance` call passes one id, so nothing changes for it.

### 3.4 Stages and the view

`assignStages` and `buildStateView` are unchanged: they see frames. Run
members other than the representative get whatever stage the frame rules
give them, and the studio folds them under their representative (§5.2),
so the API needs no new shape.

## 4. The dwell (glass)

### 4.1 Plan

`DwellPlan` becomes `{ dwellS, frames, stepS, leadS }` with
`stepS = dwellS / frames`. `fitPlan(dials, frames)` replaces the budget
rule; nothing is dropped, so `clamped` and `MIN_HOLD_S` go. `stageAt`
returns `{ index, leadProgress }`: `index = min(frames − 1, floor(t / stepS))`;
the lead runs over the last `leadS` seconds of the dwell whichever frame is
up, as today. `describePlan` prints `4 frames × 5 s` (`1 frame · 20 s` when
the camera has one), plus ` · lead 4 s` when lead is on.

### 4.2 Timeline of one dwell

For a dwell `D` beginning at `B`, with `k` frames and `t = D / k`:

| from | what |
|---|---|
| `B` | arrival (§4.3) into frame 1; its caption and scores mount with it |
| `B + i·t` | frame `i + 1` dissolves in over the **same-camera fade**, capped at `t`; caption and scores switch to it |
| `B + D − L` | the frame on glass begins the lead push |
| `B + D` | the next dwell |

`Solo2Frame` keeps its stacked layers; `prelude` becomes `run` (the whole
sequence, `entry` last) and the caption is drawn for `run[index]` rather
than only on the main stage. `useStage` is unchanged apart from the plan's
fields.

### 4.3 Transitions, said plainly

The mechanics of §4.2 of the rhythm spec stand. The dials are relabelled
and described so they read without the spec (keys unchanged, so stored
values survive):

| key | label | description |
|---|---|---|
| `transition` | camera change | How the screen goes from one camera to another. **cut**: the new picture simply replaces the old. **crossfade**: the old picture fades out while the new one fades in on top of it. **dip**: the old picture fades to black, then the new one fades up from black. |
| `fadeS` | camera change (s) | How long a crossfade takes, or a dip (down plus up). Ignored by cut. |
| `sameCameraFadeS` | same camera (s) | How long one frame of a camera takes to dissolve into the next inside the run. Never through black. 0 is a cut. |

The `prelude`, `preludeFrames` and `preludeStepS` dials are removed and
**`cameraRun`** (label `camera run`, boolean, default **on**) takes their
place at the top of the glass group: "A camera's frames are one item in
the bin; a dwell plays them oldest to newest, evenly, dissolving between
them." Values stored for the removed keys are dropped by `mergeSettings` as
any unknown key is.

## 5. The studio

### 5.1 The preview plays (solo2)

`GlassPreview` takes the version. For `solo2` it draws `Solo2Frame` with the
studio dials: the on-glass entry's run (from the server's `entries`), and a
stage from a **looping local clock** — `useLoopingStage(plan)` restarts at
`0` whenever the entry changes and wraps at `dwellS`, so the run plays
over and over at the studio's dwell while the glass holds on the live
one. `previous` is tracked as the kiosk tracks it, so a camera change on
the glass plays the studio's transition dial in the preview. No advance is
posted. For `solo` the preview is today's static `SoloFrame`.

### 5.2 One box per camera

`FeedColumn`, when the projected dials have `cameraRun` on, folds every
frame under its camera's representative: the representative's stage and
bin decide where the box sits; the other frames leave their own
positions. The box is the existing group rendering (`EntryRow` with a
`sequence`), read top to bottom oldest to newest, the newest last with the
row's annotations. Every strip is labelled **`i/k · local time`**, so the
count is on the first picture as Jesse asked, and the `CAM n/m` and
`PRELUDE` tags go. `REPEAT` stays.

A queue with `cameraRun` on lists each camera once per draw; `camCount`
and `preludedInQueue` are deleted.

### 5.3 The pop-up steps through its column

`SoloStudioClient`'s modal receives the flat list its row came from (the
column's boxes in order, each box's frames oldest to newest) and the index
of the clicked frame. `←` / `→` buttons and the arrow keys move through
the list; the header line reads
`frame 1234 · sunset bin · shown ×2 · taken 7:14 pm there · 5 Sep`.
`FrameLabelCard` is unchanged.

### 5.4 Readouts

`DwellBudget` prints §4.1's line for the camera on glass (frames = the
run's length; `1 frame` when nothing is on glass). `RulesBox` rule 3 says
"In a bin, cameras: never shown first, …" when `cameraRun` is on.

## 6. The caption

### 6.1 Geometry

`pictureRect`: inset keeps the panel's aspect at `pictureHeight` percent,
centred both ways: `top = round((height − h) / 2)`. `pictureTop` is
removed.

`captionBox`: inset always hangs the caption `captionGap` below the
picture's foot. `captionAnchor` is removed. `captionAlign` stays. At a
picture too tall for the caption the caption leaves the panel; the studio
preview shows it, which is the signal to lower the dial. The dial's
description says so.

This is shared caption code: `solo` draws the same way. That is the
intent.

### 6.2 Feed prefix

`feedPrefix` (label `screen name`, boolean, default **on**, shared caption
section): the title line begins `Sunrise: ` on the sunrise screen and
`Sunset: ` on the sunset screen. `captionLines` takes the feed;
`Caption`, `SoloFrame`, `Solo2Frame` and `GlassPreview` pass it through.

## 7. Files

New: `app/lib/solo2/run.ts` (+ test).

Changed: `app/lib/solo2/{engine,plan,settingsSchema,types}.ts`,
`app/lib/solo/{versions,store,caption,captionSchema,types}.ts`,
`app/api/kiosk/solo/advance/route.ts`,
`app/components/solo2/{index,Solo2Frame,useStage}.tsx`,
`app/components/solo/{SoloFrame,Caption}.tsx`,
`app/studio/solo/{GlassPreview,FeedColumn,EntryRow,DwellBudget,RulesBox,SoloStudioClient}.tsx`,
and their tests. Deleted: `app/lib/solo2/prelude.ts` (+ test).

Nothing for the database. Nothing for the Pi beyond the usual reload.

## 8. Out of scope

- Grouping in `solo`. It stays the frame-unit version.
- A floor on the per-frame share. A camera with twelve frames gets under
  2 s each at a 20 s dwell; ship, watch the glass, add a floor only if it
  looks frantic.
- The one-studio consolidation. This lands first; that spec reconciles.

## 9. Testing

- `run.test.ts`: groups by camera in capture order; the synthetic entry
  aggregates as §3.1's table; `runOf` is oldest → newest with the entry
  last, `[entry]` when off.
- `engine.test.ts` (solo2): with `cameraRun` on a camera appears once per
  draw and its run is marked shown; with it off every existing fixture
  still reproduces.
- `plan.test.ts`: even shares; `stageAt` walks them; lead on the last
  seconds; `describePlan` wording.
- `Solo2Frame.test.tsx`: the caption follows the stage; layers dissolve
  over the same-camera fade capped at the share; cut / crossfade / dip
  arrivals unchanged.
- `caption.test.ts`: the picture is centred; the caption is always the gap
  below its foot, on any panel size; the feed prefix.
- `GlassPreview.test.tsx`: solo2 mounts `Solo2Frame` and advances on a fake
  clock without fetching.
- `FeedColumn.test.tsx` / `EntryRow.test.tsx`: one box per camera with
  `i/k` labels; no `CAM`/`PRELUDE` tags.
- `SoloStudioClient` modal: arrows move through the list; the taken-at line.
- advance route test: every run frame's tally moves.
