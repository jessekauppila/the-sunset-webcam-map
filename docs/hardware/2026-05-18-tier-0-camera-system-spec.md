# Tier 0 Sunset Camera — Hardware Spec & Firmware Implications

Status: Draft — 2026-05-18
Owner: Jesse Kauppila
Captures the full hardware decisions for the Tier 0 sunset camera so firmware work doesn't re-derive constraints. Companion to the alignment-tool software specs (v0.1 → v0.3 under `docs/superpowers/specs/`).

---

## Project overview

A networked camera device that:
1. Wakes during sunset windows (computed from sun position APIs / local astronomical calc)
2. Captures stills periodically across the window
3. Maintains a running "best so far" frame via on-device heuristic scoring
4. Uploads only the winning frame to a server at end of window
5. Server runs a PyTorch ResNet for higher-quality scoring and DB ingestion
6. Future capability: live MJPEG streaming during the window

Target: 100–500 unit deployment, installed by non-technical users.

## Confirmed hardware

### Compute
**Raspberry Pi Zero 2 W** (preferred) or **Raspberry Pi 5** (fallback during Zero 2 W stockouts).
- ARMv8 quad-core required — original Pi Zero W (ARMv6) is **not supported** for this project. Modern Python ML packages don't ship ARMv6 builds.
- 64-bit Raspberry Pi OS, **Bookworm or later** (kernel 6.1.x+); older Bullseye is not supported by the Arducam driver.
- ML inference happens on a server; on-device only does lightweight image heuristics.

### Camera

**Arducam for Raspberry Pi Camera Module 3 Wide, 120°(D) IMX708 Autofocus Pi Camera V3 with Case** — $35.

- Sensor: Sony IMX708, 12MP (4608 × 2592)
- Lens: 120° diagonal wide-angle, M12 mount
- Focus: **Autofocus** (PDAF + CDAF) — software-controllable
- Interface: MIPI CSI-2
- Includes: camera, ABS case, 15-22 pin cable, 22-22 pin cable
- Same IMX708 sensor as the Raspberry Pi Foundation Camera Module 3 — software-compatible. Pi Foundation version is the supply fallback.

**Firmware must lock the lens to infinity at boot.** The autofocus motor will otherwise hunt on bright skies and produce soft frames during the sunset window. Using `picamera2`:

```python
from picamera2 import Picamera2
from libcamera import controls

picam = Picamera2()
config = picam.create_still_configuration()
picam.configure(config)

# Lock focus at infinity, disable autofocus
picam.set_controls({
    "AfMode": controls.AfModeEnum.Manual,
    "LensPosition": 0.0,  # 0.0 = infinity, higher = closer
})
picam.start()
```

Apply these controls **after** `configure()` and **before** `start()`. The `LensPosition` value of `0.0` corresponds to infinity focus. Verify on first deployment that distant objects are sharp; if not, sweep `LensPosition` from 0.0 to ~2.0 and pick the value where horizon sharpness peaks. Store the result as a per-unit calibration value in the device's config.

### Arducam-specific Pi config

The Arducam IMX708 module needs a `/boot/firmware/config.txt` tweak before `libcamera`/`picamera2` will detect it. Add to provisioning:

```
# Change:  camera_auto_detect=1
# To:      camera_auto_detect=0
# Add:     dtoverlay=imx708
```

Then reboot. One-time setup per device. Bake into the initial SD image / first-boot provisioning script.

Reference: https://bit.ly/ArduCam_CM3_B0311

### Cable & enclosure

- Ribbon cable: 15-22 pin and 22-22 pin both included (Pi Zero 2 W uses 15-22; Pi 5 uses 22-22).
- ABS case included with the camera. Reported gotcha: small protective film over the lens on arrival; remove before assembly or the lid won't fit flush.
- For the Pi Zero 2 W itself, still need a separate enclosure (or mount Pi + camera in a custom prototype enclosure). At production scale this becomes a single custom enclosure that integrates both.

### IMU

**MPU-6050** (GY-521 breakout, I²C address 0x68) — ~$1.50 in bulk.

- Tilt and roll only — **no magnetometer.** Heading is solved via celestial self-calibration (see software spec C v0.3).
- Wiring: VCC → 3.3V (not 5V), GND → GND, SCL → GPIO 3, SDA → GPIO 2.
- Cheap clone units are acceptable; verify each at install time with `i2cdetect -y 1` (should see 0x68).

### Power

- 5V via micro-USB (Pi Zero 2 W) or USB-C (Pi 5).
- Indoor install assumed; 15ft 22AWG USB cable + 2.5A+ regulated wall adapter.
- Long-run installs should use AC extension cord + PSU at the device end, not long DC cables (voltage drop on 22AWG is significant past ~15ft at 2.5A).

## Camera abstraction requirement

Firmware **must** wrap camera access behind a thin interface so the underlying camera can change without touching application code:

