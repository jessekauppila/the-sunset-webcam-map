# Pi-Side Alignment Tool

Status: Draft v0.2 — 2026-05-17 (revised to add MPU6050 + facing selector)
Owner: Jesse Kauppila
Sub-project C of the streamlined-deployment umbrella (`2026-05-15-streamlined-deployment-overview.md`).

---

## 1. Problem

A non-technical recipient mounting a Pi camera at home needs to know three things during install:

1. **Is the camera level?** A mounted-sideways camera produces a tilted horizon, which all downstream consumers (the AI ranker, the mosaic display, human viewers) implicitly assume is horizontal. There is no automatic recovery — a sideways image stays sideways.
2. **Which way is up on the device?** The housing is symmetric enough that an operator without guidance can mount it 90° or 180° from the intended orientation. The lens is offset on the front face; "up" has to be communicated.
3. **Is the camera pointed at where the sun actually sets or rises over the year?** An operator can mount the camera perfectly level but aimed at a wall, or at a compass direction the sun never visits. The 2026-05-16 field test of the Tier 0 Bellingham unit demonstrated this exact failure mode — the captured images were technically valid (level, well-exposed) but framed away from the sun's actual path.

Today, none of these are solved. The cloud wizard's sub-project F stub (`2026-05-16-cloud-wizard-frontend-design.md`) assumes phone-side AR will guide the operator, but the Pi Zero 2 W ships with no inertial sensors and phone compasses are unreliable. Spec v0.1 punted #3 entirely; v0.2 adds a low-cost MPU6050 6-axis IMU to the device BOM ($2–8/unit) and an operator-selected facing direction, which together get us most of the way to #3 without requiring a magnetometer.

## 2. Goals

