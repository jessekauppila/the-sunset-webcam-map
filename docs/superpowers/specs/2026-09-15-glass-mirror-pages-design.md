# Glass mirror pages: `/sunrise` and `/sunset`

Issue: #218. Two PRs: the mirror and the server-side advance (this spec,
parts 1 to 6) and the mosaic retirement (part 7), which is useful on its own
and reviewable on its own.

## 1. What this is

Two public pages that show what the glass is showing. `/sunset` is the right
screen, `/sunrise` the left. Each renders the solo2 screen for its feed with
the live profile's dials, scaled into the browser window, and changes frames
in the same second the glass does.

The shape is the broadcast one: **one canonical schedule on the server, and
every screen is a receiver.** The server already owns the screen row, the
draw engine, the beat grid, and each dwell's published end instant. What it
did not own was the trigger: the Pi's kiosk tab posted the advance at each
dwell's end, so when the Pi was dark or dozing the show stopped for
everyone. This spec moves the trigger to the server. The glass and the
mirror become the same kind of client, a follower, and the show runs
whenever anyone is watching.

The kiosk routes (`/kiosk/sunrise`, `/kiosk/sunset`) keep their URLs and
their query parameters, and the Pi keeps loading them. What changes on them
is that the solo2 page stops posting the advance.

### Vocabulary

- **Glass** — the two panels in the gallery, driven by the Pi's kiosk tabs.
- **Mirror** — a browser tab showing the same screen state.
- **Follower** — any client of the schedule: the glass, a mirror. A follower
  fetches the projection at each dwell boundary and never decides what
  comes next.
- **Projection** — the small public JSON one follower needs for one feed:
  the current dwell, resolved to drawable frames, and nothing the operator's
  studio view carries.
- **Advance on read** — the server draws the next frame when a request
  arrives past the current dwell's end. Idempotent on the slot, so any
  number of readers produce one draw.
- **Doze** — the glass going black in its quiet window. A rendering rule of
  the glass, not a pause of the schedule.

### Not in this