```python
class CameraSource:
    def capture(self) -> np.ndarray: ...
    def configure(self, resolution, **opts): ...

class PiCameraSource(CameraSource):
    # picamera2 implementation
    # Handles AF disable + infinity lock in __init__
```

Reasons:
- Arducam IMX708 vs Pi Foundation Camera Module 3 supply may force swaps mid-production
- USB camera fallback may be useful for development/testing
- Sensor changes (e.g., future Camera Module v4) should not cascade through the codebase

The autofocus disable + infinity lock lives inside `PiCameraSource.__init__()` so calling code never thinks about focus. If a future swap to the Pi Foundation Camera Module 3 happens, only the `dtoverlay` line in provisioning changes — the firmware focus-locking code is the same.

## Orientation & calibration strategy: celestial self-calibration

**Chosen approach: the camera figures out its own pointing direction from where the sun appears in its frames.** No magnetometer, no GPS module, no compass calibration ritual. Full design in `docs/superpowers/specs/2026-05-17-pi-alignment-v0.3-sun-self-calibration-design.md`.

### Inputs needed
- **Time**: NTP via wifi (must be accurate within ~1 second; sub-minute drift translates to azimuth error). **Hard dependency on Subproject B (clock drift fix).**
- **Location**: lat/lon from user (zip code, browser geolocation, or manual entry during onboarding). ~5km accuracy is plenty.
- **MPU-6050**: provides tilt + roll relative to gravity (constrains pose estimation)
- **Captured frames during sunset**: provide the sun's pixel position

### Math / libraries
- **Skyfield** (Python) — given lat/lon + UTC timestamp, returns sun azimuth and altitude in the world frame.
- **OpenCV `cv2.solvePnP`** — solves for camera rotation given known 3D world points and their 2D image projections.
- **Sun detection**: brightest cluster in frame with saturated R+G channels. Simple, robust during golden hour.

### Calibration flow
1. During each sunset, capture frames at 30–60s intervals.
2. For frames where sun is clearly visible, record (sun pixel x/y, timestamp, sun world azimuth/altitude).
3. Accumulate 10–30 observations across the sunset window — sun's arc gives a built-in trajectory.
4. Solve for camera pose. Roll is constrained by MPU-6050 gravity vector.
5. After 1–3 sunny sunsets, calibration is high-confidence. Refine continuously.

### Lens distortion
Pi Camera Module 3 Wide / Arducam IMX708 120° lens has consistent distortion across units of the same SKU. **Calibrate once in the lab** with a checkerboard, ship a single intrinsics file (`intrinsics/imx708-wide-af.json`) with the firmware. Don't try to solve distortion per-unit during deployment.

### Drift detection
- Each new sun observation that fails to match the stored calibration → device has moved.
- Threshold: if predicted vs observed sun position diverges by more than a few degrees consistently, flag for re-calibration and alert the user.

### Failure modes & mitigations

| Condition | Mitigation |
|---|---|
| Overcast for days | Calibration waits. UI tells user "will fine-tune on first clear sunset." Initial setup completes anyway with rough estimate. |
| Camera pointed wrong way (no sun ever visible) | After N days without a sun detection during sunset windows, alert user. |
| Clock drift offline | Calibration accuracy degrades; require NTP sync within last 24 hours before using new observations. |
| Sun saturates / blooms | Sun-detection takes a short-exposure auxiliary frame during calibration capture so the centroid is well-defined. |

## On-device "best so far" heuristic

This is the gate that decides whether to keep a new frame as the running best. Intentionally **generous** — server-side ResNet is the strict judge. Better to upload a mediocre frame than upload nothing.

Suggested heuristic features (cheap to compute, no ML required):
- Warm color fraction: pixels where R+G dominate B
- Saturation distribution (HSV) — sunsets have high saturation
- Histogram spread / dynamic range
- Cloud structure proxy: mid-frequency spatial variation in the upper portion of the frame

Combine into a single scalar score. Persist current best (JPEG + score) to SD card during the window. Reset at start of each window.

## Upload workflow

- One image per device per sunset window (the winner).
- HTTPS POST to server endpoint.
- Include metadata: device ID, capture timestamp, on-device score, current calibration state, MPU-6050 reading, focus-verification score.
- Retry queue on SD card if upload fails — never lose a winning frame to transient network failure.

## Streaming (future)

- MJPEG over HTTP is the simplest path on Pi.
- Switched on by server command, runs for duration of window, switches back to capture mode.
- 720p @ 15fps is comfortable on Pi Zero 2 W.

## Onboarding flow (web-based, no phone app required)

Device exposes a captive portal / local web UI on first boot. User:

