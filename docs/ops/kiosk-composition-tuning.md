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

Out-of-range numbers clamp. Anything malformed is **ignored**, so the
committed default survives — a typo degrades to normal rendering rather than
a blank screen.

## Loop

Iterate on the Mac, where reload is instant:

```
npm run dev
```

then open, at a window sized like the panel (1080×1920 portrait):

```
localhost:3000/kiosk/sunset?setup=1&floor=120&ceil=340&growth=2.5
```

`setup=1` captions each tile with lat/lng and percentile and counts
tiles/dropped/skipped — so you can see *why* a value did what it did, not
just the result.

## A note on panels

Tile sizes are absolute pixels. A 27" 1440p panel is denser than a 27" 1080p
one, so the same `floor`/`ceil` render **physically smaller** on the KTCs than
on the Dells — roughly 75%. Numbers tuned on one panel are a starting point on
the other, not a transfer.

## On the Pi

`~/kiosk-launch.sh` lives only on the Pi and is not yet in this repo. Getting
it under version control — and teaching it to accept a query string — is the
remaining piece; see the kiosk access notes for how to reach the display Pi.
