# One studio — design

**Date:** 2026-09-05
**Status:** proposed, awaiting Jesse's review. Nothing built.
**Branch:** `docs/one-studio` (this document only).
**Builds on:** `2026-08-30-kiosk-studio-control-and-mosaic-v2-design.md`
(studio/live profiles, Deploy), `2026-09-04-solo-kiosk-design.md` §6.4 (the
solo studio), `2026-09-04-solo2-rhythm-design.md` §5.4 (solo2 reuses the solo
studio by descriptor), `2026-09-05-studio-deploy-history-and-solo-preview-design.md`
(deploy history, Part A shipped; Part B, the solo preview on studio dials,
specified and unbuilt).
**Mockup:** https://claude.ai/code/artifact/6e9a0eb6-be08-4c6d-ac32-61f2d9cf1a3c shows
the page with solo2 selected and with v4 selected; the bins panel is drawn
from `FeedColumn` as PR #143 leaves it.

## 1. What this is

Three studio URLs collapse into one page. The version selector at the top
of that page decides everything below it: which dials the rail shows, which
renderer the preview runs, and which side panel appears. Deploy, deploy
history and the status line exist once. A dial setup can be **saved as a
take** without being deployed, and loaded back later like any deploy.

What the glass produces does not change. solo2's engine, dials and defaults
are untouched; the page around them is what changes.

### 1.1 Why now

Today there are two studio implementations behind three routes:

| Route | Component | Has | Lacks |
|---|---|---|---|
| `/studio` | `StudioClient` + leva `StudioRail` | version selector, scene save/replay, deploy + history, gate/pool status strip | any bins or queue view; selecting `solo` here gives solo's dials with a preview that ignores them |
| `/studio/solo` | `SoloStudioClient` (descriptor `solo`) | colour-coded hand-rolled rail with Queue/Picture tabs, bins + projected queue, glass preview, deploy + history | version selector, panel preset, scenes; the mosaic strip's poll age and dropped keys |
| `/studio/solo2` | the same `SoloStudioClient` (descriptor `solo2`) | as above | as above, **and the preview draws `SoloFrame`, not `Solo2Frame`**, so prelude, lead, transitions and local time never show in the studio |

The consequences Jesse hit on 2026-09-05: dials moved in one studio did
nothing on the glass because the version was set in another; the solo2
studio cannot show what solo2 does; every session added a readout to the
solo rail until the dials he turns were buried (`feedback_studio_ui_clutter`);
loading a deploy from `/studio/solo2` silently rewrote mosaic dials, which is
correct but reads as a surprise when the page only shows solo2.

### 1.2 Vocabulary, restated

- A **version** is a renderer with its own dial namespace: `v1 … v4`, `solo`,
  `solo2`. The registry is `MOSAIC_VERSIONS`.
- A **take** is the whole studio profile at one moment, every namespace
  including `shared.activeVersion`. A take that Deploy sent to the glass is
  a **deploy**; a take saved without sending is a **saved take**. Both are
  rows in `kiosk_deploys`, one list, numbered in one sequence.
- A **scene** is a frozen webcam pool (`kiosk_scenes`), the mosaic studio's
  replay input. It is not a dial setup. Scenes stay mosaic-only in this
  design (§7).
- The **studio profile** is what the rail edits and the preview shows; the
  **live profile** is what the glass reads. Unchanged.

## 2. The page

One route, `/studio`. `OwnerGate` as today. The old routes redirect there
(§6).

```
┌───────────────────────────────────────────────────────────────────────────┐
│ STUDIO  version [solo2 ▾]  panel [dell-l ▾]   glass solo · rev 41 · 3 differ │
│                          · next pull 4:12  [save take] [▲ deploy 3] │ Globe Studio My Cameras │
├────────────────┬──────────────────────────────────────────────────────────┤
│ RAIL           │  PREVIEW  (sunrise screen | sunset screen)               │
│ [Play][Picture]│  studio dials, the version's own frame, playing          │
│                │──────────────────────────────────────────────────────────│
│ Glass          │  VERSION PANEL                                           │
│  camera change │   solo, solo2:  bins + projected queue per screen        │
│  same-cam fade │   v1 … v4:      pool + gate readout per screen           │
│  lead (s)      │                                                          │
│  …             │                                                          │
│ Bins           │                                                          │
│  valleys/peak  │                                                          │
│  …             │                                                          │
│ Takes          │                                                          │
│  #41 deployed  │                                                          │
│  #40 saved     │                                                          │
└────────────────┴──────────────────────────────────────────────────────────┘
```

