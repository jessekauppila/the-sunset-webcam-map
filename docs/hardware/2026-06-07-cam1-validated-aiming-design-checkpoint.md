# sunset-cam-1 Validated + AR Aiming Design — Checkpoint

Date: 2026-06-07
Supersedes the `2026-05-31-mpu6050-bringup-checkpoint.md` (hardware bringup is now complete).

---

## TL;DR — resume here

**sunset-cam-1 is fully working and validated.** Camera produces good frames, MPU works (gyro bug fixed), onboarding flow is discovered + documented, 3 PRs are open. The aiming-experience design decision is **locked**. Next session starts with a **brainstorm of the v0.4 layered AR aiming**, then prototype it on cam1, then wire cam2 to test whether onboarding is now fast.

To resume: open Claude Code in `~/GitHub/the-sunset-webcam-map` and say *"let's start the v0.4 aiming brainstorm — read `docs/hardware/2026-06-07-cam1-validated-aiming-design-checkpoint.md`."*

---

## What's done (validated 2026-06-07)

- **sunset-cam-1 works end-to-end.** Camera → capture (picamera2) → upload → prod DB confirmed (server-assigned `snapshot_id`s, e.g. 100906+). `camera_id 4`, hardware-id `pi-zero-2w-sunset-cam-1`, Bellingham bench coords.
- **Image quality validated** — pulled a real frame: sharp focus (AF works), good exposure on a hard mixed-light scene, natural color. The product is good, not just the plumbing.
- **Camera detection bug fixed + documented** — Arducam's blank EEPROM defeats `camera_auto_detect`; fix is explicit `dtoverlay=imx708` + `camera_auto_detect=0`. (cloud PR #23, cloud PR #48 solution doc.)
- **Gyro bug found + fixed** — MPU6050 powers up asleep (`PWR_MGMT_1=0x40`); `read_orientation` never woke it, so it read fake `(0.0,0.0)`. Added `wake()` + `make_orientation_reader()` (firmware **PR #4**, TDD, hardware-verified).
- **Real onboarding flow discovered + documented** — the guide had been wrong. Real flow captured in the rewritten guide (PR #23) + runbook (PR #48).
- **SSH key installed on cam1** — Claude can drive it directly (passwordless). `ssh-copy-id` is now a documented commissioning step.

### Open PRs to merge
- firmware **#4** — gyro wake fix
- cloud **#23** — install guide rewritten to the real flow (+ dtoverlay + ssh-copy-id)
- cloud **#48** — two `docs/solutions/` learnings (Arducam detection, onboarding runbook)

---

## Design decision — LOCKED: layered AR aiming

Reverses v0.3's call. **v0.3** (`docs/superpowers/specs/2026-05-17-pi-alignment-v0.3-sun-self-calibration-design.md`) dropped sun-tap in favor of hands-off auto sun-calibration (`solvePnP` over many sunsets — precise ±2° but **eventual**, 1–7 days). That killed the instant "aim it in 5 min" moment.

**Decision:** sun-tap comes BACK as the **instant fast path**, auto-calibration stays as the **precise self-healing fallback + drift detection**. Complementary, not either/or:

| | Sun-tap (instant) | Auto sun-calibration (eventual) |
|---|---|---|
| Heading from | One tap on the visible sun → anchors heading; gyro tracks from there | `solvePnP` over many sun observations |
| Speed / precision | Instant / rough (102° FOV is forgiving) | Days / tight (±2°) |
| Needs | Sun visible & in frame now | Just runs during sunset windows |
| Covers | The live aim moment | Cloudy/night, drift, no-tap units |

### Key technical truths (don't re-derive these)
- **The MPU6050 gives roll+pitch (tilt), NOT heading/yaw.** No magnetometer in BOM. World-locked AR overlay therefore needs a heading reference — and the **sun** (computed az/alt from date + lat/lng) IS that reference.
- **The FOV math works:** at Bellingham ~48.75°N the annual sunset arc swings ~±37° around due west (~74° total) and fits inside the camera's **102° HFOV** → "aim ≈ 270° west + level" frames every sunset of the year. The job is hitting that aim.
- **Location (lat/lng) lives in the cloud camera record** (set by `tier0-create-camera.sh`), NOT in the Pi config.json. The setup-server's solstice/sun overlay needs lat/lng passed in (flag or fetched).

### Already built vs. not
- **Built:** `solstice_math.py` (sunset azimuths, az→pixel, sunsets-in-FOV), the 2D marker/level overlay renderer in `setup_alignment.py` (`render_align_page`, `render_orientation_json`, `stream_mjpeg`) — **renderers only, NO HTTP server**. Firmware `wake()`/`make_orientation_reader()` (PR #4).
- **NOT built:** heading derivation, sun-tap + sun-detect pipeline, the **setup-server HTTP wiring**, focus check, the whole field/commissioning mode split.

---

## Forward plan (the next session's work)

1. **Brainstorm → v0.4 spec: layered AR aiming.** Amend v0.3 to un-drop sun-tap. Cover: the sun-tap interaction (tap the live preview → POST pixel + timestamp → compute heading), gyro tracking from the anchor, the solstice/sun overlay, and how the two layers (sun-tap + auto-cal) hand off.
2. **Prototype the AR aiming on cam1.** This needs the **setup-server** built (wire `stream_mjpeg`/`render_align_page`/`render_orientation_json` into a runnable `ThreadingHTTPServer` — see the earlier setup-server design sketch). Auto-run it in a "setup mode" rather than a manual console command.
3. **Wire camera + gyro for cam2 → time the onboarding.** The real test of whether the documented flow + tooling actually made it fast. Target: minutes, not the hours cam1 took.
4. **Build the two-sided workflow (this is a first-class requirement, not an afterthought):**
   - **(a) Local validation / commissioning self-test** — bench check that camera + gyro work (a script that captures a frame, asserts non-blank, wakes + reads the gyro, reports pass/fail). Run by Jesse at the bench.
   - **(b) Easy recommission / relocation** — a unit moved to a NEW location must re-run field setup without a full reflash: update the camera's lat/lng (cloud record), re-aim (sun-tap), confirm. **Open question to resolve in the brainstorm:** where does location live and how is it updated on relocation? (Today it's in the cloud camera record + would need to reach the setup-server's overlay.) Relocation = repeatable field-setup, distinct from one-time commissioning.

### The commissioning ↔ field-setup split (frames all of the above)
- **Commissioning (Jesse, bench, one-time per hardware):** flash → install → overlay → self-test camera+gyro → bind identity. Output: a known-good Pi that knows who it is.
- **Field setup (end user OR Jesse relocating, repeatable per location):** power on at location → join WiFi → aim (sun-tap AR) → confirm first frame → done. No SSH, no commands.
- Jesse currently does both fused together — splitting them is the structural fix for "painfully slow."

---

## Key references
| Doc / artifact | What |
|---|---|
| `docs/superpowers/specs/2026-05-17-pi-alignment-v0.3-sun-self-calibration-design.md` | v0.3 — the design to amend into v0.4 |
| `docs/hardware/2026-05-29-pi-mpu6050-install-and-bringup-guide.md` (PR #23 branch) | rewritten onboarding guide (real flow) |
| `docs/solutions/workflow-issues/onboarding-a-tier0-sunset-camera.md` (PR #48) | the proven Tier-0 onboarding runbook |
| `docs/solutions/integration-issues/arducam-imx708-not-detected-on-pi-zero.md` (PR #48) | the camera-detection fix |
| `sunset-cam-firmware` PR #4 | `wake()` + `make_orientation_reader()` |
| `~/GitHub/sunset-cam-firmware/src/sunset_cam/setup_alignment.py` | the renderers the setup-server must wire up |

## Facts worth not re-learning
- Prod domain is **`www.sunrisesunset.studio`** (apex 307-redirects and strips auth).
- Onboarding: `tier0-create-camera.sh` (Mac, DATABASE_URL) → `camera_id` + `device_token` → `/opt/sunset-cam` `install.sh` → `configure.sh`. Config schema has NO lat/lng. Stop bench units after verifying (frame-spam cost).
- Pi Zero 2 W + Arducam IMX708 both use the **22-pin (0.5mm)** connector → 22-to-22 cable. The cable was never the problem on cam1; the camera issue was the `dtoverlay`.
- Passwordless SSH (`ssh-copy-id`) per unit is what makes commissioning AI/script-drivable.
