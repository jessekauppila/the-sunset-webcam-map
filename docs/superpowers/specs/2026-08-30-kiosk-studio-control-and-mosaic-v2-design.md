# Kiosk studio control screen + mosaic v2 — design

**Date:** 2026-08-30
**Status:** Approved design, pre-implementation
**Predecessors:** `2026-08-04-geographic-mosaic-composition-design.md` (v1 spec),
PR #90 (mosaic versioning scaffold), the v2 handoff prompt
(`~/Documents/Claude Sessions/topics/kiosk-mosaic-v2-session-prompt.md`).

## Why

v1's composition collapses at night: the quality signal floors nearly the whole
pool (measured 2026-08-30 post-#91: 1/39 sunrise and 3/42 sunset frames pass
the 0.55 gate), the percentile engine renders tied scores mid-size, the
overflow culler drops half the pool arbitrarily, and the result is a sparse
scattered look with no hierarchy. Beyond the specific bugs, the deeper problem
is the **tuning loop**: every compositional judgment call is a constant in
code, so each iteration costs a push to main, a Vercel deploy, and a kiosk
reload. v2 is both a fresh composition *and* a fresh workflow.

**The artistic goal** (fixed, not a knob): project the feeling of the world
turning — the constant beauty the sun drags around the planet — and a sense of
*where* these sunsets are. Geography is legible on the glass; emptiness (an
open ocean under the terminator) reads as emptiness, not as filler.

## Operating model

> **Deploys add knobs; dials turn knobs.**

New settings, new engine behaviors, new curve options are code and ride a
Vercel deploy. Once a knob exists, every value change is live within one poll
cycle — no deploy, no SSH, no reload. The judgment-heavy work (is 140px too
small? is the fade too slow?) all happens on the dial side, in front of the
glass.

## Architecture

### Settings schema (the decomposition IS the schema)

Each mosaic version exports a `settingsSchema`: an array of typed knob
descriptors —

```ts
{ key, label, kind: 'number' | 'boolean' | 'enum',
  min?, max?, step?, options?, default, description, section }
```

— grouped into sections matching the composition elements (cadence, merge,
motion, arrangement, visibility, sizing, overlays). The control screen renders
its dial rail generically from the schema, so a future v3 with different knobs
gets a working control surface for free.

A small **`shared` namespace** holds version-independent knobs:

- `activeVersion` — which mosaic the glass runs. Switching and promoting
  versions is a dropdown, not a code change. `DEFAULT_MOSAIC_VERSION` in
  `registry.ts` remains the code-level fallback (and what the public site
  renders).
- **Panel geometry per feed** — sunrise and sunset screen resolution +
  orientation, with named presets (`dell` 1080×1920, `ktc` 1440×2560, custom
  `WxH`). The kiosk, the studio preview, and `?panel=` all read the same
  geometry.

### Storage

Table `kiosk_settings`: one row per `(profile, namespace)` with a JSONB blob.

- `profile`: `'studio'` or `'live'` (extensible later for named installs).
- `namespace`: `'shared'` or a mosaic version name (`'v2'`, …).
- The blob stores **only values that deviate from the code default**. Defaults
  live in the schema, so adding/renaming/removing knobs never needs a
  migration; unknown keys are ignored on read.

### Delivery + precedence

- The kiosk's merged `live` settings ride the **existing `/api/kiosk/state`
  response** it already polls every 60 s. Zero new polling infrastructure;
  worst-case one minute from Deploy to glass.
- Writes go through an owner-gated `PATCH /api/kiosk/settings` (same auth as
  the Ops tab).
- Precedence everywhere: **URL param → server profile value → code default.**
  `?v=v2` on-glass A/B still works with no Pi reconfiguration.
- The schema never crosses the wire — both surfaces are the same Next.js
  bundle and import it directly.

### Studio/live profiles (Preview/Program)

Dials never write to the glass. The model is broadcast's PVW/PGM split,
confirmed by precedent research across five domains (switchers, VJ software,
tweak-panel libraries, CMS draft/publish, lighting-console Blind mode):

- Dials edit the **`studio` profile**; the `/studio` preview always renders
  from it. Experiments persist across sessions.
- The Pi's kiosk only ever reads **`live`**.
- **"Deploy to glass"** — one deliberate, oversized, visually distinct button —
  copies `studio` → `live` and is the *only* write path to the display. Never
  an autosave or a side effect of a slider.
- **"Revert to glass"** copies `live` → `studio` when an experiment dead-ends.
- A **passive, always-on diff badge** near the Deploy button ("3 settings
  differ from glass") whenever `studio ≠ live`, plus per-knob emphasis (bold
  label when a dial differs from the deployed value — the Unity Inspector
  pattern).

Tuned config and deployed config are two persisted objects, not one object
with a confirmation dialog. This makes tuning safe while a gallery kiosk is
running in front of people, and it *is* the studio-vs-deployed split — arrived
early because the profile column makes it nearly free.

## The `/studio` control screen

Owner-gated full-page route (not a drawer tab). Entry: a small upper-left tag
rendered only when logged in as owner, plus a link from the drawer.

Layout (side-by-side, never tabbed — VJ-software convention):

- **Left rail:** dial groups rendered from the active version's schema via
  **leva** (React-hooks tweak-panel library; stable, fits the codebase) —
  collapsible folders per section, per-control reset-to-default. Top of rail:
  version switcher, profile indicator, Deploy / Revert + diff badge.
