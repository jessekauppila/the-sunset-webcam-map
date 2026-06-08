# Pi-Side Alignment Tool v0.4 — Sun-Tap Instant Aiming

Status: Draft v0.4 — 2026-06-07. Amends v0.3 (`2026-05-17-pi-alignment-v0.3-sun-self-calibration-design.md`).
Owner: Jesse Kauppila
Sub-project C, fourth iteration.

---

## 1. Problem

v0.3 made the camera figure out its own compass heading by watching the sun across many sunset windows (`solvePnP` over N≥5 observations). It's precise (±2°) but **eventual** — calibration completes over **1–7 days of clear sunsets**, and in the meantime the operator gets no live aiming feedback at all. v0.3 explicitly **dropped** the v0.1 "sun-tap" mechanic in favor of this hands-off auto-detection.

That trade killed the thing that makes commissioning fast: an **instant "aim it in 5 minutes" moment.** For the person physically pointing the camera (Jesse commissioning units, or a recipient at install time), "mount it roughly west and wait a week to find out if it's right" is the wrong loop.

v0.4 **re-introduces sun-tap as the instant fast path** and keeps v0.3's auto-calibration as the **precise, self-healing fallback** — they are complementary layers, not either/or.

## 2. Core idea (plain language)

The camera can *calculate* exactly where the sun is in the sky right now — pure astronomy from date, time, and GPS location. What it **cannot** know on its own is which compass direction it's physically pointed; the MPU-6050 gives roll + pitch (tilt vs. gravity) but **no heading/yaw**, and there is no magnetometer in the BOM.

**Sun-tap connects the two:** the operator taps the visible sun in the live camera preview. The system reasons *"the sun is really at azimuth A; you just showed me it's at pixel offset Δ from frame center; therefore the camera is pointed at A − (Δ converted to degrees)."* One tap turns "I know where the sun is" into "I know where I'm pointed." From there it draws the summer/winter sunset extremes and a "does the year fit in frame" check, and the operator nudges until framed.

### Prior art / validation

This is a proven approach, not an improvisation:
- **Sunpass** (Applied Optics, 2022, doi:10.1364/AO.61.001398): camera-based sun-tap heading with accelerometer tilt, **no magnetometer** — **0.5° raw accuracy, 0.06° calibrated.** We need only a few degrees for aiming.
- **PhotoPills "visual calibration"**: align the virtual sun to the real sun, store an azimuth offset — sun-tap with a swipe instead of a tap.
- **Compass-free is the correct call, not a compromise.** Phone magnetometers are ±25° worst-case and worse near metal (e.g., the camera enclosure); every field app bolts a manual sun/landmark correction on top. We skip the unreliable compass and go straight to the reliable correction.

## 3. Goals

1. **Instant heading from one sun-tap** — accurate enough to aim (±a few degrees) the moment the sun is visible, no waiting.
2. **A live aiming overlay** that shows, on the Pi's camera feed: the horizon, today's sun path, the summer/winter solstice sunset extremes, the current sun, and a "does the whole year fit in this frame" check.
3. **One shared visual language** across all sunrise *and* sunset cams, parameterized by phase (§5.2).
4. **Honest confidence** — the overlay never draws a heading it doesn't actually have (§5.4). This is the design rule derived from the gyro silent-zeros bug.
5. **Phone-first, no app** — served as a mobile web page reachable over the LAN; the operator opens a URL and taps.
6. **High-latitude help** — when the annual sunset arc is wider than the lens FOV, guide the operator to the best compromise aim rather than just failing (§5.6).
7. **Stays compatible with v0.3** — sun-tap produces the same heading artifact auto-calibration would; auto-calibration (when later implemented) refines and self-heals it.

## 4. Non-goals (explicitly deferred)

- **Implementing v0.3's full auto-calibration pipeline** (`detect_sun`, `pose_solver` over N observations, drift via residuals, lens-intrinsics bench calibration, OpenCV, skyfield-precise, the Subproject-B clock-drift hard-blocker). v0.4 ships the instant fast path first; auto-cal is the precise fallback layer, built later. (Per the "validate output before optimizing" learning: prove the instant aim feels right before investing in the heavy precise pipeline.)
- **The commissioning↔field-setup state machine** — "Pi boots into setup mode until aimed, then flips to capture mode," WiFi onboarding, and the **AP-mode hotspot** for setup before the Pi has WiFi. Its own sub-project (spec E territory).
- **The relocation/recommission workflow** — moving a unit to a new location and re-aiming. Rides on the same field-setup sub-project. (Open question: where location lives — §9.)
- **Motorized auto-pan** that physically tracks the migrating sunset. A future hardware sub-project (motor, mount, control).

