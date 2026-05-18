# Pi-Side Alignment Tool v0.3 — Sun Self-Calibration + Manual Focus

Status: Draft v0.3 — 2026-05-17 (incremental redesign on top of v0.2)
Owner: Jesse Kauppila
Sub-project C, third iteration. Builds on `2026-05-17-pi-side-alignment-tool-design.md` (v0.2).

---

## 1. Problem

v0.2 left two real gaps:

1. **No true compass.** v0.2 has the operator pick a facing direction (East / West / Both) and trusts that selection. A misreport silently produces wrong solstice markers and a wrong sunsets-per-year counter. The system can't verify.
2. **No defensive focus check.** Even though the production camera (Arducam IMX708 Wide *Autofocus*, 120° HFOV) is software-controlled — firmware locks it to infinity at boot — there's no runtime check that the lens is actually capturing a sharp image. A unit could ship with a lens cap left on, mounted facing a wall, or with a software regression in the focus-locking step, and the first detection would be a server-side reviewer noticing all the images are blurry.

A third concern made v0.2 fragile: it depended on the operator entering a phase preference (sunrise/sunset/both) and trusting that selection, with no way to recover if they got it wrong.

v0.3 solves both by **letting the device figure out where it's pointed by watching the sun**. The MPU-6050 from v0.2 gives roll + pitch; sun observations across one or more sunset windows give the missing azimuth via OpenCV's `solvePnP`. Setup completes "eventually" rather than instantly — the user is told this up front. For focus, a one-time **passive verification** at install time (and at every capture) ensures the image is actually sharp; the operator never touches a lens ring.

This design is the consensus output of a separate brainstorm; this spec formalizes it for implementation.

## 2. Goals

1. **Camera self-calibrates its true compass azimuth** from sun observations, without a magnetometer, GPS module, or operator-supplied facing direction. Single-axis accuracy of ±2° within 1–7 days of clear sunsets at install location.
2. **Focus is verified passively**: at install time the alignment page reports "focus OK / focus failed" based on an edge-contrast metric on a live frame. The operator never adjusts focus; if the check fails the UI tells them to remove the lens cap / check the aim. The same metric also runs at every capture as a soft sanity flag attached to uploads.
3. **The system tells the operator honestly** when calibration is incomplete ("calibrating… 0 of 10 observations") rather than silently producing wrong markers. The operator can mount the camera and leave; calibration finishes itself on the first clear sunset.
4. **Drift detection**: the system continuously checks observed sun position against stored calibration. If the camera gets bumped or the operator re-aims it, the system notices and re-calibrates without human intervention.
5. **MPU-6050 + roll/pitch readout from v0.2 stays.** The alignment page still does the level-check job; sun calibration adds to it, doesn't replace it.
6. **The camera-source code path is abstracted** so the underlying camera (Arducam IMX708 Wide AF today, Pi Foundation Camera Module 3 Wide as fallback) can swap without cascading through the codebase. Both have the same Sony IMX708 sensor; the abstraction is mostly about handling the Arducam-specific `dtoverlay` and the AF-disable-then-lock-to-infinity init step.

## 3. Non-goals

- **ESP32 support.** OpenCV doesn't run on ESP32; the sun-solve pipeline is Pi-only. ESP32 builds, if ever wanted, will keep the v0.2-style operator-selected facing approach. Documented and accepted.
- **Magnetometer / 9-axis IMU.** Not in the BOM. Sun-derived azimuth replaces it.
- **GPS module.** Not in the BOM. Operator-supplied lat/lng is plenty accurate (1 km of position error → <0.01° of sun azimuth error).
- **On-device deep learning for any part of this.** Sun detection is brightest-region centroid (~30 lines). Quality scoring is server-side (separate concern, not in this spec).
- **Runtime autofocus.** Camera supports autofocus but firmware **locks** the lens to infinity at boot (`AfMode=Manual`, `LensPosition=0.0`). The AF system is never re-enabled during normal operation — the alternative is the AF motor hunting on bright skies during a sunset capture and producing soft frames at random.
- **Operator focus adjustment during install.** The autofocus camera makes this unnecessary. The alignment page does not include a focus slider, sharpness peak-finding UI, or any operator-facing focus control. The single sharpness signal that exists is a binary "focus OK / focus failed" verification.
- **Sun-tap calibration** (the manual-tap mechanic considered in v0.1). Superseded by full auto-detection.
- **Fixing the Pi's clock drift.** Subproject B's concern. This spec **depends on** B being fixed before v0.3 ships in the field — see §9.
- **Streaming live during the sunset window.** Reserved future work; doesn't interact with alignment.

