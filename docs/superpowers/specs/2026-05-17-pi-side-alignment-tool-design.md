# Pi-Side Alignment Tool

Status: Draft v0.1 — 2026-05-17
Owner: Jesse Kauppila
Sub-project C of the streamlined-deployment umbrella (`2026-05-15-streamlined-deployment-overview.md`).

---

## 1. Problem

A non-technical recipient mounting a Pi camera at home needs to know two things during install:
1. **Is the camera level?** A mounted-sideways camera produces a tilted horizon, which all downstream consumers (the AI ranker, the mosaic display, human viewers) implicitly assume is horizontal. There is no automatic recovery — a sideways image stays sideways.
2. **Which way is up on the device?** The housing is symmetric enough that an operator without guidance can mount it 90° or 180° from the intended orientation. The lens is offset on the front face; "up" has to be communicated.

Today, neither is solved. The cloud wizard's sub-project F stub (`2026-05-16-cloud-wizard-frontend-design.md`) assumes phone-side AR will guide the operator, but the Pi Zero 2 W has no gyroscope, magnetometer, or GPS, and phone compasses are unreliable. The F stub's risk section already flags this as the painful part.

A simpler tool, owned by the Pi itself, solves both problems with no sensors and no math.

## 2. Goals

1. The recipient can level their camera within ±2° of horizontal using only their phone browser and the Pi's own camera feed.
2. The recipient cannot accidentally mount the housing upside down or sideways — both the hardware marker and the on-screen overlay confirm orientation independently.
3. No phone sensors, no astronomy math, no AI, no calibration step. If the live preview shows a level horizon and the housing marker points up, alignment is complete.
4. The tool runs entirely on the Pi, served to the phone over the Pi's local WiFi (already established by sub-project E's captive-portal flow). No cloud round-trip required for the alignment step itself.

## 3. Non-goals

- Sensor-based directional guidance (no compass, no gyroscope on Pi; phone sensors not used).
- Sun-path overlays, solstice azimuth markers, "sunsets/year captured" counters. Considered and explicitly deferred — the calibration mechanic that would make them possible has too many failure modes for v1.
- AI / CV detection of walls, sky coverage, or scene quality. The live camera view solves "you're pointed at a wall" by being visible to the operator.
- Weather-based quality prediction. The whole sub-project D, deferred.
- Detecting post-install camera movement. Instruction: if you bump the camera after install, restart this tool.
- Fixing the **"aimed at the wrong compass direction"** failure mode. Explicitly out of scope. Operator's responsibility to point the camera roughly toward the sunset/sunrise direction; this tool only verifies level and up.
- Fixing the Pi's onboard clock skew (Subproject B). Unrelated to this tool — the alignment step doesn't depend on the Pi's clock at all.
- Rewriting F's other screens. Only screen 4 (the AR/placement step) changes shape; the rest stay.

## 4. Current state

Verified from the repo as of 2026-05-17:

- The Pi's firmware (per `pi-webcam-mvp.md`) runs picamera2 + FFmpeg for capture/streaming. No setup-mode web server currently exists for non-captive-portal use, but spec E (`2026-05-15-wifi-onboarding-and-provisioning-design.md`) introduces a `sunset-cam-setup` systemd service that runs a local HTTP server during setup mode. **This spec extends that web app with two new routes (one HTML page, one MJPEG stream).**
- The cloud wizard (`2026-05-16-cloud-wizard-frontend-design.md`) has a 6-screen flow; screen 4 is "AR placement" and assumes phone-side AR. This spec replaces the phone-AR mechanism for screen 4 with a link to a Pi-served page.
- The hardware case is currently an "IP65 weatherproof box w/ clear lid + cable glands" (`pi-webcam-mvp.md` §Hardware). No orientation markings exist on it today. This spec adds a molded ↑ arrow to the housing.
- The Pi has no gyroscope, magnetometer, GPS, or accelerometer in the BOM. No software workaround changes that.

## 5. Design

### 5.1 Architecture