### 2.1 Header

Left: the page name, the **version** select and the **panel** select. Both
are the `shared` namespace dials (`activeVersion`, `panelPreset`) moved out
of the rail into the header, because they decide what the rest of the page
is. The version select's label is bold when studio and glass disagree, the
same "differs from glass" affordance the rail uses.

Right, in this order: the status line, **save take**, **deploy**, then a
divider and the **nav toggle** (`MapMosaicModeToggle`: Globe · Studio · My
Cameras) in the far-right corner, where it is on the homepage band. The
toggle is the only way off the page, so it stays.

The header is one flex row. The three controls on the right are `flex: none`
and the status line is the only member that can shrink (`min-width: 0`,
ellipsis on its tail), so the toggle and Deploy never overlap or wrap. A
divider between Deploy and the toggle keeps a hold-to-fire press from
landing on a navigation button. A test asserts the header renders all
three controls at 1024 px wide without overflow.

- Status line, in this order, nothing else:
  `glass <version> · rev <n> · <k> differ | dials match glass · next pull <m:ss> · polled <age>`.
  Dropped keys, when any, append as `· 2 dropped` with the existing hover
  explanation. The cron countdown and poll age both come from what already
  exists (`SoloStatusStrip`'s `nextCronMs`, `StatusStrip`'s poll age).
- **save take** — records the studio profile as a saved take (§4).
- **deploy** — the existing hold-to-fire `DeployButton` with its diff badge
  and its "discard changes" secondary.

### 2.2 Version selector drives three things

Selecting a version sets `shared.activeVersion` in the studio profile, as
the mosaic rail does today. It is a dial: it deploys with everything else,
and loading a take restores it. The page reads it back and derives:

| version | rail schema | preview renderer | version panel |
|---|---|---|---|
| `v1 … v4` | `MOSAIC_SETTINGS_SCHEMAS[v]` | `resolveMosaic(v)` inside `StudioPanelFrame` (today's `PreviewPane` body) | pool + gate pass counts per screen (today's strip numbers, moved down) and the scene selector (§7) |
| `solo`, `solo2` | `SOLO_VERSIONS[v].schema` + shared caption | the version's **own** frame (`SoloFrame` / `Solo2Frame`) playing the projected queue on studio dials (§5) | bins + projected queue per screen (today's `FeedColumn`) |

The mapping lives in one place, a `STUDIO_SURFACES` table keyed by version
name beside the renderer registry, so adding `solo3` is one row.

### 2.3 Rail: one renderer

The leva rail goes. `SoloRail`'s `Control` (range / checkbox / select,
label bold when it differs from glass, hover title = knob description)
renders every version's schema. It already reads `KnobDescriptor`, which is
the same type the leva config was built from.

Sections come from the schema's `section` field, as today:

- **Play** page: the version's own sections, in schema order. For solo
  versions that is Glass and Bins; for v4 it is signal, visibility, sizing,
  arrangement, overlays, motion. Each section has the coloured header and
  the `reset <section>` button. Mosaic sections are collapsible, closed by
  default except the first, because v4 has ~35 dials.
- **Picture** page: the shared caption section (`CAPTION_SCHEMA`). Shown for
  solo versions only, since nothing else draws the caption. The picture
  readout under `pictureHeight` stays.

Under the dials, on both pages: the **Takes** list (§4).

The rail is 250 px, scrolls, not resizable. The resizable/collapsible rail
from the mosaic studio is dropped: it is 90 lines for a width nobody has
needed to change since the preview started scaling to fit.

### 2.4 What is removed

The consolidation is the simplification pass Jesse asked for on 2026-09-05.
Each of these is deleted, not moved:

