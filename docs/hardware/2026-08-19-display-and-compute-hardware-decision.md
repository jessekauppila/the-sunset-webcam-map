# Display + Compute Hardware Decision — Gallery Kiosk

**Date:** 2026-08-19
**Status:** DECIDED 2026-08-19 — KTC 27" pair + upgrade-proof mount + Pi 5 kit. Ordering now.
**Supersedes nothing; fills a gap.** On 2026-07-02 a search for "which monitor mount did we
decide on" found no recorded decision anywhere in the repo. This document exists so the display
and compute reasoning stops living only in session transcripts.

---

## Decision

Buy the **KTC H27T22C-3 27" pair**, a **mount specced for the future panel rather than this
one**, and the **Pi 5 kit**. The KTCs are 9:16 portrait — pixel-for-pixel the same aspect as the
Dells — so the existing composition carries over with no layout work.

The deliberate move here is **buying the mount once**. The mount is specced for VESA 200×200 at
19 lb (the 43" upgrade path), not for the 9 lb panels going on it today. If the 43" white
Samsungs happen later, only the panels change.

## Venues — three, with different light

| Venue | Ambient | Verdict at 300 nits |
|---|---|---|
| **Gallery (first show)** | controlled | Fine. 43" is right for back-of-room viewing distance. |
| **Interior space** | controlled | Fine. |
| **Window display** | **daylight through glass** | **No — roughly 8× short in daytime.** |

**The window is a different hardware class.** Storefront window signage in direct sun needs
**2,500–4,000 nits**; even 700–1,000 nit panels wash out behind glass, and 350–500 nits is
explicitly an interior-only spec. No consumer panel in this price range reaches it.

**But the content's hour is dusk.** A sunset piece is most alive exactly when ambient light
collapses — from late golden hour onward a 300-nit panel in a window is not just adequate but
bright. Scheduling the window piece to the terminator is both the cheap answer and the
thematically correct one; the constraint and the concept agree. A window display expected to
read at noon needs signage-class hardware and a separate budget.

**Also flag for any window install:** consumer monitors are not rated for sun-facing glass.
Thermal shutdown is likely, permanent LCD damage (isotropic blackening) is possible, and UV
degrades panels and plastics over time. Treat the window as its own hardware problem, not as a
place to redeploy gallery panels.

---

## Buy list

### Buy now — ~$304 all in

**Displays**

| Item | Qty | Unit | Total |
|---|---|---|---|
| KTC H27T22C-3 27" — 1440p IPS, 450 nits, VESA 100×100, 4.1 kg (9.0 lb) bare | 2 | ~$152 | **~$304** |

**Mount — buy nothing.** Reuse the existing "book mount."

The KTCs are **VESA 100×100 and 9.0 lb bare** — very likely *lighter* than the 27" Dells already
hanging on it (most 27" panels run 8–12 lb bare). If the mount holds the Dells it holds these.
Straight swap, $0.

Buying an "upgrade-proof" mount now is paying for insurance against an upgrade that may never
happen, while a working mount sits on the wall. Buy the mount **when** the 43" panels happen,
not before.

Two things to confirm first, both tape-measure or label questions:

1. **VESA pattern is 100×100** — measure the hole spacing, it should be a 100mm square.
2. **Per-arm rating ≥9 lb.** If it is a pole/pillar mount it is almost certainly static friction,
   in which case the light-panel float problem that affects gas-spring arms does not apply at
   all — another point for the mount already owned.

#### If a mount does get bought later

Pillar/pole form factor, which is the preferred one:

| Option | Notes |
|---|---|
| MOUNTUP MU1006 vertical dual pole stand | VESA 75/100, 11 positions, 12.44" of travel along the pole |
| Chief FDP4100 dual pole mount | Clamps any 1.5–2" OD pole — the option if mounting to an actual architectural column |
| Mount-It! dual monitor wall mount, gas-spring arms | VESA 75/100, 19.8 lb capacity, one wall plate two arms |
| Mount-It! MI-407-1 × 2 | ~$29 ea, 19–43", VESA up to 200×200, 55 lb — **the only one here that clears the 43" upgrade** |

Note that every VESA-100 pole mount above caps around 20 lb with no 200×200 pattern, so none of
them survive the 43" upgrade. That is fine — it is an argument for not buying one now, not for
buying a more expensive one now.

**Compute — buy nothing. Keep the Pi 4B.**

The DRAM crisis has repriced this decision entirely. LPDDR4 (used in the Pi 4 and 5) is **up
sevenfold in a year** as AI hardware demand soaks up production capacity:

| Board | Original MSRP | Now |
|---|---|---|
| Pi 5 8GB | $80 | **~$145–200** ($80 → $95, then +$50 in April 2026) |
| Pi 5 16GB | $120 | **$305** |

A Pi 5 kit now runs **~$277** (board ~$200 + Argon ONE V3 $45 + 27W PSU $20 + card $12) — most of
the panel budget, for a machine not needed yet: **the KTCs are 1440p, not 4K, and the Pi 4B
already drives them.** The Pi 5 was only ever justified by future 4K and video work.

**Cables:** nothing to buy — the Pi 4B in its Argon ONE V2 already presents full-size HDMI.

#### The low-RAM SKUs dodged the crisis

The price rises are **memory-driven, so they scale with RAM**. The small SKUs are close to
original MSRP:

| SKU | Original | Now |
|---|---|---|
| Pi 5 1GB | — | **$45** (Raspberry Pi explicitly protected this price) |
| Pi 5 2GB | — | **$50** |
| **Pi 5 4GB** | $60 | **$65** — essentially unaffected |
| Pi 5 8GB | $80 | ~$145–200 |
| Pi 5 16GB | $120 | $305 |

So a **Pi 5 4GB + Argon NEO 5** is ~$116 all in ($65 + $19 case + $20 PSU + $12 card) versus
~$277 for the 8GB + ONE V3 build. 4GB is ample for two Chromium kiosk windows at 1440p.

**The catch with the NEO 5:** it is a compact case that exposes the Pi's *native* ports, so HDMI
stays **micro-HDMI**. The Argon ONE V2/V3 route HDMI to full-size on the case, which is why the
current cables are full-size HDMI. Going NEO 5 means budgeting ~$16 for two micro-HDMI → HDMI
cables. The ONE V3 at $49 avoids that but costs $30 more than the NEO 5 — roughly a wash, decided
by whether the tidy rear-port layout matters for the installation.

**Still only worth buying if a second simultaneous rig is the plan** (e.g. gallery *and* home
running at once). For one installation at a time the Pi 4B already in hand is the answer.

#### The N100 reversal

The earlier rejection of the N100 rested on it costing the same as a Pi 5 kit. It no longer does:

| | Pi 5 kit | Intel N100 mini PC |
|---|---|---|
| Cost | **~$277** | **~$150** complete (16GB RAM, 512GB SSD, case, PSU, WiFi) |
| H.264 decode | software only | **hardware (QuickSync)** |
| Simultaneous 1080p streams | 1–2 | **~8** |
| Display out | dual 4K60 | triple 4K60 |

At roughly half the price *and* several times the video capability, the N100 becomes the correct
buy for the video phase. Choose a **fanless** model — gallery quiet matters. Verify the ~$150
figure at purchase; mini PCs contain DRAM too and are exposed to the same crisis.

**Decision: $0 on compute today.** Run the KTCs on the existing Pi 4B and revisit when the video
work actually starts — by which point either DRAM prices have eased (there is early optimism on
DDR5) or the N100 is the pick. Do not buy a Pi 5 at these prices.

#### The upgrade path a future mount must clear

| | 32" M8 | **43" M7** |
|---|---|---|
| VESA | 100×100 | **200×200** |
| Weight | 8.8 lb | **19 lb** |
| Stand | height + tilt + ±92° pivot | **tilt only** |

The 32" would have pivoted to portrait on its own stand with no hardware at all. The 43" will
not — portrait *requires* a mount, and it must be a 200×200 pattern rated for 19 lb. The
existing "book mount," sized for 27" Dells, is very unlikely to take it. Samsung sells a
purpose-built **auto-rotating 200×200 wall mount for 43–55"** (VG-ARAB22WMTZA) that swings
between landscape and portrait, which is the elegant if pricier answer.

### Not chosen

| Option | Spec | Why not |
|---|---|---|
| Samsung M8 M80F 32" Warm White | 4K, 400 nits, ~$700/pair | Brighter, but 32" is small from the back of a room and the M8 has no 43" variant |
| Samsung M7 M70F 43" White | 4K, 300 nits, ~$600–720/pair | The upgrade target, not rejected — deferred; white SKU currently out of stock |
| Raspberry Pi 5 kit | ~$277 | Repriced out by the DRAM crisis; the Pi 4B covers 1440p and the N100 wins the video phase |

---

## Panel comparison (corrected figures)

| Panel | Size | Res | Brightness | Finish | Stand | Price/unit |
|---|---|---|---|---|---|---|
| **KTC H27T22C-3** | 27" | 1440p IPS | **450 nits** | black | tilt only | ~$152 |
| KTC H32D6 | 32" | 1440p IPS | — | black | — | ~$190 |
| KTC A32Q8 | 32" | 4K smart | — | black | — | ~$270 |
| Samsung M7 M70F | 32" / 43" | 4K VA | **300 nits** | white/black | height, tilt, pivot | ~$220–360 |
| Samsung M8 M80F | 32" only | 4K VA | **400 nits** | warm white | height, tilt, ±92° pivot | ~$350 |

**The cheap prototype panels are the brightest thing in the table.** The KTC's 450 nits beats
both Samsungs. Brightness is the spec that matters most in a room with ambient light and the
one that cannot be compensated for anywhere else in the chain.

### Two corrections to the Aug 5 2026 research

1. **The M70F is 300 nits, not ~400.** The earlier figure appears to have been carried over
   from the older M70D. This is what pushed the 32" recommendation to the M8 — the real premium
   is +33% brightness, not gamut.
2. **The DCI-P3 argument was dropped.** It was originally used to justify the M8's ~$200/pair
   premium on the grounds that sunset oranges and magentas live where P3 exceeds sRGB. That
   reasoning does not survive the pipeline: source webcam JPEGs are sRGB-encoded and 8-bit, so
   the color was already clipped at capture. A P3 panel either clamps to sRGB (identical output)
   or stretches sRGB across the wider gamut (oversaturation, not more information). The
   bottleneck is the source file, not the display. Gamut is a future-optionality argument for
   the custom cameras, not a today argument.

Also corrected: the M7 has a pivoting height-adjustable stand too, so the pivot stand is not an
M8 differentiator. And the M8 has **no 43" variant** — M80F is 32" only, which is why the
big-and-white recommendation lands on the M7 43". That is a size-class fact, not a merit ranking.

---

## Compute

| | Pi 4B (owned) | Pi 5 kit | Intel N100 mini PC |
|---|---|---|---|
| Cost | $0 | ~$139 | ~$150 complete |
| H.264 decode | HW, 1080p | **software only** | **hardware (QuickSync)** |
| H.265 decode | HW 4K | HW 4K60 | hardware |
| Simultaneous 1080p streams | 1–2 | 1–2 | **~8** |
| Display out | dual 4K30 / single 4K60 | dual 4K60 | dual/triple 4K60 |

**The N100 is not a Raspberry Pi** — it is Intel x86, ordinary desktop Linux, no GPIO, no HATs,
no Argon cases. It was evaluated because it is the honest answer to "what decodes many
simultaneous streams," and rejected because that scenario does not apply here (see below).

**Decision: Pi 5 when the video work starts.** Kiosk scripts (bash, xrandr, chromium flags)
carry over. Keep X11 rather than Pi 5's default Wayland — `xdotool` and deterministic window
placement are what `reload-kiosk.sh` depends on. Note `config.txt` now lives at
`/boot/firmware/config.txt`.

---

## Video architecture

The long-run goal is streaming from **our own cameras**, not from Windy.

**Windy cannot feed this.** Its Webcams API returns still image URLs (token-secured, expiring),
timelapses, and iframe "live player" embeds — not HLS streams that can be pulled into our own
canvas and composited. The free tier is low-resolution images only. Embedding N copies of
Windy's player means their chrome, their branding, no layout control — which defeats the mosaic.

**Owning the cameras means owning the encoder**, which is what makes this tractable.

**Recommended approach: JPEG frame push at 2–10 fps at tile resolution.** Sunsets change
slowly; at gallery viewing distance a 5 fps sunset is indistinguishable from 30 fps. Frame push
means no codec, no decoder, no `<video>` element, no browser compatibility question — and the
existing canvas already draws JPEGs, so it reuses the pipeline we have rather than replacing it.

**Why not just use a video codec:** the browser is the constraint, not the silicon. Chromium on
Linux has patchy HEVC support, so the Pi 5's one genuine hardware advantage (its H.265 block)
may never be reachable from inside a browser. H.264 is what browsers reliably play, and that is
precisely the codec the Pi 5 decodes in software. Frame push sidesteps the whole problem.

**Going 4K buys tile density, not sharpness.** Source webcam images are low-resolution;
upscaling them to 4K makes them softer. The gain is canvas area — more frames on screen at a
legible size, which is a direct lever on the GeoMosaic sparse-breathes/dense-packs behavior.

---

## Open questions

1. **Window display timing.** If the window piece is meant to read in daytime it needs
   signage-class hardware (2,500+ nits) and its own budget. If it runs dusk-onward, the gallery
   panels work — decide which, since it changes whether the window is one project or two.
3. **What replacement panel is inbound?** A Dell replacement would restore a matched pair and
   make Tier 1 optional. The broken panel is a **Dell**, not a KTC — no KTC has ever been owned;
   every prior KTC mention was research.
4. **Verify the Windy stream limitation** against the pro-tier API docs before any architecture
   depends on it.

---

## Multi-venue / fleet note

Same panels, same mount, same Pi at each site means one configuration to reason about rather
than three. Every display is already identified by nothing more than its kiosk URL
(`/kiosk/sunrise`, `/kiosk/sunset`), so "what is that screen showing" is answerable from the URL
alone and the same view runs on the public site.

What does not exist yet is a record of **which physical unit is where**. Worth a small deployment
registry — unit → venue → URL → last-seen — and the natural home is the owner-only My Cameras map
(`project_my_cameras_map`), which already does exactly this shape for cameras. Not built.

## Sources

- [Samsung M80F spec page](https://www.samsung.com/ca/monitors/smart/smart-monitor-m8-32-inch-smart-tv-apps-4k-uhd-ls32fm801unxza/) — VESA 100×100, 4.0 kg without stand
- [Samsung M70F specs](https://www.monitorsfaq.com/en/specifications/samsung-m7-32-smart-monitor-m70f-uhd) — 300 nits
- [Samsung M70F 43" White](https://www.samsung.com/us/monitors/smart/43-inch-smart-monitor-m70f-4k-uhd-vision-ai-monitor-sku-ls43fm703unxza/)
- [KTC H27T22C-3](https://www.amazon.com/KTC-Displayport-Adjustment-Compatible-H27T22C-3/dp/B0F7PRGR2H) · [PC Gamer review](https://www.pcgamer.com/hardware/gaming-monitors/ktc-h27t22c-3-gaming-monitor-review/)
- [KTC 32" lineup](https://us.ktcplay.com/collections/32-inch-34-inch-monitors)
- [Windy Webcams API docs](https://api.windy.com/webcams/docs)
- [Pi 5 codec discussion](https://forums.raspberrypi.com/viewtopic.php?t=357870) · [Jeff Geerling — Pi 5 at 4K](https://www.jeffgeerling.com/blog/2024/can-raspberry-pi-5-handle-4k/)
- [N100 QuickSync multi-stream testing](https://www.xda-developers.com/i-built-a-4k-jellyfin-server-with-intel-quick-sync-for-under-300/)

Prior context: kiosk bring-up in `GALLERY_DISPLAY.md` and
`docs/superpowers/specs/2026-04-13-gallery-display-pi-setup-design.md`.
