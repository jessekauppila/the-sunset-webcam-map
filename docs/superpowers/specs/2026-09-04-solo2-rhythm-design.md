# solo2 — rhythm, anticipation, prelude, and local time for the solo kiosk

**Date:** 2026-09-04
**Status:** Design agreed in conversation (2026-09-04 evening); built overnight
as one PR for the operator to look at on 2026-09-05.
**Predecessor:** `2026-09-04-solo-kiosk-design.md` (the `solo` version: bins,
the five rules, the schedule, the glass, `/studio/solo`). Everything there
still holds; this document only states what `solo2` adds.
**Show:** opening night Fri 2026-09-12, freeze Wed 2026-09-10.

---

## 1. What this is

A second registered version, **`solo2`**, beside `solo`. It reads the same
server-owned bins and the same screen state, and the shared `activeVersion`
dial switches the glass between the two. `solo` is not edited: its engine,
renderer, and namespace stay as shipped, so refining the original remains
possible on its own branch.

`solo2` takes four ideas from feed design and keeps only the ones that hold
without a viewer identity:

1. **Rhythm.** Best-first within a tier is a monotone decline. `solo2`
   alternates **peaks** (best remaining) with **valleys** (lowest eligible),
   so a one-minute viewer sees a high and a low instead of three near-equal
   tops. The beat is derived from the schedule slot, so the two screens can
   peak **together** or **alternate** without talking to each other.
2. **Anticipation.** A frame is perfectly still while it is "now". In the
   last seconds of its dwell it starts a slow push (scale 1.00 → 1.03), and
   the next frame lands still again. Stillness means now; motion means
   change is coming.
3. **Prelude.** Optionally, the chosen frame is preceded by its own camera's
   earlier archived frames in capture order, held briefly each, arriving at
   the chosen frame which then holds. The sun visibly drops into the picture
   the engine picked. A glass dial: it changes how a frame is shown, never
   which frame.