## 5. Design

### 5.1 What already exists vs. what's new

**Reuse (built, tested):**
- `solstice_math.py` — `sunset_azimuth_for_day`, `az_to_pixel`, `count_sunsets_in_fov`.
- `setup_alignment.py` renderers — `render_align_page`, `render_orientation_json`, `stream_mjpeg` (renderers only; no server).
- `gyro_driver.py` — `read_orientation`, plus `wake()` / `make_orientation_reader()` (PR #4) so the IMU is never read asleep.
- `orientation_sampler.py` — background roll/pitch sampler.

**New in v0.4:**
- A heading model + sun-tap math (`heading.py`): tap pixel + computed sun azimuth + IMU roll/pitch → device heading; plus the confidence state.
- The phase-parameterized overlay updates to `render_align_page`.
- FOV-fit + high-latitude compromise logic (extends `count_sunsets_in_fov`).
- `setup_server.py` — the HTTP server wiring it all together (§5.7).
- A minimal sun-position function (`compute_sun_azimuth(lat, lng, t_utc)`) — for the fast path this can use a lightweight algorithm (NOAA/Spencer, already partly in `solstice_math`) rather than v0.3's full skyfield ephemeris, since rough aim tolerates ~1° error.

### 5.2 Shared visual language (canonical, phase-parameterized)

One legend, used by every sunrise and sunset cam, and reusable in the product (map/galleries):

| Element | Style | Meaning |
|---|---|---|
| Horizon | thick **white** solid line | true level (from the accelerometer) |
| Today's path | **yellow** bold arc | the sun's path today |
| Golden hour | **orange** band where the arc nears the horizon | the money window |
| Summer solstice | **red** dashed | northern extreme of the sunset/sunrise position |
| Winter solstice | **cyan** dashed | southern extreme |
| Current sun | filled **yellow** dot on the arc | live sun position |
| FOV fit | vertical edge bars — **green** = fits, **red** = clipped | does the whole year fit in frame |
| Up reference | white **↑ UP** | housing-up direction |

**Phase just mirrors it.** Sunset cam faces **west** (~270°): arcs descend to the horizon, summer extreme to the NW, winter to the SW. Sunrise cam faces **east** (~90°): arcs ascend from the horizon, summer extreme NE, winter SE. Identical legend, flipped by direction; a `phase` parameter drives the whole thing.

The **horizon line is a first-class element**: it's what the operator aligns to the real visible horizon (confirms level + pitch), it's the baseline the solstice arcs cross (so sunset points sit *on* it), and it anchors the overlay. If terrain (hills/trees) rises above true level, the gap between the white line and the visible skyline shows how much horizon is lost (the sun actually vanishes at the terrain line).

### 5.3 The aiming overlay

Drawn on the live MJPEG preview (ASCII sketch — sunset/west example):

```
┌─ HUD ──────────────────────────────────────────────────────┐
│ roll 0.3°  pitch 1.1°   ● LEVEL    focus ✓   heading: TAPPED │
├────────────────────────────────────────────────────────────┤
│   ‖FOV edge                                      FOV edge‖   │ green when both
│   ‖              ☀ (today's sun, yellow)                ‖   │ solstices inside
│   ‖     ╱‾‾‾‾‾‾‾‾(yellow arc, orange near horizon)‾‾╲    ‖   │
│ ══╪═══┊═══════════════════════════════════════════┊══╪═══   │ thick white horizon
│   ‖   ┊ winter SS (cyan dashed)        summer SS  ┊  ‖  ↑UP  │
│   ‖   233°·Dec21                          307°·Jun21 ‖       │
│  Before tap: "Point at the sun and tap it to set heading"    │
│  After tap:  "Aimed 268°W · both solstices in frame ✓"       │
└────────────────────────────────────────────────────────────┘
```

Flow: **level it** (accelerometer badge greens) → **tap the sun** → heading anchors → solstice arcs + FOV check appear → **nudge** until both dashed arcs sit inside the green FOV edges → done.

### 5.4 Heading-confidence model (the silent-fake-signal guard)

Heading has three honest states. The overlay must never present a better state than it's in — this is the architectural form of the gyro silent-zeros lesson (a wrong-but-confident overlay is the same failure class).

| State | When | Overlay shows |
|---|---|---|
| **Uncalibrated** | No sun-tap yet, or sun not visible | Level badge + horizon + "tap the sun" prompt. **No solstice arcs, no FOV check** — nothing speculative. |
| **Tapped** | Operator tapped the sun | Full overlay live. Badge `heading: TAPPED 268°W`. |
| **Suspect** | roll/pitch has drifted from their values at tap-time (housing moved), or a second tap disagrees with the first | Overlay dims, badge `heading: re-tap`. Triggers the **move/drift notification**. |

The suspect→notification path is the stability feature: if the camera is bumped or re-aimed, the system flags it and asks for a re-tap rather than silently rendering stale geometry.

### 5.5 Sun-tap math

```
heading_deg = sun_azimuth_deg − pixel_offset_to_angle(tap_px_x)
```

- `sun_azimuth_deg = compute_sun_azimuth(lat, lng, now_utc)` — sun's true azimuth.
- `pixel_offset_to_angle(px_x)`: horizontal angle of the tapped pixel from frame center, from the known HFOV: `((px_x − width/2) / width) × HFOV` (pinhole approximation — adequate for rough aim; lens-distortion-corrected intrinsics are a v0.3-grade refinement, not needed here).
- IMU **roll/pitch** level the frame so the horizontal pixel axis maps cleanly to azimuth; a large tilt at tap-time is rejected ("level the camera first").
- One tap suffices to aim. A **second tap** on a later sun position tightens the estimate and doubles as a sanity check — if the two headings disagree by more than a few degrees → **suspect** state.

### 5.6 FOV-fit and high-latitude nudge

The fit check solves: does the full-year sunset arc fit the lens FOV at this latitude? The arc half-width is `arcsin(sin 23.44° / cos[lat])`; it fits when `2 × that ≤ usable FOV`. Equivalently, a lens of horizontal FOV H covers latitudes up to `arccos(sin 23.44° / sin(H/2))` (with ~5° per-side margin recommended so extremes avoid the distorted edges):

| Usable HFOV | Comfortable latitude limit |
|---|---|
| 90° | ~52° |
| 100° | ~56° |
| ~102° (Arducam Wide; "120°" is *diagonal*) | ~57° |

Behavior when it **doesn't** fit (high latitude):
1. **Compromise aim (in scope):** instead of "clipped," show the single fixed aim that captures the most sunsets/year (reuses `count_sunsets_in_fov`): *"can't fit the whole year — best aim captures 280/365, point here ←."*
2. **Seasonal nudge guidance (designed, served by notifications):** *"nudge ~8° south for winter"* a few times a year as the sunset migrates — manual re-aim, guided, riding the same notification channel as drift.
3. **Motorized auto-pan:** deferred (§4).

### 5.7 Setup-server

A stdlib `ThreadingHTTPServer` (no Flask — preserve the firmware's two-dependency footprint), one module `setup_server.py`. Threaded because the long-lived MJPEG stream must not block the overlay's `state.json` polling.

| Route | Serves |
|---|---|
| `GET /` | the aiming page (`render_align_page`, phase-parameterized) |
| `GET /setup/preview.mjpg` | live MJPEG (`stream_mjpeg`), rate-limited; a lock serializes camera access |
| `GET /setup/orientation.json` | live roll/pitch (gyro via `make_orientation_reader` — woken) |
| `POST /setup/tap` | `{pixel_x, pixel_y}` → compute + store heading → returns heading + fit result |
| `GET /setup/state.json` | heading state (uncalibrated/tapped/suspect) + aim + fit, polled by the overlay |

- **Camera arbitration:** the camera is a singleton (picamera2) — the setup-server and the capture/upload service are **mutually exclusive by mode**: setup-server owns the camera while aiming; capture owns it during sunset windows. If the camera is busy, `preview.mjpg` returns **503** with a clear message rather than hanging.
- **Auto-run seam:** the full "boot into setup mode → flip to capture mode when aimed" state machine is the deferred field sub-project (§4). For the **cam1 prototype**, the setup-server is a runnable unit mutually exclusive with capture — enough to prototype the aiming, with auto-mode-switching as the clean follow-on seam.
- **Testable without a Pi:** `run()` takes an injectable `frame_source` and `reader`, so route dispatch, content-types, and the tap math are unit-tested with fakes; the hardware path is just the default wiring.

### 5.8 Phone-first client

- Served as a mobile web page at the Pi's LAN address (e.g. `http://sunset-cam-1.local:8080`). **No app to install** — open a URL (aligns with the non-technical-recipient streamlined-deployment goal).
- `render_align_page` is already responsive (`<meta viewport>`). Design the tap as a **touch event** (handle pointer/touch, not just mouse); the MJPEG scales to the phone viewport with the overlay aligned to it.
- **Important:** the phone shows the **Pi's** camera feed, not the phone's camera — the operator taps the sun *as the Pi sees it*, because we calibrate the **Pi's** heading.
- **Connectivity:** works when phone + Pi share a WiFi. Cam1 prototype: home WiFi → the Pi's address. The "before the Pi has WiFi" case (a recipient's house) needs the Pi to host an **AP-mode hotspot** — deferred field sub-project (§4).

## 6. Testing

TDD throughout. Unit tests need no hardware (injected `frame_source`/`reader`):
- `pixel_offset_to_angle(px, width, hfov)` — center → 0°, right edge → +HFOV/2, left edge → −HFOV/2.
- `compute_sun_azimuth(lat, lng, t_utc)` — cross-check a known value against NOAA Solar Calculator.
- Sun-tap heading: synthetic tap pixel + known sun azimuth + known tilt → recovers the expected heading.
- Confidence transitions: no tap → uncalibrated (no arcs); tap → tapped; tilt-drift or disagreeing second tap → suspect.
- FOV-fit + latitude limits: known latitude/HFOV pairs → fits/clips as computed; compromise aim returns the max-sunset azimuth.
- setup-server route dispatch: correct status/content-type for each route with a fake frame source; `POST /setup/tap` returns a heading; busy camera → 503.

Hardware-gated (manual, on cam1): tap the real sun on the phone preview; verify the computed heading matches reality; verify solstice arcs + FOV check render; bump the camera → suspect/notification fires.

## 7. Design rules carried from compound learnings

- **No silent fake signal** → the heading-confidence model (§5.4): draw nothing speculative; degrade honestly to "re-tap." (From the MPU6050 fake-zeros bug.)
- **Validate output before optimizing** → ship the lean sun-tap fast path and prove the aim feels right on cam1 *before* building v0.3's heavy precise pipeline. (Today's learning.)
- **Don't trust "addressable" as "working"** → the tap flow surfaces the actual computed heading for the operator to visually confirm against the real sun, rather than asserting correctness silently.