| today | why it goes |
|---|---|
| `glass solo · panel dell-l · dials solo2` line in the solo rail | the header shows version and panel; there is no separate "dials" version any more |
| the `← mosaic studio` / `solo2 studio →` cross-links | one page |
| `RulesBox` (the ordering rules paragraph) | the bins panel shows the ordering; the rules are in the spec and the dial descriptions |
| `DwellBudget` (solo2's dwell arithmetic box) | folds into a one-line readout under `valleys per peak`, the way the picture readout sits under `pictureHeight` |
| the hint paragraphs under the rail groups and tabs | hover titles on the section headers keep the text; it stops taking space |
| `FeedColumn`'s "on glass" mini caption | the preview above it is the glass; the column shows only the queue |
| mosaic `StatusStrip` (159 lines + `stripState.ts`) and `SoloStatusStrip` | replaced by the header status line, §2.1 |
| `PreviewPane`'s scene chrome (413 lines) | the scene selector shrinks to one select in the mosaic version panel (§7); the frame itself is `StudioPanelFrame` |

### 2.5 What is preserved, verbatim

Jesse's worry on 2026-09-05 after seeing the first mockup: "a lot of the
stuff, particularly the bins, looks a lot different … I just don't want to
lose all we've accomplished." The first mockup sketched the bins; it has
since been redrawn from the real `FeedColumn`. The design moves these; it
does not redraw them:

| kept | where it lives |
|---|---|
| the three-bin column per screen: Sunset bin, Non-sunset bin, On glass + next up, each with its 2 px bin colour | `FeedColumn` |
| the **next frame in N s** countdown in each screen's title, on the live dials' clock | `FeedColumn` (still on `main` and in #143; if it is missing on the deployed solo2 page that is a bug to chase separately, not a design change) |
| stages inside each bin: IN LINE / RESTING / UNDER FLOOR with the label up the left edge, empty stages as one flat line | #143's `StageBox` |
| "projected with studio dials; glass will draw X" when the projection and the glass disagree | `FeedColumn` |
| `EntryRow`: 46 px thumbnail, `shown ×N` bold when shown, score line, title, place · local time, hover reason | `EntryRow` |
| the tags: NEW, FLOOR, REPEAT, CAM n/m, PRELUDE, PEAK, VALLEY | `EntryRow` |
| solo2 dwell groups: earlier frames stacked above the chosen one with their local times, the row as tall as its time on glass (`PX_PER_S`) | `EntryRow` |
| the orange ring on the on-glass row | `EntryRow` |
| click a row → `FrameLabelCard` modal with rating | `SoloStudioClient` today, `StudioClient` tomorrow |
| the two screens composed at true panel pixels through `StudioPanelFrame`, with the `on glass now · frame N · W × H` line | `GlassPreview` |
| the picture readout under `pictureHeight`; the Picture page with the caption dials | `SoloRail` → `Rail` |
| colour-coded sections with `reset <section>`; bold label when a dial differs from glass | `SoloRail` → `Rail` |
| deploy history rows with rename, `live` / `in studio` badges | `DeployHistory` |
| scenes: selector, save, restore dials from provenance (mosaic versions) | `PreviewPane` → `MosaicPanel` |

Kept as-is in code: `DeployButton`, `DeployHistory` (extended, §4),
`useStudioSettings`, `StudioPanelFrame`, `FeedColumn`, `EntryRow`,
`FrameLabelCard` modal, `SaveSceneButton`, `restoreSceneDials`.

## 3. Data flow

Unchanged. The rail writes the studio profile through `useStudioSettings`
(debounced `PATCH /api/kiosk/settings` per namespace). The preview and the
version panel read `api.effective(ns)`. Deploy is `copyProfile('studio',
'live')` then `recordDeploy`. The only new write is `saveTake` (§4).

The solo version panel keeps re-projecting the queue in the browser with
studio dials (`useSoloState` → `/api/kiosk/solo/state?feed=&version=`),
passing the selected version's descriptor. Today the descriptor is fixed by
the route; tomorrow it comes from the version select.

## 4. Takes: save without deploying

### 4.1 Table change

```sql
ALTER TABLE kiosk_deploys
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
UPDATE kiosk_deploys SET created_at = deployed_at WHERE created_at > deployed_at;
ALTER TABLE kiosk_deploys ALTER COLUMN deployed_at DROP NOT NULL;
```

A row with `deployed_at IS NULL` is a saved take. Forward-only, idempotent
(the `UPDATE` is a no-op on rerun). Applied by Jesse with
`node scripts/apply-migration.mjs database/migrations/<date>_kiosk_takes.sql --apply`
(the file is dated the day phase B starts)
**before** the PR that reads `deployed_at` as nullable merges (ledger rule;
`npm run migrate:status` must be clean).

### 4.2 Store and API

| function | route | does |
|---|---|---|
| `saveTake(studio: ProfileSettings, label?)` | `POST /api/kiosk/deploys` | inserts one row from the studio profile with `deployed_at = NULL`; returns the row |
| `recordDeploy` | (unchanged, called by deploy) | inserts with `deployed_at = now()` |
| `listDeploys` | `GET /api/kiosk/deploys` | newest by `created_at` first; `DeployRow` gains `deployedAt: string \| null` and `createdAt` |
| `loadDeployIntoStudio` | `POST /api/kiosk/deploys/:id/load` | unchanged: works on any row |
| `relabelDeploy` | `PATCH /api/kiosk/deploys/:id` | unchanged |

Deploying a loaded saved take records a **new** deployed row, as every
Deploy does. The saved row stays saved. The log stays a log: every deployed
row is something that was on the glass. `deploySummary`'s "this is what is
on glass" match still compares against live, so the new deployed row shows
the `live` badge and the saved row does not.

### 4.3 Rail list

`DeployHistory` becomes the **Takes** list. Each row: `#id`, label (click to
rename, as today), a badge, the time, the key count on hover. Badges:

- `live` — the deployed row whose namespaces equal the live profile (today's
  logic)
- `deployed` — any other row with `deployed_at`
- `saved` — `deployed_at IS NULL`
- `in studio` — the row whose namespaces equal the current studio profile
  (today's logic)

The **save take** button in the header opens an inline label field in the
Takes list, defaulting to empty; Enter saves, Escape cancels. Saving when
the studio profile equals the newest row's namespaces still saves (a label
is a reason to save), but the row shows `same as #n` for a few seconds so
the duplicate is visible.

## 5. Preview truth

This is Part B of the deploy-history spec, moved into this design because
one page with one preview makes its absence obvious.

- The preview renders the **selected version's** frame: `Solo2Frame` for
  solo2, `SoloFrame` for solo, `resolveMosaic(v)` for the mosaic versions.
  `Solo2Frame` today is reachable only from `Solo2Kiosk`; it takes the same
  props shape and needs no change.
- For solo versions the preview **plays**: a `useSoloPreview(feed, order,
  dials)` hook advances a local clock through the projected queue on the
  studio dials, with the version's `roleAt` for lead/prelude/transition
  phases. No server advance is called. The glass keeps its own clock; the
  status line's poll age is the only live truth on the page.
- The mosaic preview is unchanged: `resolveMosaic(v)` on the live or scene
  pool with studio dials, which already previews the studio profile.

The deploy-history spec §3.1–3.2 remains the detailed reference for the
hook; it is not restated here.

## 6. Routes

- `/studio` — the page.
- `/studio/solo`, `/studio/solo2` — `redirect('/studio')` in each `page.tsx`.
  They do not set the version, because setting a studio dial from a URL
  would be a write on navigation. Bookmarks land on the one page; the
  version select is at the top.
- No new routes. `/api/kiosk/deploys` gains `POST` (§4.2).

## 7. Scenes stay mosaic-only

The scene selector (`live | scene ▾`), `SaveSceneButton` and dial restore
from provenance move into the **mosaic version panel** and appear only when
a mosaic version is selected. Solo draws from server-owned bins, not from a
props pool; replaying a frozen pool through solo2 means teaching the bin
builder to take a scene's webcams. That is a separate design, listed in
§11, and nothing here blocks it.

## 8. Files

New:

- `app/studio/surfaces.ts` — `STUDIO_SURFACES`: version name → { rail
  schema, Preview component, VersionPanel component, hasPicturePage }.
- `app/studio/Header.tsx` — version + panel selects, status line, save take,
  deploy.
- `app/studio/Rail.tsx` — the one rail (from `SoloRail`, generalised;
  collapsible sections).
- `app/studio/panels/MosaicPanel.tsx` — pool/gate readout + scene selector.
- `app/studio/panels/SoloPanel.tsx` — the two `FeedColumn`s.
- `app/studio/useSoloPreview.ts` — §5.
- `database/migrations/2026MMDD_kiosk_takes.sql` — §4.1.

Changed: `StudioClient.tsx` (becomes the grid + the surface lookup),
`DeployHistory.tsx` (badges, inline save), `app/lib/settings/deploys.ts`
and `app/api/kiosk/deploys/route.ts` (`saveTake`, `POST`),
`useStudioSettings.ts` (`saveTake`), `GlassPreview.tsx` (version's frame +
play loop), `app/studio/solo/page.tsx` and `solo2/page.tsx` (redirects).

Deleted: `StudioRail.tsx`, `levaConfig.ts`, `StatusStrip.tsx`,
`stripState.ts`, `SoloStatusStrip.tsx`, `RulesBox.tsx`, `DwellBudget.tsx`,
`railWidth.ts`, most of `PreviewPane.tsx`, `SoloStudioClient.tsx`, the
`leva` dependency once nothing imports it.

## 9. Phases

Three PRs, three worktrees, in order. Each leaves the glass exactly as it
was.

| phase | delivers | size |
|---|---|---|
| **A · collapse** | one route, header, one rail, version-driven preview and panel, the §2.4 deletions, redirects. Takes list unchanged (deploys only). Preview is today's static `GlassPreview` but draws the selected version's frame. | the big one; a day |
| **B · takes** | migration, `saveTake`, `POST`, badges, inline save | an afternoon |
| **C · preview plays** | `useSoloPreview`, solo2 phases in the preview | an afternoon; before the 09-10 freeze |

A ships first because it is the usability fix. B is independent of A in
code but pointless before it. C depends on A's surface table.

## 10. Reconcile before building

This spec is written against `main` at `02d25604b` (2026-09-05, PR #142
merged). Before starting phase A, diff the studio files against whatever
`main` is then, and read the open branches that touch them:

- `feat/solo-stages-tape` (PR #143 open): `FeedColumn`, `EntryRow`, bins
  sectioned in line / resting / under floor. Phase A keeps `FeedColumn` and
  must take #143's version of it, so **merge #143 first** or build A on top
  of it. #143 also rewrites `RulesBox`; this design deletes it, so the
  rule wording ("never shown first, then longest since shown", "rests at
  least N draws") must live in the bins dial descriptions instead. The
  follow-up tape filmstrip (solo-stages-and-tape spec §4, not started) will
  sit under each screen in the solo version panel and is not in this design.
- `feat/solo2-prelude-groups`: check whether anything is still unmerged.
- `feat/solo2-camera-run` (peer session 51; approved and **building** as of
  2026-09-05 evening; spec
  `docs/superpowers/specs/2026-09-05-solo2-camera-run-design.md`). What it
  changes that this design must take as given once it merges:
  - solo2 dials: `prelude`, `preludeFrames`, `preludeStepS` removed, one
    `cameraRun` boolean added; `transition`, `fadeS`, `sameCameraFadeS` keep
    their keys with new labels. The rail reads the schema, so nothing here
    changes.
  - shared caption: `pictureTop` and `captionAnchor` removed, `feedPrefix`
    added. Same: schema-driven.
  - `FeedColumn` / `EntryRow`: one box per camera, strips labelled i/k, the
    CAM and PRELUDE tags gone. §2.5's "kept verbatim" means *that* column,
    not the one on `main` today.
  - `GlassPreview` **plays** for solo2: `Solo2Frame` on a looping local
    clock, no advance posted. That is phase C scoped to solo2. Phase C lifts
    it into `useSoloPreview` for both solo versions rather than writing a
    second loop.
  - `SoloStudioClient`'s frame modal gains prev/next through its column;
    phase A deletes `SoloStudioClient`, so the modal with prev/next moves
    into `StudioClient` intact.
  - `SoloVersionSpec` gains `shown()`; `commitAdvance` takes a list of ids.
  Its dwell readout becomes `N frames × step`; the one-line readout under
  `valleys per peak` (§2.4) is the slot for it.
- A peer session (`a5` in the memory notes) owned `SoloStudioClient`,
  `SoloRail` and `CaptionPreview` on 2026-09-05. Message it before phase A
  deletes `SoloStudioClient`.

Then update §8's file list to match and start.

## 11. Out of scope

- Scenes for solo bins (§7).
- A per-version take (the profile-wide snapshot is the decision from the
  deploy-history spec and it stands).
- Kiosk self-reload on new build; the Pi reload runbook is unchanged.
- Removing versions v1–v3 from the selector.
- Any change to solo2's engine, dials, defaults or namespace **by this
  design**. The camera-run branch (§10) changes them on its own; this page
  takes whatever schema is on `main` when phase A starts.

## 12. Testing

- `surfaces.test.ts`: every key in `MOSAIC_VERSIONS` has a surface row;
  every surface row's schema equals `schemaFor(version)`.
- Rail: renders every knob of a mosaic schema and of the solo2 schema +
  caption through the one `Control`; a knob that differs from live renders
  bold; `reset <section>` clears only that section.
- Header: the version select writes `shared.activeVersion`; the status line
  reads the live profile, not the studio one (the regression the mosaic
  strip once had).
- Takes: `saveTake` inserts with null `deployed_at`; `listDeploys` orders by
  `created_at`; load works on a saved row; the deployed row after deploying
  a loaded saved take is a new row and the saved row is untouched; badges
  for all four states.
- Preview: the solo2 surface mounts `Solo2Frame`; `useSoloPreview` advances
  through the projected order on a fake clock and never calls the advance
  route.
- Redirects: `/studio/solo` and `/studio/solo2` respond 307 to `/studio`.
- Existing suites keep passing; `leva` removal is checked by `npm run build`.
