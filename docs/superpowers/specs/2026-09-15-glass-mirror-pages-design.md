# Glass mirror pages: `/sunrise` and `/sunset`

Issue: #218. Two PRs: the mirror (this spec, parts 1 to 6) and the mosaic
retirement (part 7), which is useful on its own and reviewable on its own.

## 1. What this is

Two public pages that show what the glass is showing. `/sunset` is the right
screen, `/sunrise` the left. Each renders the solo2 screen for its feed with
the live profile's dials, scaled into the browser window, and changes frames
in the same second the glass does. The page **follows** the server's screen
state and never **drives** it: it posts no tick, no advance, and never
reports itself as the glass.

The kiosk routes (`/kiosk/sunrise`, `/kiosk/sunset`) do not change, and the
Pi keeps loading them.

### Vocabulary

- **Glass** — the two panels in the gallery, driven by the Pi's kiosk tabs.
  The glass posts the advance at each dwell's end; the server commits the
  next draw and publishes `endsAtMs` for it.
- **Mirror** — a browser tab showing the same screen state, read-only.
- **Projection** — the small public JSON one mirror needs for one feed: the
  current dwell, resolved to drawable frames, and nothing the operator's
  studio view carries.
- **Follower** — the client loop that fetches the projection at each dwell
  boundary.

### Not in this