## 4. Current state

Verified from the repo as of 2026-05-17:

- **v0.2 firmware** (`feat/setup-alignment-mpu6050` merged into `sunset-cam-firmware` `main` via PR #2): four modules — `gyro_driver.py`, `orientation_sampler.py`, `solstice_math.py`, `setup_alignment.py`. 48/48 unit tests passing. Framework-agnostic; not yet wired into a setup web app.
- **v0.2 spec** (`docs/superpowers/specs/2026-05-17-pi-side-alignment-tool-design.md`): describes the MPU-6050 + facing-selector design. v0.3 keeps the IMU and the alignment page, replaces the facing selector + manual solstice markers with sun-calibration outputs.
- **No setup web app exists yet** (spec E firmware-side hasn't been implemented). v0.3's new endpoints land in the same Python modules and are registered alongside v0.2's when E lands.
- **The chosen camera is now Arducam IMX708 Wide *Autofocus* (120° HFOV)** at $35 retail, replacing the previously-considered manual-focus part. Same Sony IMX708 sensor as the Pi Foundation Camera Module 3 Wide (which is the supply fallback). Includes ABS case, 15-22 pin ribbon, 22-22 pin ribbon. The autofocus is software-controlled; firmware locks it to infinity at init.
- **Arducam-specific Pi config**: the module requires `dtoverlay=imx708` in `/boot/firmware/config.txt` plus `camera_auto_detect=0`. One-time provisioning step per device, baked into the SD-card image.
- **Pi OS Bookworm or later** required (kernel 6.1.x+). Older Bullseye images are unsupported by the Arducam driver.
- **Subproject B (clock drift)** remains in its stubbed state. v0.3 has a hard dependency on it.

## 5. Design

### 5.1 Architecture

```
┌────────────────────────────────────────────────────────┐
│ Pi Zero 2 W (or Pi 5)                                  │
│                                                        │
│  CameraSource (abstraction) ──► picamera2 ──► IMX708   │
│                          ▲                             │
│                          │                             │
│  ┌───────────────────────┴─────────────────────────┐   │
│  │ Capture loop (existing v0.1 firmware)            │   │
│  │   - Sunset-window capture                        │   │
│  │   - Best-so-far heuristic scoring                │   │
│  │   - Server upload                                │   │
│  └─────────────┬────────────────────────────────────┘   │
│                │                                        │
│                ▼                                        │
│  Sun-calibration pipeline (NEW):                       │
│    detect_sun(frame) → (px, py, t_utc)                 │
│    compute_sun_world(lat, lng, t_utc) → (az, alt)      │
│    accumulate observations in calibration store        │
│    solve_pose(observations, intrinsics) → (azimuth, …) │
│    write calibration → /etc/sunset-cam/calibration.json│
│                                                        │
│  MPU-6050 (existing v0.2) ──► gravity vector           │
│                              ──► roll/pitch (live)     │
│                              ──► roll/pitch (constraint│
│                                   for pose solver)     │
│                                                        │
│  Setup web app (NEW endpoints):                        │
│    GET /setup/sharpness.json   (NEW v0.3)              │
│    GET /setup/calibration.json (NEW v0.3)              │
│    GET /setup/align            (UPDATED — drops facing)│
│    GET /setup/orientation.json (UNCHANGED from v0.2)   │
│    GET /setup/preview.mjpg     (UNCHANGED from v0.2)   │
└────────────────────────────────────────────────────────┘
```

Two pipelines run on the Pi independently of the user being present:
- **Focus verification** (one-shot during setup mode, plus a flag attached to every capture): grabs a 320×240 center crop from a current frame, computes a variance-of-Laplacian score, returns "OK" if the score exceeds a per-SKU threshold. Exposed via `/setup/focus.json` (returns `{"focus_ok": true|false, "score": <float>, "threshold": <float>}`). There is **no live polling UI** — the operator either passes the check or doesn't.
- **Sun-calibration sampler** (lives in normal operation mode): during the sunset capture window, picks frames where the sun is detectable, accumulates `(pixel_x, pixel_y, timestamp_utc, sun_az, sun_alt)` tuples in `/var/lib/sunset-cam/observations.jsonl`. After N=10 observations (or one full sunset window), runs `solvePnP` and writes the resulting `(azimuth_deg, tilt_deg, roll_deg, confidence)` to `/etc/sunset-cam/calibration.json`.

### 5.2 Camera-source abstraction

The chosen production camera is the **Arducam IMX708 Wide AF**; supply fallback is the **Pi Foundation Camera Module 3 Wide** (same sensor, slightly different driver registration path). The firmware must not couple to a specific camera SKU. Introduce a thin interface:

```python
# src/sunset_cam/camera_source.py
from typing import Protocol
import numpy as np
from libcamera import controls
from picamera2 import Picamera2


class CameraSource(Protocol):
    def capture(self) -> np.ndarray:
        """Return the latest captured frame as an RGB uint8 array."""
        ...

    def capture_jpeg(self) -> bytes:
        """Return the latest captured frame encoded as JPEG bytes."""
        ...

    def configure(self, *, resolution: tuple[int, int]) -> None:
        ...


class PiCameraSource:
    """picamera2-based implementation. Disables autofocus and locks the
    lens to infinity at startup. Same code path works for the Arducam
    IMX708 AF and the Pi Foundation Camera Module 3 Wide AF — both have
    the IMX708 sensor and respond to the same `AfMode`/`LensPosition`
    controls. The SKU difference is purely in /boot/firmware/config.txt
    (dtoverlay=imx708 for the Arducam) which is set during SD provisioning,
    not in this code."""

    def __init__(self) -> None:
        self._picam = Picamera2()
        cfg = self._picam.create_still_configuration()
        self._picam.configure(cfg)
        # Lock focus at infinity BEFORE starting. AF would otherwise hunt
        # on bright skies during the sunset capture window.
        self._picam.set_controls({
            "AfMode": controls.AfModeEnum.Manual,
            "LensPosition": 0.0,  # 0.0 = infinity; higher = closer
        })
        self._picam.start()
```

The existing `capture.py` module from v0.1 wraps a Picamera2 directly and is the right candidate to refactor into the `PiCameraSource` class. Call sites elsewhere in the codebase migrate to import from `camera_source` instead of `capture`.

If the autofocus lock-to-infinity step ever fails (e.g., a libcamera version regression), the existing `capture.py` callers will still get frames — they'll just be out of focus. The focus-verification pipeline (§5.3) catches this case and surfaces it as a setup error rather than letting a misfocused unit silently ship to the field.

### 5.3 Focus verification (passive)

A small helper computes the variance-of-Laplacian on a grayscale center crop and compares it to a per-SKU threshold:

```python
def sharpness_score(frame_rgb: np.ndarray, crop_fraction: float = 0.5) -> float:
    """Higher = sharper. Dimensionless; compare to per-SKU threshold."""
    h, w, _ = frame_rgb.shape
    ch, cw = int(h * crop_fraction), int(w * crop_fraction)
    y0, x0 = (h - ch) // 2, (w - cw) // 2
    crop = frame_rgb[y0:y0 + ch, x0:x0 + cw]
    gray = cv2.cvtColor(crop, cv2.COLOR_RGB2GRAY)
    return float(cv2.Laplacian(gray, cv2.CV_64F).var())


def focus_ok(frame_rgb: np.ndarray, threshold: float) -> bool:
    return sharpness_score(frame_rgb) >= threshold
```

The per-SKU threshold is established empirically on the bench during lens calibration (§5.10) and shipped with the firmware in `lens_intrinsics.json`. A representative threshold for the IMX708 Wide AF locked at infinity on a typical outdoor scene is in the low thousands of Laplacian variance; a lens-cap-on frame is near zero, a wall-facing frame is in the tens-to-hundreds, an in-focus sky scene is in the low-to-mid thousands.

The alignment page surfaces this as a **one-shot check**, not a live polling loop:

- On page load, the page calls `/setup/focus.json` once.
- Response is `{"focus_ok": true, "score": 2840.5, "threshold": 1500}` or similar.
- If `focus_ok`: a small green "focus: OK" badge appears in the top HUD.
- If not: a prominent banner appears saying *"Focus check failed. Check that the lens cap is removed and the camera isn't pointed at a wall. Reload this page to re-check."*

The operator never sees the raw score and has no slider to adjust. The reload button is the only recovery path — by then they've usually fixed whatever was blocking the lens.

The same `focus_ok` check also runs at every sunset capture as a soft sanity flag and is attached to the upload payload (the server can downrank or alert on blurry uploads).

### 5.4 Sun detection

A frame from the capture loop is passed to `detect_sun(frame_rgb) -> Optional[tuple[float, float]]`. Returns pixel coordinates of the sun's apparent centroid, or `None` if the sun isn't detectable in the frame.

Algorithm:
1. Convert frame to HSV.
2. Threshold on V (high value) AND low S (sun is desaturated white when overexposed) — produces a binary mask of "candidate sun pixels."
3. Connected-components labeling.
4. Pick the largest component above a minimum-area threshold (say, ≥ 200 px) AND not touching the frame edge (a glare lobe touching the edge isn't the sun).
5. Compute centroid; return.

**Sun saturation gotcha**: at golden hour, the camera will be exposed for the sky overall, so the sun saturates to clipped white. The centroid of the saturated blob is biased toward whichever direction the sensor decided to bloom. Mitigation: during calibration capture, take an additional short-exposure frame (e.g. EV-3 from auto-exposure) specifically for sun detection. The bright-but-not-blown-out sun has a well-defined centroid. This adds one extra frame per minute during the sunset window, negligible CPU.

### 5.5 World-frame sun position

`compute_sun_world(lat_deg, lng_deg, t_utc) -> (azimuth_deg, altitude_deg)`. Uses [`skyfield`](https://rhodesmill.org/skyfield/) for accurate ephemerides:

```python
from skyfield.api import load, wgs84

ts = load.timescale()
eph = load('de421.bsp')  # ~16 MB, shipped with firmware
sun, earth = eph['sun'], eph['earth']


def compute_sun_world(lat, lng, t_utc):
    t = ts.from_datetime(t_utc)
    observer = earth + wgs84.latlon(lat, lng)
    apparent = observer.at(t).observe(sun).apparent()
    alt, az, _ = apparent.altaz()
    return az.degrees, alt.degrees
```

Skyfield is ~5 MB of code + the JPL ephemeris file at ~16 MB. Negligible on the Pi.

### 5.6 Pose solving with `cv2.solvePnP`

Given N observations of the sun at known world positions `(az_i, alt_i)` and pixel positions `(px_i, py_i)`, plus the camera's intrinsics (focal length, principal point, distortion coefficients from lab calibration), solve for the camera's rotation matrix `R` from world frame to camera frame.

The MPU-6050 already gives us the camera's roll and pitch relative to gravity. We use that as a **constraint** on the solver: rather than solving for full 6-DOF pose, fix roll + pitch from the IMU and solve only for **azimuth** (yaw). This makes the problem well-conditioned with as few as 2 observations.

Implementation sketch:

```python
def solve_azimuth(observations, intrinsics, imu_roll_deg, imu_pitch_deg):
    """observations: list of (px, py, sun_az, sun_alt) tuples.
       Returns (azimuth_deg, confidence) where confidence reflects
       both observation count and residual error magnitude."""
    # Build 3D rays from observed pixel coordinates (in camera frame)
    # Build 3D rays from world sun positions (in world frame)
    # Apply the IMU-derived roll/pitch transform to convert world rays
    #   into the camera's gravity-aligned frame
    # Now solve for the single yaw rotation that aligns observed rays
    #   with world rays — minimize least-squares angular residual.
    ...
```

After **N ≥ 2 observations** the solver has a valid answer. After **N ≥ 5 observations spread over ≥ 30 minutes** of sun travel, the residual is informative — small means a confident calibration. Persist `calibration.json` only when both conditions are met.

### 5.7 Calibration storage

```json
{
  "calibrated_at": "2026-05-18T05:35:00Z",
  "azimuth_deg": 271.4,
  "azimuth_confidence_deg": 0.6,
  "imu_roll_deg": -0.2,
  "imu_pitch_deg": 1.4,
  "observation_count": 17,
  "lens_intrinsics_file": "/opt/sunset-cam/intrinsics/imx708-wide-mf.json",
  "camera_source": "PiCameraSource(IMX708-Wide-MF)",
  "schema_version": 1
}
```

Stored at `/etc/sunset-cam/calibration.json`. Written atomically (write to `.tmp`, rename). Loaded at boot; if missing, the device is "uncalibrated" and the sunsets-per-year counter etc. fall back to their v0.2 behavior of operator-selected facing (or just no counter at all).

### 5.8 Drift detection + re-calibration

A rolling window of the last 5 sun observations is compared against the stored calibration:

- For each observation, compute the expected pixel position given the stored calibration + the world sun position. Compare to the actually observed pixel position. Convert pixel-residual to angular residual.
- If the **mean angular residual of the last 5 observations exceeds 5°**, the camera has moved (or the calibration was wrong from the start). Clear `calibration.json` and start accumulating fresh observations.

This handles the "camera got bumped" case automatically. The user sees a "re-calibrating…" state until N observations re-accumulate.

### 5.9 Updates to the v0.2 alignment page

The alignment HTML (`render_align_page` in `setup_alignment.py`) changes:

- **Drops the East/West/Both facing form** entirely.
- **Drops the static server-rendered solstice markers** (since `compute_solstice_markers(lat, lng, facing, fov)` no longer has a known `facing`). Instead, **markers are drawn only after calibration is available**, using the calibrated azimuth as the camera's known center.
- **Drops the sunsets-per-year counter** until calibration is available. After calibration: shows the real counter for the calibrated azimuth.
- **Adds a focus badge** in the top HUD: `focus: OK` (green) or `focus: failed` (red), populated by a single fetch to `/setup/focus.json` on page load. No live polling; reload to re-check.
- **Adds a calibration status block**: `calibrated: 17/10 observations · ±0.6° (last update 3 min ago)` or `calibrating: 0/10 observations · awaiting first clear sunset`.

The level indicator + horizon line + UP arrow all stay unchanged.

### 5.10 Onboarding UX (within F's wizard)

The operator's path:

1. Plug in the device, connect to its WiFi, open the cloud wizard. (Spec E.)
2. Enter lat/lng (browser geolocation or zip code). The device gets these via spec E's pre-register.
3. Open the alignment tool (spec F screen 4 → Pi-served page).
4. **Focus check**: the page reports "focus OK" (green) or "focus failed" (red banner) on load. If failed: remove lens cap / re-aim away from a wall / reload. No manual adjustment.
5. **Level**: rotate the housing until the roll/pitch badge is green.
6. **Aim roughly west** (for sunset units). UI copy explicitly: "Aim where you think the sun sets. We'll fine-tune automatically."
7. Mount the camera, walk away.
8. Over the next 1–7 days of clear sunsets, the device calibrates itself.
9. Once the first calibration is complete, the cloud-side server gets the calibrated azimuth (via heartbeat) and the sunsets-per-year counter populates on the operator's gallery page.

Honest UX: the wizard tells the operator "calibration takes 1–7 sunny sunsets." For Bellingham winter, that can mean 2 weeks. The wizard should also expose a "calibration progress" indicator on the device's own status page so an impatient operator can see what's happening.

This is a real UX win over the previous draft: by switching to the autofocus camera and locking it in software, the operator no longer needs to physically adjust a lens ring. One fewer manual step in install.

### 5.11 F integration

Unchanged from v0.2: F's screen 4 links to `http://<pi-local-ip>:<setup-port>/setup/align`. The Pi-side page renders dynamically based on whether calibration is present or absent. F itself does not need to know about calibration.

## 6. Field provenance

New protocol fields on heartbeat (the device → server message):

| Field | Type | Source |
|---|---|---|
| `calibrated_azimuth_deg` | float, nullable | `/etc/sunset-cam/calibration.json` `azimuth_deg` |
| `calibrated_azimuth_confidence_deg` | float, nullable | `/etc/sunset-cam/calibration.json` `azimuth_confidence_deg` |
| `calibrated_at` | ISO timestamp, nullable | when last solver ran |
| `observation_count` | int | how many sun observations are stored |
| `last_focus_score` | float, nullable | sharpness score from last capture |
| `last_focus_ok` | bool, nullable | whether the last capture passed the threshold |

The cloud uses `calibrated_azimuth_deg` to compute the per-camera sunsets-per-year count for the operator's gallery page. Until calibration arrives, the cloud falls back to operator's `phase_preference` (sunrise/sunset/both) for a rough placeholder. `last_focus_ok = false` on uploads is a soft signal — the cloud could downrank or alert on it, but the upload still happens.

## 7. Testing

### 7.1 Unit (no hardware needed)

- `sharpness_score(frame)` returns 0 for a synthetic uniform-gray frame; higher for a synthetic frame with a sharp edge.
- `detect_sun(frame)` finds a bright disk in a synthetic image at known coordinates; returns `None` for an image with no bright region.
- `compute_sun_world(lat, lng, t_utc)` returns known values for `(48.7519, -122.4787, 2026-05-17T05:00Z UTC)` → cross-check against [NOAA Solar Calculator](https://gml.noaa.gov/grad/solcalc/).
- `solve_azimuth(observations, intrinsics, imu_roll, imu_pitch)` recovers the input azimuth from synthetic observations with known answer. Cover N=2, N=5, N=10 cases.
- Drift detection: feeds observations consistent with stored calibration → no re-cal triggered; feeds observations diverging by >5° → re-cal triggered.

### 7.2 Manual / hardware-gated

- Run the sharpness sampler on a real Pi + IMX708. Verify the score peaks at sharp focus and falls off on either side of the peak.
- Capture real sunset frames. Verify `detect_sun` finds the sun cleanly.
- Accumulate observations across one real sunset; verify `solve_azimuth` produces a sane azimuth.
- Bump the camera 10° after calibration; verify drift detection triggers within 5 observations.

## 8. Risks

- **Hard dependency on Subproject B (clock drift).** A 1-minute clock error → ~0.25° azimuth error. Pi Zero 2 W has no battery-backed RTC; NTP-via-wifi is the only correction. If the firmware ever runs calibration with a stale clock, the result is silently wrong. **Mitigation**: every observation records its capture timestamp and the NTP-sync age at that moment. The solver rejects observations whose NTP sync is >24 hours old. Documented constraint: this spec **cannot ship to field** until B's clock-skew bug is verified fixed.
- **Cloudy stretches block calibration.** Bellingham winter can have 14+ overcast days in a row. UI must communicate this honestly ("waiting for a clear sunset") rather than hanging silently.
- **Lens distortion** of the 120° wide-angle is significant at frame edges. The bench-calibrated intrinsics file is per-SKU; if the operator swaps in a different camera (e.g. PCM3 Wide AF as fallback), the intrinsics file shipped with firmware no longer applies. Firmware boot-time check: detect which camera is attached and load the right intrinsics; refuse to run sun-calibration if no matching intrinsics file exists.
- **Sun saturation** biases the detection centroid. Mitigation: short-exposure frame during calibration capture (§5.4).
- **OpenCV install size on Pi Zero 2 W**: opencv-python ≈ 60 MB. Acceptable for 32 GB SD cards. If size matters later, a stripped opencv-python-headless build saves ~20 MB.
- **Skyfield ephemeris file** (`de421.bsp` ~ 16 MB) needs to be shipped. Trivial.
- **Operator turns the camera mid-calibration** (during the 1–7 day window). Drift detection catches it. UI tells the operator they've reset progress.
- **Sun never visible** (camera mounted facing a wall or 180° wrong). After 7 days of sunset windows with zero observations, alert the operator. Don't silently never calibrate.

## 9. Dependencies

- **Subproject B (clock drift / black-image diagnostics)**: hard blocker for field deployment. Spec lives at `docs/superpowers/specs/2026-05-16-device-diagnostics-clock-and-black-image-stub.md`.
- **Spec E (setup web app)**: needed to register the new `/setup/sharpness.json` and `/setup/calibration.json` endpoints. v0.3 lands as Python modules; E wires them.
- **Bench-calibrated lens intrinsics file** for Arducam IMX708 Wide MF (and PCM3 Wide AF as fallback). One-time operator task on a calibration target (checkerboard). Documented in a separate hardware procedure doc.
- **Skyfield + OpenCV** added to firmware Python deps. `pyproject.toml` gains `skyfield>=1.46` and `opencv-python-headless>=4.8`.

## 10. Implementation slice order

1. **Camera-source abstraction**: refactor `capture.py` into `camera_source.py`'s `PiCameraSource`. Includes the `AfMode=Manual` + `LensPosition=0.0` init. Existing callers migrate. Unit tests with a fake camera source.
2. **SD provisioning**: ensure the base SD-card image (or the spec E provisioning script) sets `camera_auto_detect=0` and `dtoverlay=imx708` in `/boot/firmware/config.txt`. One-time per device. Document in spec E's provisioning section.
3. **Focus verification module**: `focus_check.py` with `sharpness_score(frame)` + `focus_ok(frame, threshold)`. Tests with synthetic frames (uniform → low, edge-heavy → high).
4. **`/setup/focus.json` endpoint**: one-shot renderer in `setup_alignment.py`. Tests.
5. **Alignment page HTML update**: add `focus: OK / failed` badge to the top HUD (single fetch on page load, no polling). Drop facing form + static sunsets counter (until calibration is available). Update tests.
6. **Sun detection module**: `sun_detect.py` with `detect_sun(frame)`. Tests with synthetic images.
7. **World-frame sun position**: `astronomy.py` with `compute_sun_world(lat, lng, t_utc)` via skyfield. Tests vs. NOAA values.
8. **Calibration store**: `calibration_store.py` for atomic read/write of `/etc/sunset-cam/calibration.json`. Tests.
9. **Pose solver**: `pose_solver.py` with `solve_azimuth(observations, intrinsics, imu_roll, imu_pitch)`. Tests with synthetic observations.
10. **Calibration runner**: ties §6–9 together. Runs in the capture loop's sunset window. Tests with mocked frame stream + mocked clock.
11. **Drift detection**: rolling-residual check; clears calibration if exceeded. Tests.
12. **Heartbeat payload extension**: include `calibrated_azimuth_deg` + friends. Spec lives in `device-protocol.md` (separate update).
13. **Bench lens-intrinsics procedure**: one-time operator task; ship resulting JSON file (`intrinsics/imx708-wide-af.json`) with firmware. Document in a separate procedure doc; not a code task.
14. **Establish per-SKU focus threshold**: companion to the lens intrinsics bench step. Capture sharpness scores under known conditions (sky / wall / lens-cap) and pick a threshold halfway between sky and wall. Bake into the intrinsics JSON.
15. **Manual field test**: real Pi + real IMX708 + real sunset. Validate end-to-end.

## 11. Diff from v0.2

If you read v0.2 and want to know what changed in v0.3:

- **§1 Problem**: adds two motivations (true compass needed; defensive focus check). v0.2 only had aiming + level + up.
- **§2 Goals**: adds auto-azimuth + passive focus verification + drift-detection goals. Drops the operator-self-report goal.
- **§3 Non-goals**: explicit "no ESP32, no magnetometer, no GPS, no runtime autofocus, no operator focus adjustment" — locks in the design constraints.
- **§5 Design**: keeps the v0.2 MPU-6050 pipeline + preview page intact. Adds five new modules (camera_source, focus_check, sun_detect, astronomy, calibration_store, pose_solver), one new persistent file (`calibration.json`), two new HTTP endpoints (`focus.json`, `calibration.json`), and changes to the alignment page (drops facing form, adds focus badge + calibration status block).
- **§6 Field provenance**: adds `calibrated_azimuth_deg` + `last_focus_*` as new heartbeat fields. v0.2 had no protocol additions.
- **§7 Testing**: adds hardware-gated manual tests; unit tests grow significantly.
- **§8 Risks**: re-anchors on B (clock drift) as a hard blocker, adds OpenCV size, sun saturation, cloudy stretches.
- **§9 Dependencies**: new section. v0.2 had no external deps.
- Hardware: camera SKU is **Arducam IMX708 Wide Autofocus** (120° HFOV, $35, ABS case + both ribbons included), replacing the earlier Pi Foundation Camera Module 3 Wide (102°) from v0.2 and superseding the briefly-considered manual-focus Arducam variant. Firmware locks AF to infinity at boot. Provisioning needs `dtoverlay=imx708` + `camera_auto_detect=0` in `/boot/firmware/config.txt`. Pi OS Bookworm+ required.