- A landing page that links the two.
- A one-line caption under the picture on narrow screens.
- The rendezvous (#200), which changes what the screens show, not how a
  follower shows it.
- Committing dwells ahead and publishing a timeline a client plays without
  polling each boundary (the full HLS shape). That is the right end point
  and it is what the rendezvous needs, but it gives draws future times and
  so changes the data model. It belongs with #200.
- A per-surface panel size. The canonical is one composition at the glass's
  panel size and every surface scales it.

## 2. What was found before designing this

Four things in the first draft did not survive the code.

**The follower mode that exists has never driven a live surface.** The only
caller of `driveSchedule={false}` is the studio's mosaic preview
(`app/studio/MosaicPreview.tsx`), which part 7 deletes. The studio's solo
preview (`app/studio/solo/GlassPreview.tsx`) does not use it: it renders
`Solo2Frame` on its own looping clock. In `useSoloGlass.ts`, a follower's
dwell timer re-arms at the boundary and does nothing else; the only fetch is
the 60 s state refresh. Under the beat (spec 2026-09-14) a still holds 12 s,
so a mirror built on this would miss most frames and show each one up to a
minute late.

**The state endpoint is the operator's view, not a public payload.**
Measured on production, 2026-09-15:

| `/api/kiosk/solo/state?feed=sunset&version=solo2` | |
| --- | --- |
| Response size | 1,004 KB |
| `entries` | 844 |
| Neon reads per call | 6 (bins, screen, admitted count, swept zone, day-ring flag, tape) |
| Live settings | Redis-first already (`getLiveSettingsCached`) |
| Cache header today | `public, max-age=0, must-revalidate`; `x-vercel-cache: MISS` |

An edge cache bounds the database. It does nothing for a phone pulling a
megabyte per 12 s dwell.

**The kiosk page's plumbing must not be reused wholesale.** `useKioskRuntime`
polls `/api/kiosk/state?kiosk=1`, and that marker is what the Ops panel reads
as "the glass is alive" (`app/api/kiosk/settings/route.ts` via
`getKioskLastPoll`). A hundred mirror visitors would report a healthy glass
while the Pi is dark. The kiosk page also loads the terminator webcam pool
(`useLoadTerminatorWebcams`) for the mosaics, which solo2 never reads.

**The trigger lived on the glass.** `useSoloGlass` posts
`/api/kiosk/solo/advance` at `endsAtMs`, and skips it while `dozing`
(`app/kiosk/kioskSchedule.ts`: local toggle, remote flag, or quiet hours).
So the schedule froze whenever the gallery closed, and a mirror would have
held one frame all night with its caption reading "9 hours ago". The
first draft called that honest. It was the glass's doze leaking into a
schedule that has nothing to do with the gallery's hours.

## 3. Routes and the page

```
app/sunrise/page.tsx           → <MirrorPage feed="sunrise" />
app/sunset/page.tsx            → <MirrorPage feed="sunset" />
app/mirror/MirrorPage.tsx      the one component
app/mirror/layout.tsx          black, full-window, solo fonts
app/components/solo2/useGlassFollower.ts   the follower, shared with the kiosk
```

`MirrorPage`:

- Calls `useGlassFollower(feed)` (part 4) and renders `Solo2Screen` (part
  5) inside `PanelFrame` (`app/kiosk/PanelFrame.tsx`) at the live
  `panelPreset`'s size, read from the projection. `PanelFrame` only engages
  when given a panel; the kiosk without a preset renders at window size.
  The mirror always passes the live preset, so a visitor sees the glass's
  composition, pillarboxed on a landscape desktop and nearly full-bleed on
  a portrait phone. The renderer was never tuned for other aspect ratios,
  and "mirror" means the same picture.
- Before the first projection arrives, and whenever it is null: black.
- Reads **no** query parameters. No `?v=`, no `?panel=`, no `?debug=`, no
  `?setup=`, no `?quiet=`. Overlays are off (`allowDebugOverlays={false}`);
  there is no doze overlay and no `dozing` input.
- Hardcodes `solo2`. The `activeVersion` dial is a kiosk concern. The live
  profile is `solo2` today, and part 7 makes it the default; until then, if
  the glass were switched to `solo`, the mirror would show the solo2
  rendering of the same screen row.
- The layout imports `soloFontClassName` from `app/kiosk/soloFonts.ts` (not
  moved) and sets a black, `overflow: hidden`, full-window box. It does
  **not** hide the cursor; that is the gallery's rule, not a visitor's.
- `metadata.title`: "Sunrise" and "Sunset".

The mirror never calls `/api/kiosk/state`, `/api/kiosk/tick`,
`/api/kiosk/solo/state`, or `/api/kiosk/solo/advance`, and never issues a
POST.

## 4. The projection, the advance, and the follower

### 4.1 `GET /api/mirror/state?feed=<sunrise|sunset>`

A new route, on its own path. Not a flag on the owner-gated state endpoint:
a separate path means the studio profile can never be served from the
cache, and the kiosk's uncached call cannot collide with a cached key. No
auth, no `profile`, no `version` parameter (solo2 is fixed until part 7).
Unknown feed: 400.

Reads: `getLiveSettingsCached()` (Redis-first), `listActiveEntries(feed)`,
`getScreenState(feed)`. Two Neon reads. It does not read the tape, the
admitted count, or the swept zone; the projection does not carry them.

**Advance on read.** After reading, if the screen has no row, or its
`endsAtMs` is at or before now, the route draws the next frame before
answering. The draw is the one `/api/kiosk/solo/advance` makes today,
extracted from that route into `app/lib/solo/advance.ts` as
`advanceIfDue(feed, version, live, nowMs)` and called from both places, so
there is one definition of a draw. Slot handling is unchanged: the next
slot is the stored one plus one, `commitAdvance` is a compare-and-set on
the row, and the loser of a race reads the winner's row and answers with
it. The POST route stays for solo v1 until part 7 removes it.

A public GET now has a side effect. It is idempotent by construction, and
the edge cache below bounds it to one origin call per second per feed per
region. That is the trade, stated: the show no longer depends on any one
screen being awake.

The beat grid still holds. `advanceIfDue` computes `endsAtMs =
nearestTick(nowMs) + dwellMs` as the beat spec says. A follower's fetch
lands within a beat of the end, so the draw belongs to that tick. If nobody
has read for a while, the first reader's draw snaps to the nearest tick at
that moment and the schedule resumes on the grid.

**Only the live path advances.** `/api/kiosk/solo/state` with
`?profile=studio` re-projects the queue with undeployed dials and must
never draw. It is unchanged. A studio tab can never put a frame on glass
that the glass's dials would not have chosen.

Response:

```ts
interface MirrorView {
  feed: Feed;
  version: 'solo2';
  /** The live panelPreset name, so a follower scales to the glass's size. */
  panelPreset: string;
  /** The same Solo2Dials the server built for the engine, caption included. */
  dials: Solo2Dials;
  /** What is on glass, after any advance this request made; null only when nothing is drawable. */
  screen: {
    slot: number;
    shownSince: number | null;
    endsAtMs: number | null;
    /** As the draw pinned them, play order, the drawn frame last. */
    shownSnapshotIds: number[];
  } | null;
  /**
   * `shownSnapshotIds` resolved against the pool, play order, frames the
   * pool has since dropped omitted, PLUS the projected next dwell's run so
   * the arrival can be preloaded. Nothing else: no bins, no tape, no queue
   * beyond the first draw.
   */
  entries: EntryView[];
  /** The projected next dwell's frames, play order (`version.shown` over `version.next`). */
  next: EntryView[];
  build: string;
}
```

Size: a run is at most the frame cap (tens of frames) and an `EntryView`
is about 1.2 KB, so the projection is a few tens of KB where the state
view is 1 MB.

`dials` are built exactly as the state route builds them:
`dialsFrom2(withCaption(mergeSettings(SOLO2_SETTINGS_SCHEMA, live.solo2),
live.shared))`. A follower does not fetch settings and does not merge
anything client-side. `panelPreset` is `mergeSettings(SHARED_SCHEMA,
live.shared).panelPreset`.

A screen row written before the dwell was pinned (#184) has no
`shownSnapshotIds`. The state route still re-derives a run for that case;
the projection does not. Every row has been rewritten thousands of times
since, so the projection returns `entries: [current]` and the follower shows
the drawn frame alone. No fallback derivation ships.

Headers:

```
Cache-Control: public, s-maxage=1, stale-while-revalidate=4
```

Vercel's CDN caches a function response that sets `s-maxage`, keyed on the
full URL, per region. Worst-case origin rate is one call per second per feed
per region while anyone is watching, whatever the follower count, and that
is also the worst-case rate of advance attempts. A one-second window is what
the beat allows: a follower must see the new slot within the same beat. A
stale hit inside the revalidate window is tolerated by the follower's retry
(4.2), not by a longer TTL. `x-vercel-cache` on the response is how the
smoke test proves a HIT.

Neon cost: the glass's own minute poll already keeps compute awake, so the
extra reads are query load, not duty cycle. If a quota email ever names this
route, the next step is to publish the projection to Redis on each draw and
make this route a Redis read. Held in reserve, not built.

### 4.2 `useGlassFollower(feed)`

One hook for every follower. Returns the `SoloGlass` shape
(`useSoloGlass.ts`) plus `dials` and `panelPreset`, so `Solo2Screen` (part
5) cannot tell what fed it.

The loop:

1. On mount, fetch the projection. Preload `next`'s images.
2. Arm a timer for `screen.endsAtMs + FOLLOW_GRACE_MS` (700 ms: the first
   origin call past the end makes the draw, then the cache window). When it
   fires, fetch the projection.
3. If the slot moved, adopt the new state and go to 2.
4. If the slot did not move, retry every `RETRY_MS` (1,000 ms) for up to
   `FOLLOW_PATIENCE_MS` (10 s). This covers a stale cache hit and a slow
   commit. Under advance on read the slot moves on the first origin call,
   so the patience window is for the cache, not for another screen.
5. After that, something is wrong on the server (nothing drawable, or an
   error): drop to the slow poll, one fetch per `STATE_REFRESH_MS` (60 s),
   and return to 2 whenever a response carries an `endsAtMs` in the future.
6. Independently of the above, the 60 s refresh always runs, so a follower
   that missed a boundary self-heals within a minute.

`endsAtMs` null (nothing drawable): slow poll only.

The hook calls `useBuildReload(view.build)` exactly as `useSoloGlass` does,
so every follower reloads itself after a deploy. That is why the projection
carries `build`.

Never a POST. The hook has no `drive` and no `dozing` input; there is
nothing for a follower to decide.

### 4.3 What a viewer sees

The beat puts every frame change on a 4 s wall-clock grid and the plan is
integers, so a follower that knows `shownSince` and the plan lands on the
same beats as every other follower whenever it joined. A visitor who opens
the page mid-dwell joins the run at the frame the grid says, as `stageAt`
already does for a reloaded kiosk tab. At a boundary the mirror and the
glass change frames within about a second of each other. With the Pi off,
the mirror keeps going. With nobody watching at all, nothing advances,
which is the same as today and costs nothing.

### 4.4 Doze

Doze is the glass going black, and only that. On the kiosk pages
`useKioskRuntime` keeps computing `dozing` from the local toggle, the remote
flag, and the `?quiet=` hours in the glass's local time, and
`KioskDozeOverlay` keeps drawing the black. What goes away is `dozing`
reaching the schedule: the solo2 kiosk page no longer passes it into
anything that could stop an advance, because nothing on the page advances.
Behind the overlay the follower keeps stepping, so when the glass wakes it
is already on the right frame.

The remote doze toggle in Ops therefore means "glass black" and no longer
"stop the show". The scoring tick keeps its gate (`shouldRunTick`): it is
about intake cost and gallery presence, and it stays on the Pi.

## 5. `Solo2Screen`: the renderer without its source

`Solo2Kiosk` (`app/components/solo2/index.tsx`) today is one function that
calls `useSoloGlass` and then renders from it. Split it:

- `Solo2Screen({ glass, dials, width, height, feed, debug })` — everything
  after the hook call: the dwell state, the pinned run and plan, `useStage`,
  the preload of the next run, `Solo2Frame`. Given a glass and dials, it
  draws. `entries` is used only for resolving `shownSnapshotIds` and for
  the next run's preload, which is exactly what the projection carries.
- `Solo2Kiosk(props: MosaicProps)` — calls `useGlassFollower(props.feed)`
  and renders `Solo2Screen` with the projection's dials. It ignores
  `props.settings`, `props.shared`, `props.dozing`, and `props.driveSchedule`:
  the dials come from the same live profile by a shorter path, and the
  other two no longer mean anything to solo2. The kiosk page and the
  registry do not change.
- `MirrorPage` — `useGlassFollower`, then `Solo2Screen`.

The re-derivation fallback in `Solo2Kiosk` (a run computed from the pool
when the row has no pin) is deleted rather than moved: the projection never
returns a pinned list without its frames, and an unpinned row yields the
drawn frame alone.

`useSoloGlass` and its `drive` branch remain for solo v1 only, until part 7.

## 6. Tests

- `app/api/mirror/state/route.test.ts`: the `Cache-Control` header; 400 on
  a bad feed; `entries` is the resolved run plus the next run and carries no
  bins, tape, or wider pool (with a pool of 800 entries the response has at
  most cap + next-cap frames); dials equal what the state route builds for
  the same profile; `panelPreset` and `build` present; an unpinned row
  yields `entries: [current]`. Advance on read: a request past `endsAtMs`
  draws and answers with the new slot; a request before it does not draw;
  two concurrent requests past it produce one draw and both answer with the
  same row; a screen with no row draws.
- `app/lib/solo/advance.test.ts`: `advanceIfDue` matches the POST route's
  behaviour case for case (the route's existing tests move here), including
  `nearestTick`.
- `app/api/kiosk/solo/state/route.test.ts`: the studio profile path still
  never writes.
- `app/components/solo2/useGlassFollower.test.tsx`: fetches at `endsAtMs +
  grace`; retries once a second while the slot is unchanged and stops after
  the patience window; drops to the slow poll and returns to boundary
  timing when a future `endsAtMs` arrives; the 60 s refresh still fires;
  never fetches with a method other than GET.
- `app/mirror/MirrorPage.test.tsx`: renders with the projection's dials and
  panel; never fetches `/api/kiosk/state`, `/api/kiosk/tick`,
  `/api/kiosk/solo/state`, or `/api/kiosk/solo/advance`; no debug overlay
  with `?debug=1` in the URL; black before the first response.
- `app/kiosk/sunset/page.test.tsx` and sunrise: with `activeVersion: solo2`
  the page issues no POST to the advance route while dozing or awake, and
  the doze overlay still renders.
- `app/components/solo2/index.test.tsx`: the rendering assertions move to
  `Solo2Screen` with a hand-built glass; `Solo2Kiosk` is tested to call the
  follower and to ignore `dozing` and `driveSchedule`.

Smoke after deploy: curl the projection twice in a second and read
`x-vercel-cache: HIT` on the second; open `/sunset` on a phone beside the
glass and watch one frame change land on both within about a second; then
toggle remote doze in Ops and watch the phone keep stepping while the glass
is black.

## 7. Retiring the mosaics (second PR)

solo2 becomes the registry default and the mosaics go. This is a deletion
PR: no renames, no restructuring of what stays.

Delete:

- `app/components/mosaic/v1` to `v4` and their rows in `registry.ts`
  (`MOSAIC_VERSIONS`, `MOSAIC_SETTINGS_SCHEMAS`). `DEFAULT_MOSAIC_VERSION`
  becomes `solo2`; `resolveMosaic` still falls back to it for an unknown
  name.
- The studio's mosaic surface: `app/studio/MosaicPreview.tsx`,
  `app/studio/panels/MosaicPanel.tsx`, `SaveSceneButton.tsx`,
  `useSceneWebcams.ts`, `restoreSceneDials.ts`, and the `mosaic` branch of
  `surfaces.ts` (`SurfaceKind` narrows to `solo`).
- The scene-capture path: `app/lib/scenes/`, `app/api/kiosk/scenes/`,
  `scripts/export-scene-pool.mjs`. The `kiosk_scenes` table stays; nothing
  reads it.
- On the kiosk pages, `useLoadTerminatorWebcams` and the `webcams` /
  `peerWebcams` props, which no remaining renderer reads. This also removes
  a per-minute pool fetch from the Pi. `MosaicProps.webcams` becomes
  optional.
- The glass-side trigger, all of it: `useSoloGlass`, `driveSchedule` and
  `dozing` on `MosaicProps`, and `POST /api/kiosk/solo/advance`. solo v1
  moves onto `useGlassFollower`, and the projection route accepts
  `version=solo` alongside the default `solo2` (any other value: 400), so
  both remaining versions advance on read through one path.

Keep: `solo` and `solo2` both registered. The `activeVersion` dial's options
are built from the registry, so it narrows to those two on its own.

Stored settings for `v2`, `v3`, `v4` stay in the database and are ignored:
`schemaFor()` in `knownSchemas.ts` already returns null for a namespace the
build does not know. Two things the PR must show rather than assume: a
deploy snapshot that carries `v3` deviations still opens in Deploy History,
and a stored `activeVersion` outside the narrowed enum merges to the default
rather than throwing.

Verified by the existing suite going green and `npm run build` passing with
the imports gone. The mirror does not depend on this PR.

## 8. Rollout

1. PR 1 merges and deploys. The Pi's tabs reload themselves on the new
   build stamp (#189) and come up as followers; the solo2 kiosk page has
   stopped posting the advance. Smoke as in part 6.
2. If the glass does not reload on its own, `scripts/pi/kiosk-doctor.sh
   --sync --reload` (`docs/ops/pushing-an-update-to-the-glass.md`).
3. PR 2 merges after PR 1 has been watched for a day.