## 8. Relationship to v0.3

v0.4 **amends** v0.3; it does not replace it. v0.3's auto-calibration becomes the **precise, self-healing fallback layer** built later: it refines the sun-tap heading over clear sunsets, and detects drift independent of the operator. The heading artifact is shared — sun-tap writes an initial heading; auto-cal (when implemented) refines the same record. v0.3's focus-verification, camera-source abstraction, and heartbeat provenance fields remain valid and unaffected.

## 9. Open questions

1. **Lens FOV choice** — image drama (narrower ~90–100°, sun fills the frame, less edge distortion) vs. one-SKU-everywhere coverage (wider ~102°+). The aiming tool is FOV-parameterized and warns on clip, so a narrower lens is *safe* to choose per-latitude. Jesse investigating Arducam options. (Decide deliberately; does not block this spec.)
2. **Where does location (lat/lng) live, especially on relocation?** Today it's set in the cloud camera record at `tier0-create-camera.sh` time and is *not* in the Pi config; the setup-server overlay needs it (flag or fetched). Relocation = update location + re-aim. Resolve in the field-setup sub-project.
3. **Clock-accuracy tolerance for sun-tap.** Sun azimuth drifts ~0.25°/minute of clock error. Rough aim tolerates a few minutes of skew, so sun-tap likely does **not** inherit v0.3's hard Subproject-B blocker — confirm the tolerance and document it.