- A landing page that links the two.
- A one-line caption under the picture on narrow screens.
- The rendezvous (#200), which changes what the screens show, not how a
  mirror shows it.
- Any night state. When the glass dozes it stops advancing, so the mirror
  holds one frame all night with its caption reading "9 hours ago". That is
  honest and it is what ships; a "the glass is asleep" line is a later issue.

## 2. What was found before designing this

Three claims in the first draft did not survive the code.

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

**The kiosk page's plumbing must not be reused.** `useKioskRuntime` polls
`/api/kiosk/state?kiosk=1`, and that marker is what the Ops panel reads as
"the glass is alive" (`app/api/kiosk/settings/route.ts` via
`getKioskLastPoll`). A hundred mirror visitors would report a healthy glass
while the Pi is dark. The kiosk page also loads the terminator webcam pool
(`useLoadTerminatorWebcams`) for the mosaics, which solo2 never reads.

## 3. Routes and the page

```
app/sunrise/page.tsx          → <MirrorPage feed="sunrise" />
app/sunset/page.tsx           → <MirrorPage feed="sunset" />
app/mirror/MirrorPage.tsx     the one component
app/mirror/useGlassMirror.ts  the follower
app/mirror/layout.tsx         black, full-window, solo fonts
```

`MirrorPage`:

- Calls `useGlassMirror(feed)` (part 4) and renders `Solo2Screen` (part 5)
  inside `PanelFrame` (`app/kiosk/PanelFrame.tsx`) at the live
  `panelPreset`'s size, read from the projection. `PanelFrame` only engages
  when given a panel; the kiosk without a preset renders at window size.
  The mirror always passes the live preset, so a visitor sees the glass's
  composition, pillarboxed on a landscape desktop and nearly full-bleed on
  a portrait phone. The renderer was never tuned for other aspect ratios,
  and "mirror" means the same picture.
- Before the first projection arrives, and whenever it is null: black.
- Reads **no** query parameters. No `?v=`, no `?panel=`, no `?debug=`, no
  `?setup=`. Overlays are off (`allowDebugOverlays={false}`); there is no
  doze overlay and no `dozing` input.
- Hardcodes `solo2`. The `activeVersion` dial is a kiosk concern. The live
  profile is `solo2` today, and part 7 makes it the default; until then, if
  the glass were switched to `solo`, the mirror would show the solo2
  rendering of the same screen row, which is the one honest thing it can do
  without a second renderer.
- The layout imports `soloFontClassName` from `app/kiosk/soloFonts.ts` (not
  moved) and sets a black, `overflow: hidden`, full-window box. It does
  **not** hide the cursor; that is the gallery's rule, not a visitor's.
- `metadata.title`: "Sunrise" and "Sunset".

The mirror never calls `/api/kiosk/state`, `/api/kiosk/tick`,
`/api/kiosk/solo/state`, or `/api/kiosk/solo/advance`.

## 4. The projection and the follower

### 4.1 `GET /api/mirror/state?feed=<sunrise|sunset>`

A new route, on its own path. Not a flag on the owner-gated state endpoint:
a separate path means the studio profile can never be served from the
cache, and the kiosk's uncached call cannot collide with a cached key. No
auth, no `profile`, no `version` parameter (solo2 is fixed). Unknown feed:
400.

Reads: `getLiveSettingsCached()` (Redis-first), `listActiveEntries(feed)`,
`getScreenState(feed)`. Two Neon reads. It does not read the tape, the
admitted count, or the swept zone; the projection does not carry them.

Response:

```ts
interface MirrorView {
  feed: Feed;
  version: 'solo2';
  /** The live panelPreset name, so the mirror scales to the glass's size. */
  panelPreset: string;
  /** The same Solo2Dials the server built for the engine, caption included. */
  dials: Solo2Dials;
  /** What the glass holds; null when the screen has no row or its frame left the pool. */
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

`dials` are built exactly as `/api/kiosk/solo/state` builds them:
`dialsFrom2(withCaption(mergeSettings(SOLO2_SETTINGS_SCHEMA, live.solo2),
live.shared))`. The mirror does not fetch settings and does not merge
anything client-side. `panelPreset` is `mergeSettings(SHARED_SCHEMA,
live.shared).panelPreset`.

A screen row written before the dwell was pinned (#184) has no
`shownSnapshotIds`. The state route still re-derives a run for that case;
the projection does not. Every row has been rewritten thousands of times
since, so the projection returns `entries: [current]` and the mirror shows
the drawn frame alone. No fallback derivation ships.

Headers:

```
Cache-Control: public, s-maxage=1, stale-while-revalidate=4
```

Vercel's CDN caches a function response that sets `s-maxage`, keyed on the
full URL, per region. Worst-case origin rate is therefore one call per
second per feed per region while anyone is watching, whatever the visitor
count. A one-second window is what the beat allows: the glass posts the
advance at `endsAtMs`, the commit lands a few hundred ms later, and a
follower must see the new slot within the same beat. A stale hit inside the
revalidate window is tolerated by the follower's retry (4.2), not by a
longer TTL. `x-vercel-cache` on the response is how the smoke test proves a
HIT.

Neon cost: the glass's own minute poll already keeps compute awake, so the
extra reads are query load, not duty cycle. If a quota email ever names this
route, the next step is to have `/api/kiosk/solo/advance` publish the
projection to Redis on commit and make this route a Redis read. That is
held in reserve, not built.

### 4.2 `useGlassMirror(feed)`

Returns the `SoloGlass` shape (`useSoloGlass.ts`) plus `dials` and
`panelPreset`, so `Solo2Screen` (part 5) cannot tell which hook fed it.

The loop:

1. On mount, fetch the projection. Preload `next`'s images.
2. Arm a timer for `screen.endsAtMs + FOLLOW_GRACE_MS` (700 ms: the advance
   lands a few hundred ms after the tick, then the cache window). When it
   fires, fetch the projection.
3. If the slot moved, adopt the new state and go to 2.
4. If the slot did not move, retry every `RETRY_MS` (1,000 ms) for up to
   `FOLLOW_PATIENCE_MS` (10 s). This covers a stale cache hit and a slow
   commit.
5. After that, the glass is not advancing (off, dozing, or stuck): drop to
   the slow poll, one fetch per `STATE_REFRESH_MS` (60 s), and return to 2
   whenever a response carries an `endsAtMs` in the future.
6. Independently of the above, the 60 s refresh always runs, as it does for
   the glass, so a follower that missed a boundary self-heals within a
   minute.

`endsAtMs` null (nothing on glass): slow poll only.

The hook calls `useBuildReload(view.build)` exactly as `useSoloGlass`
does, so a mirror tab reloads itself after a deploy. That is why the
projection carries `build`.

Never, under any state, a POST.

### 4.3 What a visitor sees

The beat puts every frame change on a 4 s wall-clock grid and the plan is
integers, so a mirror that knows `shownSince` and the plan lands on the same
beats as the glass whenever it joined. A visitor who opens the page
mid-dwell joins the run at the frame the grid says, as `stageAt` already
does for a reloaded kiosk tab. At a boundary the mirror changes frames
within about a second of the glass. If the glass is off, the mirror shows
the last state the server holds, the run clamped on its last frame (#155).

## 5. `Solo2Screen`: the renderer without its source

`Solo2Kiosk` (`app/components/solo2/index.tsx`) today is one function that
calls `useSoloGlass` and then renders from it. Split it:

- `Solo2Screen({ glass, dials, width, height, feed, debug })` — everything
  after the hook call: the dwell state, the pinned run and plan, `useStage`,
  the preload of the next run, `Solo2Frame`. Given a `SoloGlass` and dials,
  it draws. `entries` is used only for resolving `shownSnapshotIds` and for
  the next run's preload, which is exactly what the projection carries.
- `Solo2Kiosk(props: MosaicProps)` — computes dials from `props.settings`
  and `props.shared`, calls `useSoloGlass`, renders `Solo2Screen`. Unchanged
  from the outside; the kiosk page and the registry do not notice.
- `MirrorPage` — `useGlassMirror`, then `Solo2Screen` with the projection's
  dials.

The re-derivation fallback in `Solo2Kiosk` (a run computed from the pool
when the row has no pin) moves into `Solo2Screen` untouched. For the mirror
it is unreachable, because the projection never returns a pinned list
without its frames.

`driveSchedule={false}` on `useSoloGlass` stays until part 7 deletes its
only caller; the mirror does not use it.

## 6. Tests

Route and hook tests, alongside the code they test:

- `app/mirror/MirrorPage.test.tsx`: renders with the projection's dials and
  panel; never fetches `/api/kiosk/state`, `/api/kiosk/tick`,
  `/api/kiosk/solo/state`, or `/api/kiosk/solo/advance`; issues no POST at
  all; no debug overlay with `?debug=1` in the URL; black before the first
  response.
- `app/mirror/useGlassMirror.test.tsx`: fetches at `endsAtMs + grace`;
  retries once a second while the slot is unchanged and stops after the
  patience window; drops to the slow poll and returns to boundary timing
  when a future `endsAtMs` arrives; the 60 s refresh still fires.
- `app/api/mirror/state/route.test.ts`: the `Cache-Control` header; 400 on
  a bad feed; `entries` is the resolved run plus the next run and carries no
  bins, tape, or wider pool (a size guard: with a pool of 800 entries the
  response has at most cap + next-cap frames); dials equal what the state
  route builds for the same profile; `panelPreset` and `build` present; a
  row with no pinned ids yields `entries: [current]`.
- `app/components/solo2/index.test.tsx`: existing tests keep passing
  against `Solo2Kiosk`; the ones that assert on rendering move to
  `Solo2Screen` with a hand-built glass.

Smoke after deploy: curl the projection twice in a second and read
`x-vercel-cache: HIT` on the second; open `/sunset` on a phone beside the
glass and watch one frame change land on both within about a second.

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
  `scripts/export-scene-pool.mjs`.
  The `kiosk_scenes` table stays; nothing reads it.
- On the kiosk pages, `useLoadTerminatorWebcams` and the `webcams` /
  `peerWebcams` props, which no remaining renderer reads. This also removes
  a per-minute pool fetch from the Pi. `MosaicProps.webcams` becomes
  optional so `solo` and `solo2` need no change.
- `driveSchedule` on `MosaicProps` and the `drive: false` branch in
  `useSoloGlass`, since the mosaic preview was its last caller.

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

1. PR 1 (mirror) merges and deploys. Smoke as in part 6.
2. The Pi is untouched: the kiosk routes did not change.
3. PR 2 (retirement) merges after PR 1 has been watched for a day. After
   its deploy, the glass reloads itself on the new build stamp (#189).