1. Connects laptop or phone to device's wifi access point.
2. Selects home wifi network, enters password.
3. Enters location (zip code or geolocation).
4. Aims camera roughly at the western horizon (for sunset units).
5. **Passive focus verification**: the alignment page reports "focus OK" or "focus failed" via a one-time edge-contrast check. The autofocus camera locks to infinity in software, so the operator doesn't adjust anything; failure here means "remove lens cap" or "you're pointed at a wall."
6. Confirms level using MPU-6050 readout (UI shows a bubble-level widget — green when within ±2°).
7. Done. Device tells user "your camera will fine-tune itself on the next clear sunset."

After install, ongoing calibration happens automatically without user involvement.

## Resolution / mode considerations

The IMX708 supports:
- 4608 × 2592 stills (full resolution, ~12MP)
- 2304 × 1296 @ 56fps video
- 2304 × 1296 @ 30fps **HDR mode** (3MP effective)
- 1536 × 864 @ 120fps

For sunset captures, **HDR mode is worth evaluating** — sunsets are exactly the high-dynamic-range scene HDR is designed for. Tradeoff: HDR drops effective resolution to 3MP and limits to 30fps. For still capture every 30-60 seconds, framerate is irrelevant; the resolution drop is the real cost.

Recommendation: support both modes and make it configurable, with HDR as the default for sunset captures:

```python
# HDR mode
picam.set_controls({"HdrMode": controls.HdrModeEnum.SingleExposure})
```

(The exact HDR control name may differ by `picamera2` version — verify against installed library.)

## Software stack (recommended)

- **OS**: Raspberry Pi OS 64-bit (Bookworm or later)
- **Camera**: `picamera2` (libcamera-based; the modern API)
- **IMU**: `smbus2` for raw I²C, or `mpu6050-raspberrypi` library (we use `smbus2` per the v0.2 firmware)
- **Astronomy**: `skyfield`
- **Image processing**: `opencv-python-headless`, `Pillow`, `numpy`
- **Web UI for onboarding**: Flask is plenty; serve over the captive portal AP
- **Uploads**: `requests` with retry/backoff
- **Process management**: systemd units for the capture daemon and onboarding service

## Bill of materials (per unit)

| Component | Part | Approx. cost (retail / bulk @ 500) |
|---|---|---|
| Compute | Pi Zero 2 W | $18 / ~$18 (limited bulk discount) |
| Camera | Arducam IMX708 Wide Autofocus + Case | $35 / ~$30 |
| IMU | MPU-6050 (GY-521) | $2 / $1.50 |
| microSD | 32GB Class 10 | $8 / $5 |
| PSU + cable | 2.5A USB + 15ft 22AWG | $18 / $12 |
| Ribbon cables | Both 15-22 and 22-22 (with camera) | — / — |
| **Total** | | **~$81 / ~$67** |

(Down from earlier $90/$75 estimate; the autofocus camera includes the case + both ribbons, and is $5 cheaper than the manual-focus variant once considered.)

## Explicit non-requirements

To save the next agent / developer from re-litigating:

- **No magnetometer**: heading comes from celestial calibration.
- **No GPS module**: location entered during onboarding; sufficient accuracy from zip code.
- **No runtime autofocus control**: AF is hardware-supported but software-locked to infinity at boot. Never re-enabled during normal operation.
- **No operator focus adjustment**: with the autofocus camera, the operator never touches a lens ring. The alignment page only reports a binary focus check.
- **No on-device deep learning**: server-side ResNet does the heavy ML. On-device scoring is cheap heuristics.
- **No mechanical gimbal / servo leveling**: software rotation correction only, if any.
- **No ESP32 fallback for the celestial-calibration pipeline**: ESP32 image quality is insufficient for high-contrast sunset scenes AND OpenCV doesn't run on it. ESP32 builds, if ever needed, would use the v0.2 operator-selected facing.
- **No phone app required for onboarding**: web UI works from any browser.

## Open questions for firmware work

1. Exact form of the on-device heuristic score — needs validation against real sunset data.
2. Whether to capture in HDR mode (Pi Camera Module 3 supports 3MP HDR) vs single-exposure 12MP — HDR helps with sunset dynamic range but reduces resolution.
3. Sun detection robustness when sun is partially obscured by clouds.
4. Exact intrinsics calibration procedure for production (lab checkerboard procedure → JSON intrinsics file → shipped with firmware).
5. Retry / backoff policy for failed uploads and how long to retain unsuccessful winners on SD card.
6. Per-SKU sharpness threshold calibration — bench step that establishes the threshold for the focus-OK check.

## History

- 2026-05-15: initial hardware sketch (`pi-webcam-mvp.md`).
- 2026-05-17: hardware spec drafted to support the v0.3 alignment-tool spec, originally proposing the manual-focus camera variant.
- 2026-05-18: revised to the **autofocus** Arducam IMX708 + ABS case + both ribbons. Onboarding flow simplifies (no manual focus step); firmware grows the AF-disable + infinity-lock init.