```
┌─────────────┐  WiFi (Pi's local AP or joined home WiFi)  ┌──────────────┐
│ Pi Zero 2 W │ ◀──────────────────────────────────────── │ Operator's   │
│             │                                            │ phone        │
│  picamera2 ─┼──► MJPEG stream                            │              │
│             │     /setup/preview.mjpg                    │  Browser     │
│  setup web ─┼──► alignment page                          │   <img       │
│  app        │     /setup/align                           │    src=…/…   │
│             │     (returns HTML + static overlay SVG)    │    .mjpg>    │
└─────────────┘                                            └──────────────┘
```

- The Pi's existing `sunset-cam-setup` service (introduced in spec E) gains two new endpoints:
  - `GET /setup/preview.mjpg` — returns the multipart MJPEG stream from `picamera2`.
  - `GET /setup/align` — returns the alignment HTML page with the overlay rendered as inline SVG over an `<img>` pointing at the MJPEG stream.
- The cloud wizard (F) provides the URL of `/setup/align` on the Pi's local IP to the operator. Operator opens it in a new browser tab, performs the alignment, closes the tab, returns to F, advances.
- All overlay rendering is static (server-rendered SVG inlined into the page). No JS interactivity required for v1. No tap handlers, no recalculation, no state.

### 5.2 The alignment page

`GET /setup/align` returns the following minimal page (sketched, not literal HTML):

```
<!doctype html>
<title>Align your camera</title>
<style>
  body { background: #000; color: #fff; font: 14px system-ui; margin: 0; }
  .preview-wrap { position: relative; max-width: 100vw; aspect-ratio: 16/9; margin: 0 auto; }
  .preview-wrap img { width: 100%; display: block; }
  .overlay { position: absolute; inset: 0; pointer-events: none; }
  .instructions { padding: 16px; text-align: center; }
</style>
<div class="preview-wrap">
  <img src="/setup/preview.mjpg" alt="camera preview" />
  <svg class="overlay" viewBox="0 0 1600 900" preserveAspectRatio="none">
    <!-- horizon line at vertical center -->
    <line x1="0" y1="450" x2="1600" y2="450"
          stroke="#ffcc66" stroke-width="2" stroke-dasharray="12 6" opacity="0.85" />
    <!-- up arrow + label, top center -->
    <text x="800" y="40" fill="#ffcc66" font-size="32" text-anchor="middle">↑ UP</text>
  </svg>
</div>
<div class="instructions">
  <p>Rotate the camera housing until:</p>
  <p>1. The real horizon lines up with the dashed line.</p>
  <p>2. The ↑ on screen points the same direction as the ↑ molded on the housing.</p>
  <p>When both match, mount the camera in place. Then close this tab and return to setup.</p>
</div>
```

Two overlay elements, both static:
- A horizontal dashed line at the vertical center of the preview frame
- A label `↑ UP` at the top center, matching the molded marker on the housing

The page contains no JavaScript. No state. If the operator reloads, they get the same page. If the operator navigates back to the cloud wizard, the wizard advances on a button click — no Pi-side handoff needed.

### 5.3 Hardware: molded UP arrow

The housing's STL (or injection-mold tooling, if/when the project moves past 3D printing) gains a single molded ↑ arrow on the face above the lens. Specifics:
- Placement: top-center of the front face, ≥3mm above the lens cutout, ≥3mm from the top edge of the case
- Form: relief or recess, 8–12mm tall, depth/height ≥0.4mm to remain visible after weathering
- Material: same as the housing — no painted/printed labels (those weather poorly)
- A flat ▲ triangle or stylized ↑ are both acceptable; one design, picked once, applied to every unit thereafter
- The arrow must remain visible when the case is mounted with any reasonable tape/screw fixture — so don't put it where the mounting bracket covers it

A separate hardware spec (`docs/specs/hardware/...`, not part of this software project) tracks the STL update. This software spec assumes the marker exists from the operator's perspective; if it doesn't yet, the install instructions can substitute "the side with the lens visible at the bottom and the cable port at the bottom" with the same effect.

### 5.4 F integration

F's screen 4 (the former "AR placement" step) becomes:

```
+---------------------------------------+
|  Align your camera                    |
|                                       |
|  Open the alignment tool to level     |
|  your camera using its live preview:  |
|                                       |
|  [ Open alignment tool ]              |
|  (opens http://<pi-local-ip>:8080/    |
|   setup/align in a new tab)           |
|                                       |
|  When you're done, come back here     |
|  and click Continue.                  |
|                                       |
|  [ Continue ]                         |
+---------------------------------------+
```