- **Main area:** live mosaic preview **reusing `panelPreview.ts`** — composes
  at the true panel dimensions from settings and `fitScale`s the finished
  result to the available window. Collapsing the rail full-bleeds the preview
  for a final visual check before Deploy.
- **Status strip:** glass's active version + settings revision, last kiosk
  poll time, tonight's gate-pass count (e.g. "3/42 sunset cams pass").

## Mosaic v2 composition knobs

Built fresh in `app/components/mosaic/v2/` behind `?v=v2`; v1 stays frozen as
the reference. Defaults below are starting guesses — the dials find the real
values.

### Fixed directives (identity of the piece, not knobs)

- One feed per screen (sunrise screen / sunset screen).
- Vertical axis = latitude: northernmost at top, southernmost at bottom.
- Within a latitude band, west → east renders left → right.
- Setup overlay support (kept from v1's core directives).
- Gate-failed frames never spread across the sizing curve: they pin to the
  exact floor. Only gate-passers spread. (The v1 percentile-of-ties lesson,
  baked in as behavior.)

### Knobs by element

**Visibility** — the highest-leverage group (77/81 fail the gate on a normal
night):
- `gateThreshold` (0–1, default 0.55)
- `failedCamPolicy` (`hide` | `showAtFloor` | `showIfRoom`, default
  `showAtFloor` — the "dense carpet of small tiles, few real sunsets big" look)
- `maxTiles` (cap; default unlimited)

**Sizing:**
- `floorPx` (default 100), `ceilingPx` (default 480)
- `curve` (`linear` | `easeIn` | `percentileAmongPassers`)

**Arrangement:**
- `strategy` (`anchorRelax` | `latitudeBands`) — both implemented so the
  zones-vs-continuous question is settled on the glass, not in review.
  - `anchorRelax` (recommended default): each tile's vertical center anchors
    to its true latitude mapped onto screen height, then tiles relax
    sideways/slightly vertically only enough to not overlap. An empty Pacific
    stays visibly empty — the emptiness is the sense of the world.
  - `latitudeBands`: fixed rows by latitude bucket (`bandCount` knob).
- `geographicFidelity` (0–1, default 0.7): 1 = true latitude, gaps stay gaps;
  0 = dense packing, geography advisory only.

**Motion & continuity** (flicker vs blossom):
- `sizeDeadband` (rating delta required to trigger a resize, default 0.3 —
  kills per-tick flicker)
- `sizeEaseSeconds` (default 20 — a blossoming sunset visibly grows over
  minutes; a dying one visibly shrinks)
- `enterFadeSeconds` / `exitFadeSeconds`
- `minSecondsBetweenRetiles` (layout stability floor, default 60)

**Merge** (load-to-load reconciliation):
- `enterTicks` / `exitTicks` hysteresis (defaults 2 / 3 — exit slower than
  enter; the composition is reluctant to churn)

**Cadence:**
- `dataRefreshSeconds` (default 60, riding the existing tick)

**Overlays:**
- `showFeedLabel` (sunrise/sunset title at top)
- `showTileRatings` (per-tile rating + is-sunset badge)
- `showModelReadout` (the `?models=1` machinery, now dialable)

## Phasing — easiest locked first

1. **Settings plumbing + `/studio` skeleton.** Schema types, `kiosk_settings`
   table + owner-gated API, studio/live profiles with Deploy/Revert/diff,
   `/studio` route with leva rail + `panelPreview` pane + status strip.
   Prove the loop end-to-end against v1-independent knobs (overlays, shared
   panel geometry) before any new mosaic exists.
2. **v2 static composition** in `mosaic/v2/`: anchor-and-relax + bands
   strategies, sizing, visibility policy — all schema-driven. On-glass A/B vs
   v1 starts here (`?v=v2` on one monitor).
3. **Motion & continuity:** deadband/damping, hysteresis, transitions — the
   hardest to judge remotely and the easiest to judge with live dials, which
   is why plumbing came first.
4. **Refinement + promotion:** tune on the dials, promote by deploying
   `activeVersion: v2`, eventually repoint `DEFAULT_MOSAIC_VERSION` for the
   public site.

## Testing

Match v1's bar: the layout engine, quality-signal interpretation, settings
merge/precedence, schema validation, and hysteresis/damping logic are pure
functions with full unit coverage (TDD). API routes get auth + round-trip
tests. On-glass judgment is Jesse's; test counts are not the done signal.

## Non-goals (explicitly deferred or rejected)

- **Node-based pipeline editor** — rejected: the pipeline topology
  (load → rate → merge → arrange → size → render) is fixed; only stage
  behavior varies, which enums + dials express. Revisitable without rework if
  a future version truly needs composable topology.
- **Per-webcam manual composition overrides** (v1's
  `compositionOverrides.ts`) — v2 launches without; add only on demand.
- **Named install profiles beyond studio/live** — the schema and table
  support them; no UI until a second install exists.
- **Design / Product Management plugin adoption** — evaluated 2026-08-30,
  skipped: superpowers pipeline + frontend-design skill cover the need.

## Precedent research digest (2026-08-30)

Broadcast PVW/PGM + Take (deliberate sole write path to air); Resolume /
disguise (side-by-side preview + collapsible panels); leva / Tweakpane /
Unity Inspector (folders, reset-to-default, bold-when-differs); CMS
draft/publish (passive always-on diff badge near the publish action);
grandMA/Eos Blind mode (edit state and live state are separate objects).