## 10. Implementation slice order (cam1 prototype)

1. `compute_sun_azimuth(lat, lng, t_utc)` (lightweight) + tests vs. NOAA.
2. `pixel_offset_to_angle` + the sun-tap heading function + tests.
3. Heading state model (uncalibrated/tapped/suspect) + tests.
4. FOV-fit + compromise-aim extension to `solstice_math` + tests.
5. Overlay updates to `render_align_page`: phase parameter, confidence-gated arcs, FOV-fit bars, horizon line, touch tap handler + tests.
6. `setup_server.py` (ThreadingHTTPServer, the five routes, camera lock, injectable deps) + route tests.
7. Wire on cam1: run the setup-server (capture stopped), open on phone, tap the sun, verify the aim — the hardware-gated validation.

## 11. Sources / precedent

- Sunpass solar compass — Applied Optics 2022 (doi:10.1364/AO.61.001398): camera+accelerometer sun-tap heading, no magnetometer, 0.5°/0.06°.
- PhotoPills visual calibration (swipe-to-align azimuth offset); arc color encoding (yellow/orange/purple twilight).
- Sun Seeker (solstice color convention: summer red / today yellow / winter cyan; gyro-only + landmark-drag modes).
- Sun Surveyor, Helios Pro (ARKit), Shadowmap, Cadrage — AR sun-path + FOV-framing conventions.
- Magnetometer accuracy caveats (±25° worst-case; interference) — motivates compass-free sun-tap.