1. The recipient can level their camera within ±2° of horizontal using a live roll readout from the MPU6050. Tighter precision than v0.1's "eyeball the horizon line" approach.
2. The recipient cannot accidentally mount the housing upside down or sideways — three independent signals confirm orientation: the Sharpie-drawn (later molded) ↑ on the housing, the on-screen ↑ UP label, and the live roll/pitch readout from the IMU.
3. The operator can aim the camera within the **year-round sun-azimuth wedge** during install, approximately. v1 supports this via operator-selected facing direction (east/west) + lat/lng + computed solstice azimuth markers drawn on the preview. True compass-based azimuth (requiring a magnetometer or sun-tap calibration) is a future spec.
4. The tool runs entirely on the Pi, served to the phone over local WiFi (already established by sub-project E's captive-portal flow). No cloud round-trip for the alignment step itself.

## 3. Non-goals

- **True compass / absolute azimuth measurement.** Requires a magnetometer (MPU9250 or similar) which is not in the BOM. v1 approximates via operator-selected east/west facing. Sun-tap calibration with the gyro is the planned future path.
- **Sun-tap calibration mechanic itself.** Considered for v1, deferred — the calibration UX adds complexity that the simpler approximation doesn't need yet.
- **AI / CV detection of walls, sky coverage, or scene quality.** The live camera view solves "you're pointed at a wall" by being visible to the operator.
- **Weather-based quality prediction.** Sub-project D, deferred.
- **Detecting post-install camera movement.** The accelerometer could detect this; out of scope for the install flow. Instruction: if you bump the camera, restart this tool.
- **Fixing the Pi's onboard clock skew (Subproject B).** Unrelated — this tool doesn't depend on the Pi's clock at all.
- **Rewriting F's other screens.** Only screen 4 (the AR/placement step) changes shape; the rest stay.

## 4. Current state

Verified from the repo as of 2026-05-17:

- The Pi's firmware (per `pi-webcam-mvp.md`) runs picamera2 + FFmpeg for capture/streaming. No setup-mode web server currently exists for non-captive-portal use, but spec E (`2026-05-15-wifi-onboarding-and-provisioning-design.md`) introduces a `sunset-cam-setup` systemd service that runs a local HTTP server during setup mode. **This spec extends that web app with three new routes (one HTML page, one MJPEG stream, one JSON readings endpoint).**
- The Pi BOM today does not include any sensors. **This spec adds an MPU6050 / GY-521 module** ($3–8 single, ~$2 bulk) wired via I2C. ESP32-S3 equivalent works identically with different GPIO pins.
- The cloud wizard (`2026-05-16-cloud-wizard-frontend-design.md`) has a 6-screen flow; screen 4 is "AR placement" and assumes phone-side AR. This spec replaces the phone-AR mechanism for screen 4 with a link to a Pi-served page.
- The hardware case has no orientation marking today. v1 acceptable solution: Sharpie ↑ on the case during operator prep. A future hardware spec covers molded/etched markers.

## 5. Design

### 5.1 Architecture

```
┌─────────────────┐  WiFi (Pi's local AP or joined home WiFi)  ┌──────────────┐
│ Pi Zero 2 W     │ ◀──────────────────────────────────────── │ Operator's   │
│                 │                                            │ phone        │
│  picamera2 ─────┼──► MJPEG stream  /setup/preview.mjpg       │              │
│  MPU6050 (I2C) ─┼──► readings      /setup/orientation.json   │  Browser     │
│  setup web app ─┼──► align page    /setup/align              │  fetch loop  │
│                 │     (HTML + JS that fetches readings ~5 Hz)│  + live <img>│
└─────────────────┘                                            └──────────────┘
```

- Pi's existing `sunset-cam-setup` service (from spec E) gains three new endpoints:
  - `GET /setup/preview.mjpg` — multipart MJPEG stream from picamera2.
  - `GET /setup/align` — the alignment HTML page (with embedded JS to poll for live readings).
  - `GET /setup/orientation.json` — latest accelerometer-derived roll + pitch as JSON: `{"roll_deg": -0.4, "pitch_deg": 1.2, "sampled_at": "..."}`.
- The Pi reads the MPU6050 at ~10 Hz in a background thread, exponentially smooths the readings, exposes the latest via the JSON endpoint.
- The alignment page polls the JSON endpoint at ~5 Hz via `fetch()` and updates the on-screen roll readout. East/west facing selector is a client-side toggle; solstice marker computation is client-side using `suncalc` (or equivalent astronomical formula) given lat/lng + the selected facing.
- Operator's lat/lng is embedded in the served HTML page as a JS constant (the Pi knows it from the pre-register flow per spec E).

### 5.2 The alignment page

The page contains:

- **Top HUD**: live roll readout (e.g. "−0.4°"), updated 5 Hz via fetch. Adjacent: pitch readout. Both have a "level" badge that lights up green when |angle| < 1°.
- **Live MJPEG preview** (`<img src="/setup/preview.mjpg">`).
- **Overlay layer (SVG, on top of the preview)**:
  - Dashed horizontal line at the vertical center of the preview frame.
  - `↑ UP` label at top center.
  - Two solstice azimuth markers as dashed vertical lines, positioned client-side based on lat/lng + facing.
  - Shaded wedge between the solstice markers labeled "where the sun ever is."
- **Facing selector**: a 3-state toggle (East / West / Both) below the preview. Default value is suggested by the operator's earlier phase preference from F (sunrise → East, sunset → West, both → Both).
- **Bottom counter**: "N sunsets/year fall in this azimuth wedge" — astronomy only, recomputed client-side when the facing selector changes.
- **Instructions** (below the preview):
  > Rotate the camera housing until:
  > 1. The roll readout reads close to 0° and the "level" badge is green.
  > 2. The ↑ on screen points the same direction as the ↑ on the housing.
  > 3. The shaded wedge (where the sun travels) falls inside the visible preview — if it doesn't, swivel the camera left or right until it does.
  >
  > When all three match, mount the camera in place. Then close this tab and return to setup.

### 5.3 Hardware

#### 5.3.1 UP marker on the housing

**v1 (now)**: Sharpie ↑ arrow on the case, drawn by hand during operator prep. No tooling, no STL update; accepts that the marker will fade over time.

**Future hardware spec**: Molded/etched ↑ on the housing STL. Tracked in `docs/hardware/...` per the existing stub. Not blocking C.

#### 5.3.2 MPU6050 / GY-521 IMU (NEW v1 BOM addition)

- **Part**: MPU6050 6-axis IMU (3-axis gyro + 3-axis accelerometer) on a GY-521 breakout. Ships under several brand names; all are the same chip.
- **Cost**: $3–8 per single unit on Amazon; ~$8–15 for multi-packs of 3–6; effectively under $2/unit in bulk.
- **Bus**: I2C, default address `0x68`.
- **Pi Zero 2 W wiring**: VCC → 3.3V (pin 1), GND → GND (pin 9), SDA → GPIO 2 (pin 3), SCL → GPIO 3 (pin 5). I2C must be enabled in `raspi-config`.
- **ESP32 wiring**: VCC → 3.3V, GND → GND, SDA → GPIO 21, SCL → GPIO 22. Same chip; portable across hardware targets.
- **Soldering**: Pi Zero 2 W without the "WH" suffix has no pre-soldered headers. Requires either soldering or a hammer-header kit.
- **Driver**: `smbus2` on Pi (stdlib-adjacent Python). `Adafruit_MPU6050` or `MPU6050_light` on ESP32/ESP8266.
- **Power**: ~3.6 mA active; negligible.

Only the accelerometer is used for v1 (roll + pitch from the gravity vector). The gyro lives in the BOM for a future sun-tap calibration spec.

### 5.4 Reading orientation

Roll and pitch derived from the accelerometer's gravity vector:

```
roll_rad  = atan2(accel_y, sqrt(accel_x² + accel_z²))
pitch_rad = atan2(-accel_x, sqrt(accel_y² + accel_z²))
```

Convert to degrees. **Yaw (compass direction) is not derivable from accelerometer alone** — requires a magnetometer, which we don't have. Out of scope, explicitly.

Implementation:
- Background thread samples at 10 Hz.
- Exponentially smoothed: `smoothed = α × raw + (1−α) × prev`, α = 0.3.
- Latest smoothed values cached in a single `(roll_deg, pitch_deg, sampled_at)` tuple, lock-free since reads are atomic at this size.
- `/setup/orientation.json` returns the cached tuple.

### 5.5 Facing selector + approximate solstice math

The operator's facing direction (East / West / Both) supplies the assumed center azimuth of the camera's view: 90°, 270°, or both. Without a magnetometer the Pi cannot verify this; the operator's selection is taken on trust and caught downstream by sub-project G (first-image verification).

Client-side JS:

```javascript
// On page load, given lat/lng (from server) + selected facing:
const jun_sunset_az = computeSunsetAzimuth(lat, lng, jun21);
const dec_sunset_az = computeSunsetAzimuth(lat, lng, dec21);

// Map azimuth → horizontal pixel on the preview
function azToPixel(az_deg, center_az, fov_deg, screen_width) {
  const offset = ((az_deg - center_az + 540) % 360) - 180; // signed delta in [-180,180]
  return screen_width * (0.5 + offset / fov_deg);
}
```

`fov_deg` = 102° for the Camera Module 3 Wide (existing BOM). Markers drawn at the computed pixel positions; shaded wedge between them; counter computed as `count(days where sunset_azimuth(day) is within camera_fov_centered_on selected_facing)`.

The simplification: this assumes the operator aims roughly at due-east or due-west, off by a few tens of degrees at most. If the operator aims at, say, NNW (315°) and selects "West (270°)," the markers will be drawn off-center — operator's responsibility to swivel until the wedge is inside the visible preview. The system can't tell them they're wrong; it can only tell them where they SHOULD be looking if the assumption holds.

### 5.6 F integration

Same as v0.1 — F's screen 4 becomes a link "Open the alignment tool" pointing to `http://<pi-local-ip>:<setup-port>/setup/align`, opened in a new tab. Operator does the alignment, returns, clicks Continue to advance.

The facing direction selected on the alignment page is **not** submitted to F or the protocol — it's a local computation only, used for drawing the markers. The actual `placement.azimuth_deg` submitted by F's screen 6 ("Mount Here") remains the canonical record.

## 6. Field provenance

No new protocol fields. The operator's facing selection is local to the alignment tool. Roll/pitch from the IMU is local too (not sent to the cloud). The cloud sees only the final `placement.azimuth_deg / tilt_deg` from F's screen 6, unchanged.

Future v2 of the protocol may add `placement.roll_deg` (now measurable!) and `placement.calibrated_azimuth_deg` (from sun-tap calibration) — out of scope here.

## 7. Testing

### 7.1 Unit

- `read_orientation(i2c_bus)` returns the expected (roll, pitch) for known accelerometer readings (gravity along each axis). Cover: flat, on its side both ways, upside down.
- `compute_solstice_markers(lat, lng, facing, fov)` returns the expected pixel offsets for known coordinates (Bellingham 48.75°N: Jun sunset ~295°, Dec sunset ~248°).
- `count_sunsets_in_fov(lat, lng, facing, fov)` returns 100–365 days/year for mid-latitudes; 365 for equator.
- `GET /setup/align` returns HTML containing the polling script and the embedded lat/lng.
- `GET /setup/orientation.json` returns the latest cached reading; mocked I2C inputs verify smoothing math.

### 7.2 Manual (gated on MPU6050 acquisition + soldering)

- Wire an MPU6050 to a test Pi. Run the orientation read loop; rotate the Pi by hand and observe live readings change.
- Open `/setup/align` from a phone connected to the Pi's local network. Confirm the roll readout updates in real time as the Pi is rotated.
- Toggle East/West/Both; confirm solstice markers and the sunsets-per-year counter update.
- Install the camera in field at a known good location; confirm the live preview, roll readout, and markers are all usable together.

## 8. Risks

- **MPU6050 sourcing + soldering blocks first field test.** Operator must acquire units and install them before any field validation. Accepted as a one-time setup cost.
- **Operator misreports facing direction.** Solstice markers drawn wrong. Mitigation: G (first-image verification) catches it; operator can also see the wedge "looks wrong" on the live preview if their actual aim differs from what they reported.
- **MPU6050 calibration drift / DC bias.** Cheap parts have ±2° accelerometer accuracy out of the box. Mitigation: the level badge tolerates ±1° "good enough"; precision-critical scenarios out of v1 scope.
- **I2C contention with other peripherals.** None expected — picamera2 uses CSI bus, MPU6050 uses I2C; independent.
- **MJPEG latency on Pi Zero 2 W** — same as v0.1, mitigated by low fps (~4–8 fps target).
- **No magnetometer = no true compass.** Operator self-report is the v1 workaround. Future specs (sun-tap calibration, 9-axis upgrade) are paths to fix this if it becomes a real problem.
- **"Looking at the wedge wrong" failure mode** (operator says West, mounts NW). The shaded wedge will be off-center on the preview. Operator can self-correct by panning until the wedge looks centered — but the system can't enforce it.

## 9. Implementation slice order

1. Add MPU6050 driver module + unit tests (mocked I2C inputs).
2. Add `/setup/orientation.json` endpoint + background sampler thread.
3. Extend `setup_alignment.py`'s HTML to include the polling JS + readout.
4. Add the facing selector + client-side solstice math.
5. Add the sunsets-per-year counter (suncalc-based).
6. Wire all into the spec E setup web app once that lands.
7. Field test with real MPU6050 hardware + real install location.

## 10. Open questions / future directions

- **Sun-Seeker-style placement app**: a separate phone-side scouting app inspired by [Sun Seeker](https://profilmmakerapps.com/app/sun-seeker/). The operator attaches the Pi case to their phone (magnetic mount, strap, or a printed cradle), then walks around the install location with the phone running an AR view that uses the phone's full sensor suite — including a real compass — to predict where the sun will travel relative to the Pi's eventual mounted position. No Pi changes needed; pure phone-side software. Worth a separate spec.
- **Sun-tap calibration with the MPU6050 gyro**: with the IMU in place, a future spec adds a one-time tap-the-sun calibration. Operator taps the sun on the preview during install; the Pi computes the sun's true azimuth at that timestamp + lat/lng; the gyro integrates rotation rates to track subsequent azimuth changes. Effective compass without a magnetometer. Deferred from v0.1 because the UX was complex; revisit when the simpler v0.2 approach proves insufficient.
- **9-axis upgrade** (MPU9250 or MPU6050 + QMC5883L magnetometer): if operator-self-report turns out to be unreliable in the field, an upgrade to a magnetometer-equipped IMU gives true compass. Adds $3–5 per unit. Defer until v0.2 ships and we have field data.
- **Confirmation thumbnail in the cloud wizard**: after mounting, sub-project G's first-image-verification step shows the operator the actual first captured frame from their Pi. If the sun-wedge isn't visible in it, they know they aimed wrong and can recalibrate. Out of scope here; lives in G.
- **Concurrent MJPEG encoders on Pi Zero 2 W** (legacy open question from v0.1): in setup mode the production capture loop is idle, so the setup web app has exclusive picamera2 access. Sidesteps the contention question.

---

## Diff from v0.1

If you read v0.1 and want to know what changed:

- **§1 Problem**: added a 3rd item (compass-aim failure) motivated by the 2026-05-16 field observation.
- **§2 Goals**: added goal 3 (year-round sun-azimuth wedge alignment) + tighter level precision via real sensor.
- **§3 Non-goals**: removed "no sensor-based directional guidance" — we now have an IMU. Added "no magnetometer" + "no sun-tap calibration" to make the new boundary explicit.
- **§5 Design**: §5.2 grew (polling JS, facing selector, counter); §5.3 split into UP-marker subsection (now: Sharpie OK) + MPU6050 BOM addition; §5.4 new (sensor read math); §5.5 new (facing-selector + solstice math); §5.6 unchanged.
- **§7 Risks**: added MPU6050 sourcing risk, facing-misreport risk, sensor accuracy risk.
- **§10 Open questions**: added Sun-Seeker app pattern, sun-tap calibration as future spec, 9-axis upgrade path.
