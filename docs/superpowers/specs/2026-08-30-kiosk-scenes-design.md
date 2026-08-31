# Kiosk scenes — capture, replay, and the design-tool loop

**Date:** 2026-08-30
**Status:** Approved design, pre-implementation
**Predecessors:** `2026-08-30-kiosk-studio-control-and-mosaic-v2-design.md`
(the studio + v2 spec), `docs/superpowers/plans/2026-08-30-kiosk-studio-phase1.md`
(phase 1, in flight).

## Why

Two goals, one primitive:

1. **Aesthetic design tool (now).** The v2 composition gets dialed in against
   *recorded* states — weird times of day, thin winter pools, one-cam-passes
   nights — instead of only against whatever tonight happens to serve. First
   public showing is ~2026-09-13; the composition should be tuned against a
   library of hard cases before then.
2. **Grant archive (later).** Particularly good days and particularly good
   kiosk renditions get saved, curated, and re-rendered at arbitrary
   resolution for grant applications and promotion.

A "grant-worthy great day" and a "solstice 4:45am edge case" are the same
object — a frozen snapshot of the kiosk's input state — with different tags.
So this is one system: the **scene**.

**Key enabler found in the codebase:** snapshot frames are uploaded to
Firebase with durable public URLs, and the `snapshots` table carries
`webcam_id`, `captured_at`, the image URL, and the `llm_*` ratings. Scenes
can therefore be **reconstructed from history** — "what did the pool look
like at time T" is a query, not a stakeout. The fixture library can be built
this week from months of existing data.

## The scene primitive

A scene freezes exactly what a mosaic version consumes — the `MosaicProps`
input (`app/components/mosaic/types.ts`): a `WindyWebcam[]` pool per feed,
with ratings, lat/lng, and frame URLs embedded — plus provenance about what
was on the glass when (if) it was captured live.

## Storage

Table `kiosk_scenes`:

| column | type | notes |
|---|---|---|
| `id` | serial PK | |
| `label` | text | human name ("solstice 4:45am, 1 passer") |
| `tags` | text[] | e.g. `edge-case`, `showcase`, `grant` |
| `notes` | text | free-form |
| `represents_at` | timestamptz | the moment in world time the scene depicts |
| `state` | jsonb | `{ sunrise: WindyWebcam[], sunset: WindyWebcam[] }` |
| `provenance` | jsonb, nullable | live capture only: `{ activeVersion, settings, gateStats }` |
| `source` | text | `'live'` \| `'historical'` |
| `created_at` | timestamptz | |

Ratings ride inside the `WindyWebcam` rows, as they do on the wire today.
`provenance` is null for reconstructed scenes — we don't pretend to know what
the glass showed at a moment we didn't capture live.

## Capture — two paths, one implementation

- **Reconstruct-from-history** (primary): given a timestamp, compute the
  terminator position at that moment, select the terminator-relevant webcams,
  and join each against its nearest `snapshots` row (within a staleness
  window) to rebuild the pool with durable Firebase frame URLs and the
  ratings of record. Pure function over query results; unit-tested.
- **Capture-now** = reconstruct(now), plus pinning: any cam whose only
  current frame is a Windy-hosted URL (which expire) gets its frame uploaded
  through the existing `webcamSnapshot.ts` Firebase path before the scene is
  saved. Live captures also record `provenance` from the live profile.

Coverage limits are real: a cam with no snapshot row near time T drops out of
the reconstructed scene. That is acceptable — scenes are design fixtures, not
forensic records — but the staleness window is explicit in the API response
(`reconstructed: n, missing: m`).

## API

Owner-gated (same auth as the Ops tab / `kiosk_settings` PATCH):

- `POST /api/kiosk/scenes` — body `{ at?: timestamp, label, tags?, notes? }`;
  omitted `at` means capture-now (with pinning + provenance).
- `GET /api/kiosk/scenes` — list (id, label, tags, represents_at, source).
- `GET /api/kiosk/scenes/:id` — full state.
- `PATCH /api/kiosk/scenes/:id` — label/tags/notes only; state is immutable.
- `DELETE /api/kiosk/scenes/:id`.

## Replay in /studio

The phase-1 preview pane grows a data-source control in the preview header:
**`live | scene ▾`** (scene picker lists label + represents_at). Everything
downstream — version switcher, every dial, panel geometry, both feeds — is
already a function of whatever pool the preview is fed, so a scene flows
through the whole composition untouched. Selecting a scene changes only where
`webcams[]` comes from.

The kiosk itself never reads scenes; replay is a /studio-only surface.

## Testing

Reconstruction (terminator-at-T, nearest-snapshot join, staleness window) is
pure logic with full unit coverage (TDD). API routes get auth + round-trip
tests. The scene → preview wiring is exercised by the existing preview
component tests plus one integration test feeding a fixture scene.

## Sequencing

1. **Now, parallel to studio phase 1** (touches no studio code): migration,
   reconstruction logic, capture + CRUD API. Own branch; coordinate via the
   session protocol since the checkout is shared.
2. **First implementation step:** a DB sanity check — how far back
   `snapshots` history goes and its coverage across the day/year. This
   bounds how wild reconstructed scenes can be and calibrates the staleness
   window.
3. **When the phase-1 preview pane lands:** the `live | scene` selector.
4. **Before the showing:** build the actual scene library (a dozen hard
   cases + a couple of showcase nights) and dial v2 against it.

## Deferred (stacks on the scene store; nothing here blocks the showing)

- **Auto-capture cron** (daily at sunset peak / on gate-pass spikes or
  craters, auto-expiring unless flagged).
- **Scene-gallery grid** in /studio: every saved scene rendered under the
  current dials at once — the "check ten hard nights per settings change"
  view.
- **Invariant fixture suite:** recorded scenes replayed through the layout
  engine in vitest (no overlaps, latitude ordering, floor pinning).
- **Print-resolution export + grant curation UI** — the grant-application
  half. Re-rendering is deterministic, so exports come free once needed.

## Non-goals

- Replaying scenes on the glass itself (kiosk reads `live` settings and live
  data only).
- Video/timelapse capture — scenes are single moments. A "day reel" is a
  sequence of scenes and can be composed later if wanted.
- Editing a scene's state after capture — immutable by design; recapture
  instead.
