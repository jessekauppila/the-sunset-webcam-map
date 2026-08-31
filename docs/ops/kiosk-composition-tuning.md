# Tuning kiosk composition on the glass

The `COMPOSITION_*` constants in `app/lib/masterConfig.ts` are the source of
truth. These URL params exist so a value can be **tried** on a real panel
without a redeploy — iterate in the URL, then promote the winner into
masterConfig and commit.

## Params

Both `/kiosk/sunrise` and `/kiosk/sunset` accept:

| Param | Config key | Range | Default |
|---|---|---|---|
| `floor` | `floorPx` | 10–1000 | 100 |
| `ceil` | `ceilPx` | 10–2000 | 300 |
| `upscale` | `upscaleMax` | 1–5 | 1.5 |
| `growth` | `maxGrowth` | 1–10 | 2.0 |
| `pad` | `padding` | 0–64 | 2 |
| `cull` | `cullOverflow` | `0` or `1` | 1 |
| `lat` | `latWindow` | `north,south`, each ±90, north > south | `70,-60` |
| `setup` | (overlay) | `1` to show | off |
| `panel` | preview size | `dell`, `ktc`, or `WxH` | off (fills window) |
| `quiet` | doze hours | `H-H` or `off` | `1-8` |

Out-of-range numbers clamp. Anything malformed is **ignored**, so the
committed default survives — a typo degrades to normal rendering rather than
a blank screen.

## Loop

Iterate on a normal workstation, in a normal-sized window:

```
npm run dev
```

```
localhost:3000/kiosk/sunset?panel=dell&setup=1&floor=120&ceil=340&growth=2.5
```

`setup=1` captions each tile with lat/lng and percentile and counts
tiles/dropped/skipped — so you can see *why* a value did what it did, not just
the result.

### Why `panel=` and not just a small window

The composition engine lays out against the viewport it is handed. Shrinking
the browser window therefore produces a **different composition**, not a
smaller view of the panel's composition — so it tells you nothing about what
the glass will show.

`panel=` composes at the panel's real dimensions and then scales the finished
result down to fit the window. What you judge at your desk is what hangs on the
wall. It auto-fits, never exceeds 1:1, and restores the mouse pointer that the
kiosk layout hides.

Omit `panel=` and the page behaves exactly as the live kiosk: full window, no
scaling, pointer hidden.

## A note on panels

Tile sizes are absolute pixels. A 27" 1440p panel is denser than a 27" 1080p
one, so the same `floor`/`ceil` render **physically smaller** on the KTCs than
on the Dells — roughly 75%. Numbers tuned on one panel are a starting point on
the other, not a transfer.

This is what `panel=ktc` is for: work out KTC composition before the KTCs are
hung, rather than discovering the shift after mounting them.

## Dozing during a tuning session

The kiosk dims itself to near-black between 1am and 8am local, and `d` toggles
that dim by hand. If a preview goes dark mid-session, that is what happened —
add `quiet=off`.

## The dials moved to `/studio`

`/studio` (owner-only — client-side gate shows "Owner sign-in required" if
you're not signed in, but the real authorization is `requireOwner` on every
mutating route) is now the primary way to tune composition. It's a leva rail
next to a live sunrise/sunset preview pair, backed by the same settings
schema as the URL params above, with two profiles:

- **studio** — your scratch pad. Moving a dial previews instantly and
  persists to the studio profile (survives a reload), but the kiosk glass
  never sees it until you deploy.
- **live** — what `/kiosk/sunrise` and `/kiosk/sunset` actually read. Only
  changes when you push studio to it.

Hold the **HOLD TO DEPLOY** button to push the studio profile to live (the
badge showing `N differ` zeroes out); **↩ revert to glass** snaps the studio
dials back to whatever's currently deployed. Both are explicit actions —
turning a dial alone never touches the glass.

The URL params in the table above still work, and still win: precedence is
**URL param → deployed (live) profile → code default in `masterConfig.ts`**.
That's what makes `?floor=60` useful for a one-off check without disturbing
what's deployed for everyone else.

Under the hood, `/kiosk/*` and `/studio` both read live settings via
`/api/kiosk/state`, which is Redis-first (`getLiveSettingsCached`) and only
falls back to Neon on a cache miss — so deploys show up on the glass within a
poll cycle, not a redeploy.

## On the Pi

`~/kiosk-launch.sh` lives only on the Pi and is not yet in this repo. Getting
it under version control — and teaching it to accept a query string — is the
remaining piece; see the kiosk access notes for how to reach the display Pi.