4. **Local time.** The caption's second line gains the time it was at that
   place when the picture was taken, in that place's clock: `Baja
   California Sur, Mexico · 7:42 pm`. Several phrasings are dials so the
   operator can pick one on the studio.

Every new dial defaults to `solo`'s behaviour (rhythm off, lead 0, prelude
off, cut transition), with one exception: the time caption defaults to
`7:42 pm`, because that is the point. The branch is therefore reversible on
the glass by dials as well as by git.

Not in scope, decided 2026-09-04: call-and-response between screens (most
coupling, first thing to break on a tab reload), same-camera deduplication
(still parked from the predecessor), scenes for this mode.

### Fixed directives, restated

- One frame fills the screen. Never a grid.
- The score shown for a frame is the score of **that exact picture**. Prelude
  frames carry no caption and no score; overlays mount with the chosen frame.
- **The best sunsets lead each bar.** Peaks are drawn best-first exactly as
  `solo` draws everything; valleys are the rhythm between them. With valleys
  at 0 the rule is `solo`'s rule 3 verbatim.
- Nothing ever silently drops out of the bins.

---

## 2. Vocabulary (extends the predecessor's §2)

- **Beat** — the position of a draw inside a bar, derived from the schedule
  slot. Beat 0 is the peak; beats 1…N are valleys.
- **Bar** — `valleys + 1` consecutive draws on one screen: one peak, then
  the valleys.
- **Peak** — the draw that takes the head of the pool (best remaining).
- **Valley** — a draw that takes the tail of the pool: the lowest eligible
  score, preferring unshown frames.
- **Prelude** — the same camera's earlier archived frames shown before the
  chosen frame, in capture order.
- **Lead** — the final seconds of a dwell during which the frame on glass
  pushes in, announcing the change.
- **Hold** — the part of a dwell during which the chosen frame sits still
  with its caption: `dwell − prelude − lead`.

---

## 3. The ordering rules in `solo2`

Rules 1, 2, 4 and 5 are the predecessor's, unchanged. Rule 3 becomes:

3. **Within a bin, peaks best-first, valleys worst-first, on a beat.**
   `period = valleys + 1`. For a draw at schedule slot `s` on feed `f`,
   `beat = (s − phase(f)) mod period`, with `phase(sunrise) = 0` and
   `phase(sunset) = 0` when **screens** is `together`, `⌊period / 2⌋` when
   it is `alternate`.
   - Beat 0 (**peak**): the pool sorted as `solo` sorts it — tally
     ascending, score descending (promote-new bonus included), then
     `entered_at`, then id — and the head is drawn.
   - Beat ≥ 1 (**valley**): the pool sorted tally ascending, score
     **ascending**, then `entered_at`, then id — and the head is drawn. Tally
     stays first so a valley still prefers a picture nobody has seen.
   Dials: **valleys** (0–3, default 0), **screens** (`together` |
   `alternate`, default `together`). At valleys 0 every draw is a peak and
   the rule is `solo`'s.

The pool a beat draws from is still chosen by rules 1 and 2, so non-sunsets
keep arriving through **mix** exactly as before; they are simply the deepest
valleys. Rule 4 still forbids the frame on glass.

Worked case, 21 sunsets `S1…S21` by descending quality, one tier, valleys 1,
screens together: sunrise draws `S1, S21, S2, S20, S3, S19 …`. With screens
`alternate` the sunset screen, whose slot at the same wall-clock moment is
the same index, draws `S21', S1', S20', S2' …` from its own bin, so at any
moment one screen is on a peak and the other on a valley.

The beat is a function of the slot, not of screen memory, so:

- a reload lands on the same beat the schedule says;
- the studio's projection knows the beat of every queued draw and can label
  it;
- the two screens need no channel between them, which is the predecessor's
  §6.2 philosophy kept.

The engine stays pure. `next2(entries, dials, state, slot)` and
`project2(entries, dials, state, n, firstSlot)`; the first projected draw is
at `slotFor(now) + 1`, the next boundary.

---

## 4. The glass in `solo2`

### 4.1 Timeline of one dwell

For a dwell `D` beginning at boundary `B`, with `k` prelude frames, step
`t`, and lead `L`:

| from | what |
|---|---|
| `B` | transition (per dial) into prelude frame 1 if `k > 0`, else into the chosen frame |
| `B + i·t` | hard cut to prelude frame `i + 1` |
| `B + k·t` | hard cut to the chosen frame; caption and score overlays mount now |
| `B + D − L` | the chosen frame begins a linear push from scale 1.00 to **lead scale** |
| `B + D` | the next dwell begins; the incoming frame is at scale 1.00 |

Prelude steps are hard cuts on purpose: a time-lapse reads as cuts.

The stage is computed from the wall clock, not from timers chained since
mount: `stageAt(elapsedMs, plan)` is a pure function, so a tab that reloads
mid-dwell joins at the right step, and the studio can draw the same timeline.

**Dwell budget.** `hold = D − k·t − L` must be at least **3 s**. If it is
not, the glass drops prelude frames from the oldest until it is; if there is
still no room, it shortens the lead. The studio prints the budget under the
glass dials and turns it red when clamped. The rule lives in one pure
function (`fitPlan`) used by both.

### 4.2 Transition

**transition** (`cut` | `crossfade` | `dip`, default `cut`), with **fade**
(0–10 s, default 0) as its duration:

- `cut` — what `solo` ships.
- `crossfade` — the previous frame underneath, the incoming fades in over
  `fade`. Reads as a double exposure for the whole duration; kept as an
  option.
- `dip` — the previous frame fades to black over `fade / 2`, then the
  incoming fades up from black over `fade / 2`. What photo slideshows use.

### 4.3 Lead

**lead** (0–10 s, default 0) and **lead scale** (1.00–1.10, default 1.03).
A CSS animation on the top layer, started by the clock-driven stage with a
negative `animation-delay` equal to the time already elapsed in the lead, so
a late-joining tab is in sync.

### 4.4 Prelude

**prelude** (boolean, default off), **prelude frames** (1–6, default 3),
**prelude step** (0.5–5 s, default 1.5).

The prelude of a frame is a pure function over the entries the state
endpoint already returns: `preludeFor(entry, entries, max)` = the other
entries with the same camera, captured earlier, sorted by capture time, the
last `max` of them. No new query. Frames below a floor are fine as prelude
(they are earlier pictures of the same scene); frames removed from the bins
are not returned by the endpoint and simply shorten the prelude. Frames the
cron never archived (detection below 0.20) were never pictures we hold.

The glass preloads the prelude of the projected next frame along with the
frame itself.

### 4.5 Caption and the time

**place + country** stays. A new **time** dial (enum, default `12h`) sets
the second line's trailing item:

| option | rendered |
|---|---|
| `off` | `Baja California Sur, Mexico` |
| `12h` | `Baja California Sur, Mexico · 7:42 pm` |
| `12h there` | `Baja California Sur, Mexico · 7:42 pm there` |
| `24h` | `Baja California Sur, Mexico · 19:42` |
| `sun` | `Baja California Sur, Mexico · sun 1.2° above the horizon` |
| `12h + sun` | `Baja California Sur, Mexico · 7:42 pm · sun 1.2° above the horizon` |

The time is the picture's `captured_at` rendered in the camera's IANA zone.
No camera has a zone stored, so it is resolved from `lat`/`lng` with
`tz-lookup` (pure, in-memory, ~150 KB) on the server when the view is
built. Solar altitude for the `sun` phrasing is `sunAltitudeDeg` from
`app/lib/solo/zone.ts`, also computed server-side. The client view gains
`capturedAt` (ms), `timezone` (IANA), and `sunAltitudeDeg`; it still carries
no coordinates. Rendering uses `Intl.DateTimeFormat` with `timeZone`.

The caption is rendered by one helper, `captionLines(entry, dials)`, used by
the glass and by the studio's panel preview, so the studio shows the glass's
words.

Gotcha, recorded so nobody debugs it twice: `webcam_snapshots.captured_at`
is `timestamp without time zone` holding UTC. The Neon driver parses a naive
timestamp as **client-local**, which is correct on Vercel (UTC) and seven
hours off on a Mac. The store selects `captured_at::text` and parses it as
UTC explicitly.

---

## 5. Delivery

### 5.1 Versions

`app/lib/solo/versions.ts` (client-safe) exports a descriptor per version:

```ts
interface SoloVersionSpec {
  name: 'solo' | 'solo2';
  namespace: string;
  schema: SettingsSchema;
  dialsFrom(values): SoloDials | Solo2Dials;
  engine: { isEligible, project(entries, dials, state, n, firstSlot), roleAt?(slot, feed, dials) };
  rules(dials): ReactNode[];   // the rules box lines
}
```

`solo`'s descriptor wraps the existing engine (ignoring the slot).
`solo2`'s lives in `app/lib/solo2/` (`settingsSchema.ts`, `engine.ts`,
`plan.ts` for `fitPlan`/`stageAt`, `prelude.ts`, `caption.ts`). `solo2`'s
engine imports `solo`'s pure helpers (`isEligible`, `tierOf`, `rankScore`)
rather than copying them; `solo`'s files are not modified.

### 5.2 Endpoints

Both endpoints gain a `version` parameter (`?version=` on GET state,
`version` in the POST advance body), default `solo`, unknown → 400. It
selects the namespace whose dials are read and the engine that runs.
`buildStateView` takes the descriptor. The screen state table is shared:
only one version is on glass at a time, and the slot is the same schedule.

Additions to the view: `EntryView.capturedAt`, `timezone`, `sunAltitudeDeg`;
`StateView.nextRoles: ('peak' | 'valley')[]` parallel to `next` (all
`peak` for `solo`).

No migration.

### 5.3 The renderer

`app/components/solo2/`: `index.tsx` registered as version `solo2` in
`MOSAIC_VERSIONS` and `MOSAIC_SETTINGS_SCHEMAS` (which also adds it to the
`activeVersion` options automatically), `Solo2Frame.tsx` (layers,
transition, lead, prelude, caption), and the clock-driven stage. The glass
loop `useSoloGlass` gains an optional `version` and returns `entries`; the
`solo` renderer's behaviour is unchanged.

### 5.4 The studio

`/studio/solo2`, owner-gated, is the same page as `/studio/solo` with the
`solo2` descriptor: `SoloStudioClient`, `SoloRail`, `FeedColumn`,
`RulesBox` take the descriptor instead of importing `solo`'s constants.
Additions:

- enum dials render as a `<select>`;
- under the glass group, the dwell budget line
  (`prelude 4.5 s + lead 4 s + hold 11.5 s`), red when clamped;
- queue rows carry a **PEAK** / **VALLEY** tag from `nextRoles`;
- the panel preview's caption uses `captionLines`, so it shows the time;
- the rules box states rule 3 with valleys and screens substituted;
- each studio links to the other.

### 5.5 Putting it on the glass

Code, then settings, as `docs/ops/pushing-an-update-to-the-glass.md` says:

1. Merge; wait for the production build.
2. `bash scripts/pi/kiosk-doctor.sh --sync --reload` so both tabs load a
   build that contains `solo2`.
3. On `/studio`, set **active version** to `solo2`, Deploy. The tabs pick it
   up within a minute. Back to `solo` is the same dial.
4. Tune on `/studio/solo2`; Deploy.

---

## 6. Testing

- Engine: valleys 0 reproduces every `solo` fixture; valleys 1 on 21
  sunsets gives `S1, S21, S2, S20 …`; valleys 2 gives one peak then two
  valleys; `alternate` puts the sunset screen's peak on the opposite beat;
  a valley prefers an unshown frame over a lower-scored shown one; rule 4
  holds on valleys; non-sunsets still arrive through mix.
- `fitPlan`: drops prelude frames oldest-first until hold ≥ 3 s, then
  shortens lead; `stageAt`: prelude index by elapsed time, main frame after
  `k·t`, lead progress in the last `L`, clamped at both ends.
- `preludeFor`: same camera only, earlier captures only, capture order,
  last `max`, empty when alone.
- `captionLines`: each time option's exact string; a `null` timezone falls
  back to `off`; the `sun` phrasing above and below the horizon.
- View: `nextRoles` parallel to `next`; `capturedAt` parsed as UTC from the
  text column.
- Endpoints: `version=solo2` reads the `solo2` namespace and runs the beat;
  unknown version → 400; default stays `solo`.
- Registry: `solo2` registered and present in the `activeVersion` options.
- Renderer: prelude frames carry no caption; caption mounts with the chosen
  frame; the transition kinds render their layers; a dial change re-plans.
- Studio: enum control writes a string; the budget line reads the plan;
  PEAK/VALLEY tags appear on queue rows.
