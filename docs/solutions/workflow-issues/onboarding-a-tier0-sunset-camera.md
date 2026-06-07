---
title: Onboarding a new Tier-0 sunset camera — the real, proven flow
date: 2026-06-07
category: docs/solutions/workflow-issues
module: pi-firmware-onboarding
problem_type: workflow_issue
component: development_workflow
severity: medium
applies_when:
  - Setting up a new custom Pi (Zero 2 W) + Arducam IMX708 webcam unit
  - Reproducing or speeding up the per-unit deployment workflow
tags: [onboarding, raspberry-pi, tier0, device-token, configure, sunset-cam, deployment]
---

# Onboarding a new Tier-0 sunset camera — the real, proven flow

## Context

Bringing up `sunset-cam-1` (Pi Zero 2 W + Arducam IMX708) took hours instead of minutes, mostly because the install/bringup guide documented a setup that **does not work**. Capturing the real, verified flow here so subsequent units are fast and repeatable. This is the procedure proven end-to-end on 2026-06-07 (camera record `camera_id 4`, frames confirmed landing in prod via server-assigned `snapshot_id`s).

## Guidance

The per-unit flow has three machines-worth of steps: **Mac (mint), Pi (install), Pi (configure + run).**

**1. Mac — create the camera record + device token** (writes to prod DB; token prints ONCE):

```bash
cd ~/GitHub/the-sunset-webcam-map
export DATABASE_URL="$(grep '^DATABASE_URL=' .env.production.local | cut -d= -f2- | tr -d '"')"
./scripts/tier0-create-camera.sh \
  --hardware-id pi-zero-2w-sunset-cam-N \
  --lat 48.7519 --lng -122.4787 \
  --timezone America/Los_Angeles \
  --title "sunset-cam-N" --phase sunset
```

Save the printed `camera_id` and 64-hex `device_token`.

**1b. Mac — install your SSH key on the Pi** (once per unit, after the Pi is flashed and on the network). This makes every later command passwordless and lets a script or AI assistant drive the bench checks:

```bash
ssh-copy-id pi@sunset-cam-N.local   # run on the Mac; expect "Number of key(s) added: 1"
```

**2. Pi — install firmware to `/opt/sunset-cam`** (after flashing/booting/SSH and physically connecting camera + MPU):

```bash
sudo git clone https://github.com/jessekauppila/sunset-cam-firmware.git /opt/sunset-cam
sudo bash /opt/sunset-cam/scripts/install.sh
```

**2b. Pi — apply the Arducam camera-overlay fix** (required on every Arducam unit — auto-detect can't see them; see `../integration-issues/arducam-imx708-not-detected-on-pi-zero.md`):

```bash
sudo sed -i 's/camera_auto_detect=1/camera_auto_detect=0/' /boot/firmware/config.txt
echo "dtoverlay=imx708" | sudo tee -a /boot/firmware/config.txt
sudo reboot
```

**3. Pi — write config + start** (substitute `<ID>` / `<TOKEN>`):

```bash
sudo bash /opt/sunset-cam/scripts/configure.sh \
  --camera-id <ID> --device-token <TOKEN> \
  --phase sunset --api-base https://www.sunrisesunset.studio \
  --window-id setup --window-from-now-min 0 --window-duration-min 30
sudo systemctl enable --now sunset-cam
journalctl -u sunset-cam -f   # expect: uploaded snapshot_id=… bytes=…
sudo systemctl stop sunset-cam   # stop a BENCH unit after verifying (avoid frame spam)
```

## Why This Matters

Onboarding is the bottleneck on the whole project's value — if only one person can do it, slowly, the camera network can't grow. The wrong docs cost an entire session of cable-swapping and config dead-ends. The traps that wasted the most time, each now avoided above:

- **`device_token`, not `claim_code`.** The firmware config reads `device_token` (from `tier0-create-camera.sh`). The `/api/admin/claim-codes` endpoint is a *separate* cloud-wizard flow this firmware never uses. Minting a claim code is a dead end.
- **Install to `/opt/sunset-cam`, not `~/sunset-cam-firmware`.** The systemd unit hard-codes `/opt/sunset-cam/.venv/bin/python`. A `~`-based manual install (or one without the `--system-site-packages` venv that `install.sh` builds) cannot start the service.
- **`www.sunrisesunset.studio`, not the apex.** The apex `sunrisesunset.studio` returns a 307 that strips the `Authorization` header → uploads/admin calls fail. Always target `www.`.
- **Never hand-write `config.json`.** `configure.sh` writes the exact required schema (`camera_id`, `device_token`, `api_base`, `phase`, `window_id`, `capture_window_start_utc`, `capture_window_end_utc`, `capture_interval_s`) and validates it. There is no `lat`/`lng`/`placement` in the firmware config.
- **Stop bench units.** ~1 frame/sec × ~300 KB = ~0.5 GB to prod per 30-min window. Pure waste for a test, and prod cost (Neon/storage) is a known concern.
- **Install the SSH key first (`ssh-copy-id`).** The recurring pain isn't any single step — it's typing a password for *dozens* of them. A passwordless Pi is a script/AI-drivable Pi: verification (frame capture, gyro read, log tail) can run non-interactively instead of hand-by-hand. This is the lever that turns commissioning from a manual slog into an automatable pass.

## When to Apply

- Any time a new custom camera unit is being set up, or the onboarding workflow is being scripted/automated further.
- A fresh `sunset-cam-N` bench camera will show `count: 0` in the public archive API (`/api/snapshots?webcam_id=N`) even when frames are landing — that's the active/visibility gate, not a failure. Verify success by the server-returned `snapshot_id`s in the Pi logs, not by the public map.

## Examples

Proven values from the sunset-cam-1 bringup: `hardware-id pi-zero-2w-sunset-cam-1`, `camera_id 4`, Bellingham coords `48.7519, -122.4787`, `America/Los_Angeles`. Logs on success:

```
picamera2 Camera started
INFO sunset_cam uploaded snapshot_id=100906 bytes=303923
INFO sunset_cam uploaded snapshot_id=100907 bytes=303798
```

## Related

- `../integration-issues/arducam-imx708-not-detected-on-pi-zero.md` — the Arducam overlay fix (step 2b).
- Install/bringup guide: `docs/hardware/2026-05-29-pi-mpu6050-install-and-bringup-guide.md` (rewritten to this flow on branch `docs/pi-mpu6050-install-guide`, PR #23).
- **Open opportunity:** wire `setup_alignment.py`'s `stream_mjpeg` / `render_align_page` / `render_orientation_json` into a runnable HTTP server so onboarding validates via a live preview (nothing saved) instead of uploading frames.