The Pi's local IP is discovered the same way F's other screens reach the Pi — via spec E's setup-status polling, which already returns the Pi's local network info to the wizard. The wizard renders the `Open alignment tool` button as an anchor with `target="_blank"`.

Continuing on F's screen 4 advances to screen 5 (horizon sweep) with no state from this tool — the alignment tool is a one-way side trip and has no protocol payload.

## 6. Field provenance

This tool produces **no new protocol fields**. The orientation/roll-capture concern that the umbrella spec assigned to sub-project C is solved here by hardware + human verification, not by a new sensor reading. The protocol's existing `placement.azimuth_deg` and `placement.tilt_deg` (from F's screen 6 "Mount Here") are unchanged.

Notably absent: `placement.roll_deg`. The umbrella spec listed this as a Sub-project C deliverable. We don't capture it — the alignment step verifies roll=0 by visual inspection, and storing the visually-verified value adds no value to the cloud (no consumer reads it).

## 7. Testing

### 7.1 Unit

- `GET /setup/align` returns 200 with the expected HTML structure (horizon line at midpoint, UP label at top, image src pointing at `/setup/preview.mjpg`).
- `GET /setup/preview.mjpg` returns `Content-Type: multipart/x-mixed-replace; boundary=...` and a steady stream of JPEG frames from picamera2.
- The setup web app's existing tests (from spec E) need a new case: while in setup mode, `/setup/align` is reachable; while NOT in setup mode, it returns 404 or redirects.

### 7.2 Manual

- Open `/setup/align` from a phone connected to the Pi's local network. Confirm the live preview is visible, the horizon line is at vertical center, the ↑ UP label is at top.
- Rotate the Pi housing physically through all 4 cardinal orientations (upright, 90° left, 180°, 90° right). Confirm the preview rotates correspondingly in the browser, and that levelling at "upright" produces a horizontal real-world horizon visible in the preview.
- With the housing mounted upright and level, confirm the molded ↑ arrow on the housing aligns visually with the ↑ on screen.

## 8. Risks

- **MJPEG latency on Pi Zero 2 W.** Targeting a 4–8 fps preview at 640×480 to stay under 5 Mbps; acceptable for static alignment but not for any future real-time interactive overlay. If latency feels noticeably bad in field testing, the preview resolution drops first before any architectural change.
- **Phone-screen rendering of overlay at edge zoom levels.** The static SVG should remain visible at thumb-zoom; the design uses thick strokes and large text to mitigate.
- **Operator misreads "up."** Belt-and-suspenders: the live preview shows the real world (so the operator can see if it's upside-down), the molded arrow is permanent reference, and the on-screen `↑ UP` label is visible above the preview. Three independent signals.
- **The known gap: this does not catch "aimed at the wrong compass direction."** Explicitly accepted limitation. A future spec can revisit if the failure pattern becomes common.

## 9. Implementation slice order

1. Add the `/setup/align` route to the setup web app (one HTML response, inline SVG, no JS).
2. Add the `/setup/preview.mjpg` route. The picamera2 capture loop is already running for the normal capture-streaming path; this is a second consumer subscribing to the same frames. (Engineer should confirm whether picamera2 supports concurrent encoders; if not, the setup mode runs a dedicated low-fps preview.)
3. Update F's screen 4 (in the cloud wizard frontend) to a link-to-Pi-IP button instead of the prior AR placeholder.
4. Update the hardware STL with the molded ↑ arrow (separate hardware spec, but file the issue and link from the install instructions).
5. Manual install test with a real Pi at the test location.

## 10. Open questions

- Does picamera2 support concurrent encoders (one for the production MJPEG capture loop, one for the setup-preview stream), or do they need to serialize? Resolves at implementation time.
- Should the alignment page include a "freeze frame / unfreeze" button so the operator can pause the stream to align without their motion shaking the preview? Probably not — they need it live to see the result of their physical rotation. Defer until field testing surfaces a need.
- After mount, should the cloud wizard show a confirmation thumbnail captured from the Pi as proof of alignment? Pulled into sub-project G (first-image verification), out of scope here.
