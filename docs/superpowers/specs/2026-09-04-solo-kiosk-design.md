# Solo kiosk — one frame per screen, drawn from server-owned bins

**Date:** 2026-09-04
**Status:** Design approved in conversation (visual companion session,
mockups in `.superpowers/brainstorm/83245-1788567565/content/studio-v3.html`).
**Predecessors:** `2026-08-30-kiosk-studio-control-and-mosaic-v2-design.md`
(settings profiles, Deploy, the schema-driven rail),
`2026-09-02-terminator-pool-coverage-design.md` (the swept zone),
`2026-09-02-camera-refresh-cost-design.md` (Windy's 10.1-minute clock).
**Show:** opening night Fri 2026-09-12, freeze Wed 2026-09-10.

---

## 1. What this is

A second kiosk mode beside the mosaic. Each landscape screen shows **one
archived frame at a time**, sunrise on the left screen and sunset on the
right, changing on a staggered rhythm. Which frame comes next is decided by a
**per-screen ordering algorithm over two bins**, a sunset bin and a
non-sunset bin, whose state lives on the server so the studio and the glass
read the same truth.

The studio for this mode exists to make that algorithm **legible**: the frame
on glass, its queue, and both bins are visible under each panel with every
score, tally, and reason on display, and the dials that change the algorithm
are visually distinct from the dials that change what the glass draws.

The mode is fully reversible: the mosaic is one dial away.

### Fixed directives (identity of the piece, not knobs)

- One frame fills the screen. Never a grid.
- Sunrise left, sunset right, landscape.
- The score shown for a frame is the score of **that exact picture**.
- Best sunsets first; then as many different pictures as possible; repeat
  only when both are exhausted.
- Nothing ever silently drops out of the bins. Removal has a stated reason.

---

## 2. Vocabulary (extends CONCEPTS.md)

- **Frame** — one archived picture from one camera at one minute, with its own
  scores. The unit of everything in this mode. A camera is only a grouping.
- **Bin** — a per-Feed, per-kind ordered set of frames waiting to be shown.
  Two kinds: **sunset bin** (detection head says sunset, ordered by quality)
  and **non-sunset bin** (detection head says not, ordered by detection
  probability, so "almost a sunset" sits on top).
- **Queue** — the play order for one screen, computed from both bins by the
  rules in §4. The frame on glass is the head of the queue. A frame in the
  queue is not shown in its bin: every frame lives in exactly one place.
- **Tally** — how many times a frame has been on glass. Displayed as
  `shown ×N`. Never resets; the frame leaves the bin instead.
- **Rest** — the draws a frame sits out after it has been on glass. Dial
  **rest** (0–12 draws, default 4). Measured from `last_shown_at` in slots
  of the current dwell.
- **Zone** — the union of solar altitudes the sweep gathers,
  `TERMINATOR_POOL_COVERAGE_DEG` widened by whichever escalation rings ran.
  A camera outside it leaves the bins.

---

## 3. Why frames, not cameras

The live pool hands the mosaic one row per camera: a Windy preview URL whose
picture silently rotates every 10.1 minutes, plus a score copied from whatever
picture the cron scored last. "This image" has no identity, and the score on
a tile may belong to a different picture than the one on screen.

Every rule the operator asked for ("shown before", "new picture from this
camera goes near the top") is a statement about pictures. So the bin entry is
an **archive row**: `webcam_snapshots.id`, a permanent
`storage.googleapis.com` URL, and the two ONNX head scores for that picture.
The glass draws the archived image, so the caption is true by construction.
The cost is a small lag behind Windy's live preview, which is fine.

Verified 2026-09-04: no Claude scoring path remains in the app; the last
`llm_*` row was written 2026-07-31. The glass runs on the ONNX heads.

---

## 4. The ordering rules

Stated once, in the order they apply. The studio prints this list with the
live dial values substituted, so the rule on screen is always the rule in
force.

1. **Choose the bin.** Count the sunset-bin frames that are eligible, not on
   glass and not resting. If there are at least **sunset floor** of them
   (0–12, default 6), draw from the sunset bin. Otherwise interleave: **mix**
   sunsets per non-sunset (1–6, default 2), counted as a streak that resets
   on each non-sunset draw. If one bin has no such frames, draw from the
   other. A floor of 0 means sunsets whenever any sunset is ready. To never
   show non-sunsets, set the detection floor to 1.
2. **A shown frame rests.** For **rest** draws (0–12, default 4) after it
   was on glass, a frame is not a candidate in either bin. Rest is counted in
   slots of the current dwell from `last_shown_at`; a frame never shown is
   never resting. If every eligible frame is resting, rest is waived for
   that draw and rule 4 alone applies.
3. **Within a bin, least shown first, then best.** Lower tally first; then
   sunset bin by quality, non-sunset bin by detection probability. **Promote
   new frames** (boolean, default on) adds +0.10 to a frame that arrived
   while an older frame from the same camera was already in the bin; the
   flag clears the first time it is shown. Remaining ties break by earlier
   `entered_at`, then snapshot id.
4. **Never the same frame twice in a row on one screen.** If it is the only
   eligible frame, it repeats.
5. **Floors.** Sunset bin: quality ≥ **quality floor** (0–1, default 0.55).
   Non-sunset bin: detection probability ≥ **detection floor** (0–1, default
   0.30). Frames below a floor stay in the table, render dimmed with a FLOOR
   tag, and are not eligible.

Worked cases, floor 6, mix 2, rest 4:

- One good sunset and eight non-sunsets: `S, N1, N2, N3, N4, S, N5, N6, N7,
  N8, S, N1 …`. The sunset returns every fifth draw; with rest 0 it would
  alternate `S, N1, S, N2 …`, the sunset-heavy shape the operator rejected.
- Five sunsets and thirty-five non-sunsets (the 2026-09-05 sunrise screen):
  `S1, S2, N, S3, S4, N, S5, S1, N …`. Two of every three draws are sunsets
  no matter how large the non-sunset bin grows. Under the earlier
  tally-across-bins rule this screen queued no sunset for 20-plus draws.
- Twenty sunsets: sunsets only, since at least six are always rested. A
  rich night shows no non-sunsets unless the floor is raised above the bin.

History: until 2026-09-05 rule 1 was "lowest tier across both bins", tier
being tally minus a **sunset repeat allowance** (0–3). It made each bin's
airtime proportional to its size, which starved the sunsets whenever the
non-sunset bin was several times larger. The allowance dial is gone; stored
values are ignored.

The engine is a **pure function**:
`next(entries, dials, screenState, slot, feed) → entry | null` and
`project(entries, dials, screenState, n, firstSlot, feed) → entry[]`. No
clock, no I/O; time enters only as the slot and each entry's `last_shown_at`.

---

## 5. Data

### 5.1 `kiosk_bin_entries` (new table)

| column | type | notes |
|---|---|---|
| `id` | bigserial pk | |
| `feed` | text | `sunrise` \| `sunset` |
| `bin` | text | `sunset` \| `non_sunset` |
| `snapshot_id` | bigint fk `webcam_snapshots` | unique with `feed` |
| `webcam_id` | int fk `webcams` | grouping + zone checks |
| `quality` | real | `ai_regression_score`, calibrated per §5.4 |
| `detection` | real | `ai_binary_score` (probability) |
| `is_new` | boolean | rule 3 promotion flag |
| `tally` | int default 0 | |
| `entered_at`, `last_seen_at`, `first_shown_at`, `last_shown_at` | timestamptz | |
| `out_of_zone_polls` | int default 0 | rule in §5.3 |
| `removed_at`, `removed_reason` | timestamptz, text | `left_zone` \| `expired` \| `manual` |

Index on `(feed, removed_at, bin)`. Removed rows are kept for the day so the
studio can show what left and why; a nightly cleanup deletes rows removed
more than 48 hours ago.

### 5.2 `kiosk_screen_state` (new table, two rows)

| column | notes |
|---|---|
| `feed` pk | |
| `current_snapshot_id` | head of the queue, on glass now |
| `shown_since` | when it went on glass |
| `slot` | the schedule slot index it was drawn for (§6.2 idempotency) |
| `sunset_streak` | rule 2 counter |
| `last_snapshot_id` | rule 4 |

### 5.3 Admission and removal, in the cron

The cron moves from `*/15` to `*/10`, matching Windy's 10.1-minute publishing
clock so roughly a third fewer published pictures go unscored. This is the
1.5× cadence option the refresh-cost spec priced and set aside; the show is
the reason to take it. It reverts after the show.

Per scored frame whose hash changed and whose camera lies inside the zone
for a feed:

- If `ai_binary_is_sunset` → upload, insert the archive row with
  `intake_reason = 'kiosk_bin'`, enter the **sunset bin**.
- Else if `ai_binary_score ≥ 0.20` → same, enter the **non-sunset bin**.
- Else → discard as today.

The cron floors are **fixed and generous**. The studio dials only narrow from
there, so the cron never chases a dial and a dial change is visible within
one poll instead of one cron tick. A frame already persisted for another
reason (disagreement, high rated, trickle) is entered without a second
upload. The `intake_reason` CHECK constraint gains `'kiosk_bin'`.

If a camera already has an entry in the same bin, the new frame is entered
with `is_new = true` and the old frame stays. The queue marks same-camera
entries `CAM 1/2`; deduplication policy is deliberately deferred until the
operator has watched it.

Removal, per cron tick, per entry:

- Compute the camera's solar altitude now (SunCalc, as
  `scripts/altitude-quality-report.mjs` does). Inside the feed's zone →
  `out_of_zone_polls = 0`, `last_seen_at = now`. Outside → increment. When
  it exceeds **zone grace** (0–5 polls, default 2, read from the live
  profile) → `removed_at = now, removed_reason = 'left_zone'`.
- A poll that simply did not return the camera changes nothing. Absence is
  not a reason.
- Entries older than 24 hours are removed with reason `expired`, for polar
  cameras that never leave the zone.

### 5.4 Scores

Quality is the calibrated tile signal the mosaic uses:
`ai_regression_score × calibration_multiplier`, computed at admission and
stored, with both raw inputs available on the archive row. Detection is the
raw binary probability, never calibrated (the calibration spec forbids it).
Both are displayed on every row and on glass when the overlay is on, labelled
`q` and `d` as the mosaic overlay chips are. One difference, stated so it is
not read as a bug: this mode shows detection as the raw probability (0–1),
where the mosaic chips show the 1–5 rating form of the same head.

---

## 6. Delivery

### 6.1 Endpoints

- `GET /api/kiosk/solo/state?feed=` — current frame, `shown_since`, the
  next 8 projected by the live profile's dials, both bins with eligibility,
  and the last cron's admission counts. Owner-gated when
  `?profile=studio`, which projects with the studio profile instead.
- `POST /api/kiosk/solo/advance` `{ feed, slot }` — runs `next()` with the
  live dials, bumps the tally, writes screen state, returns the new current
  frame and the next 8. Idempotent on `slot`: a second call for the same slot
  returns the same frame without advancing. Called by the kiosk only.
- Live dials for the `solo` namespace ride the existing
  `/api/kiosk/state` response like every other version's.

### 6.2 The schedule: two screens, no coordination

The two screens are two Chromium tabs that cannot see each other. They stay
staggered by reading the same clock. With dwell `D` and offset `O`, the
sunrise screen changes at every `t` where `t mod D = 0` and the sunset
screen at `t mod D = O`, on Unix time. Each tab computes its next boundary
locally, preloads the projected next image ahead of it, and calls `advance`
with the boundary's slot index at that moment. A reload waits for the next
boundary and is back in rhythm. Nothing needs to know what the other tab is
doing, and there is no server-side timer.

Dials (glass group): **dwell** 5–60 s default 20, **offset** 0–30 s default
10, **fade** 0–10 s default 0. Fade is a CSS opacity crossfade over the
preloaded next image; 0 is a hard cut, which is what phase 1 ships.

### 6.3 The kiosk renderer

Registered as version **`solo`** in `MOSAIC_VERSIONS`, so the existing
`activeVersion` dial flips the glass to it and back. It ignores the
`webcams` prop and reads `/api/kiosk/solo/state` on mount and after each
advance. It respects doze, `?panel=`, and `allowDebugOverlays` like every
other version.

On-glass overlays, each a boolean dial in the glass group, off by default
except place: **place + country** (camera title, region, country),
**scores** (`q`, `d`), **bin rank**, **shown tally**.

Landscape panel presets `dell-l` 1920×1080 and `ktc-l` 2560×1440 join
`PANEL_PRESETS`. The physical rotation is a Pi display setting (§8).

### 6.4 The studio: `/studio/solo`

Owner-gated route beside `/studio`. Reuses `useStudioSettings`,
`DeployButton`, the studio/live profiles, and the `shared` namespace. Layout
as drawn in the mockup:

- **Status strip** across the top: countdown to the next cron pull, what the
  last pull added per bin, glass revision and dial diff count, the zone in
  degrees.
- **Rail** on the left in two colour-coded groups. **Glass** (amber): dwell,
  offset, fade, the four overlay toggles, panel. **Bins** (teal): quality
  floor, detection floor, sunset floor, mix, rest, zone grace,
  promote new. Under them, the **rules box** that restates §4 with the
  current values. Every dial, header, tag and row has a tooltip.
- **Two feed columns**, sunrise then sunset. Each: the panel at true aspect
  with the overlays as dialled and a draining countdown bar; below it three
  columns, **sunset bin** (green outline), **non-sunset bin** (grey outline),
  **queue** (dark grey outline). Queue rows keep the outline colour of the
  bin they came from. The head of the queue carries an amber ring. Bin
  headers read `N waiting · M queued`.
- Each row: thumbnail, `shown ×N` first and bold when nonzero, then scores,
  camera, place and country, and tags NEW / FLOOR / LEFT ZONE / CAM 1/2.
- Clicking a thumbnail or the panel opens the frame in `RatingCard` (PR
  #126), so a rating writes a gold label against that exact archive row.

The studio projects with the **studio** profile's dials, so moving a teal
dial re-runs the queue on screen before Deploy. The glass keeps running the
live profile until Deploy, exactly as the mosaic studio works.

---

## 7. Cost

The ONNX scoring cost is unchanged: every changed picture is scored today.
What changes:

| axis | today | with this |
|---|---|---|
| cron ticks/day | 96 | 144 |
| Windy cluster calls | ~2,980/day | ~4,470/day |
| archive inserts | disagreement-dominated, ~4,600/day | + frames admitted to bins, estimate 1,000–3,000/day |
| Firebase uploads | one per persisted frame | same rule, more frames |
| glass bandwidth | 40–80 tiles/min from Windy CDN | 3 images/min from our storage |

The archive estimate is not measured. Phase 1 reports the real admission
count in the daily digest's sweep line and the studio's status strip so the
operator can read it directly. The operator has accepted the cost for the
duration of the show; the cron cadence and the admission rule are the two
switches to turn it back down.

---

## 8. Phases

Each phase is one PR from a branch stacked on the previous, each landed the
same day it passes.

1. **Server.** Migration (`kiosk_bin_entries`, `kiosk_screen_state`, the
   intake constraint), `solo` settings schema, the pure rule engine with the
   mockup sequences as fixtures, cron admission and removal, the two
   endpoints, cron to `*/10`. Migration applied by the operator before merge.
2. **Glass.** The `solo` version: state fetch, schedule, preload, cut, the
   overlays, landscape presets.
3. **Studio.** `/studio/solo` as specified in §6.4.
4. **Pi.** Rotate both panels to landscape in the Pi's display config, add
   the step to `docs/ops/pushing-an-update-to-the-glass.md`, set the panel
   preset, flip `activeVersion` to `solo` from `/studio`, verify on glass
   with `kiosk-doctor.sh --sync --reload`.
5. **Later, after the show opens.** Scenes for this mode (a scene pointer
   resolved from the archive with tallies zeroed), transitions beyond fade,
   same-camera deduplication policy, cron cadence back to `*/15`.

Phases 1–4 are wanted before the freeze on 2026-09-10.

---

## 9. Testing

- Rule engine: the rest sequences in §4; floor 0 never
  draws a non-sunset while a sunset exists; empty sunset bin draws
  non-sunsets; rule 4 with a single eligible frame; promotion flag clears on
  first showing; tier ties broken by tally then `entered_at`.
- Admission: a frame the detection head calls a sunset enters the sunset bin
  regardless of quality; a frame below 0.20 detection is not persisted for
  the bin; a frame already persisted for disagreement is entered without a
  second upload; a second frame from a camera already in the bin is `is_new`.
- Removal: absence from a poll does not touch the entry; out-of-zone
  increments and removes at grace + 1; the 24-hour expiry; a removed entry
  is never returned by `next()`.
- Schedule: slot index is a pure function of `(now, dwell, offset, feed)`;
  a second `advance` with the same slot is a no-op; a reload lands on the
  next boundary.
- Studio: projection uses the studio profile, status strip uses the live
  profile; queued frames are absent from bin columns; header counts add up.

---

## 10. Out of scope

- Any change to the mosaic versions or their studio.
- Moving the base ring or the search radius (pool-coverage spec §9).
- Faster-than-Windy image freshness; not purchasable (refresh-cost spec).
- Camera-level reputation.
- Custom Pi cameras as a bin source. They already archive every frame and
  will enter the bins by the same rule with no special handling, but nothing
  here depends on them.
