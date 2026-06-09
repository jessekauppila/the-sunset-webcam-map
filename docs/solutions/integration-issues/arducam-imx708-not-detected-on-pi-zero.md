---
title: Arducam IMX708 not detected on Raspberry Pi (camera_auto_detect fails on blank EEPROM)
date: 2026-06-07
category: docs/solutions/integration-issues
module: pi-firmware-onboarding
problem_type: integration_issue
component: tooling
symptoms:
  - "`rpicam-hello --list-cameras` prints `No cameras available!`"
  - "`dmesg` shows zero camera probe activity — no imx708/csi/unicam lines at all, despite `camera_auto_detect=1` in config.txt"
  - "`sudo dtoverlay imx708` at runtime returns `Failed to apply overlay '1_imx708' (kernel)`"
root_cause: config_error
resolution_type: config_change
severity: high
tags: [raspberry-pi, arducam, imx708, camera, csi, pi-zero, onboarding, dtoverlay]
---

# Arducam IMX708 not detected on Raspberry Pi (camera_auto_detect fails on blank EEPROM)

## Problem

A new webcam unit (`sunset-cam-1`, Raspberry Pi Zero 2 W + Arducam IMX708 Autofocus / "Camera Module 3 Wide") reported `No cameras available!` from `rpicam-hello`, with `dmesg` showing no camera subsystem activity whatsoever — even though `camera_auto_detect=1` was correctly set in `/boot/firmware/config.txt`. This blocks the entire hardware bringup for any Arducam-based unit.

## Symptoms

- `rpicam-hello --list-cameras` → `No cameras available!`
- `dmesg | grep -iE 'imx|csi|unicam|cfe'` → **nothing camera-related** (only incidental SCSI/iSCSI text matches). No failed probe, just total absence.
- `grep -iE 'camera' /boot/firmware/config.txt` shows `camera_auto_detect=1` is present and correct.
- Runtime `sudo dtoverlay imx708` → `Failed to apply overlay '1_imx708' (kernel)`.

## What Didn't Work

- **Swapping/reseating CSI ribbon cables** (tried a 15-to-15, hunted for orientation issues, debated 22-to-22 vs 15-to-22). **This was a red herring and cost the most time.** The correct cable for a Pi Zero 2 W is the narrow **22-to-22** (both the Zero's port and the Arducam board are 22-pin / 0.5 mm), but the cable was never the actual fault. The "total dmesg silence" symptom does not point to wiring.
- **Running `sudo dtoverlay imx708` at runtime.** Camera/I2C overlays cannot be hot-applied; they must be set at boot. The `Failed to apply overlay (kernel)` message is **expected and not diagnostic** — it says nothing about whether the camera is wired correctly.

## Solution

Force the `imx708` driver explicitly at boot instead of relying on auto-detect. On the Pi:

```bash
# disable auto-detect so it doesn't fight the explicit overlay
sudo sed -i 's/camera_auto_detect=1/camera_auto_detect=0/' /boot/firmware/config.txt

# load the imx708 driver directly
echo "dtoverlay=imx708" | sudo tee -a /boot/firmware/config.txt

sudo reboot
```

After reboot, `dmesg` confirms the driver bound to the sensor:

```
imx708 10-001a: camera module ID 0x0000
```

(The `ctrl ... is not handled` and `Fixed dependency cycle(s)` lines that accompany it are harmless boot noise.) `rpicam-hello --list-cameras` then lists the sensor.

## Why This Works

Arducam IMX708 boards ship with a **blank / non-standard camera EEPROM** — the giveaway is `camera module ID 0x0000` in the kernel log. Raspberry Pi's `camera_auto_detect` works by reading that EEPROM over I2C to decide which sensor overlay to load. With no recognizable module ID, it loads **nothing** — which is exactly why `dmesg` is completely silent rather than showing a failed probe.

Forcing `dtoverlay=imx708` binds the driver directly and skips the EEPROM-identification step. The Arducam IMX708 is register/pin-compatible with the stock Raspberry Pi `imx708` driver, so no Arducam-specific software is required — only the explicit overlay.

**Key diagnostic distinction:**

| `dmesg` after forcing `dtoverlay=imx708` at boot | Meaning |
|---|---|
| Total silence (no imx708 line) before forcing | Auto-detect loaded nothing — config issue, **not wiring** |
| `imx708 ...: failed to read chip id` / `-EIO` / i2c timeout | Driver loaded but sensor not answering — **now** it's wiring/orientation/dead module |
| `imx708 10-001a: camera module ID ...` (no error) | Sensor alive, driver bound ✅ |

## Prevention

- **Set `dtoverlay=imx708` explicitly for every Arducam-based unit** in the install/onboarding guide, rather than relying on `camera_auto_detect`. Auto-detect will never recognize these boards.
- **Diagnostic order for "no camera":** before touching cables, force the overlay at boot and read `dmesg`. *Total silence* = config/auto-detect problem; a *`failed to read chip id`* probe error = wiring/orientation. Don't swap cables first.
- Remember that runtime `sudo dtoverlay <camera>` failing is normal — camera overlays only apply at boot. Never read that failure as a hardware signal.
- Cable sizing reference for this hardware: Pi Zero 2 W camera port and the Arducam IMX708 board are both **22-pin (0.5 mm)** → use the **22-to-22** cable from the Arducam kit. (Full-size Pi 3/4 ports are 15-pin → use the 15-to-22 cable.)

## Related Issues

- Pi install/bringup guide: `docs/hardware/2026-05-29-pi-mpu6050-install-and-bringup-guide.md` (on branch `docs/pi-mpu6050-install-guide`, PR #23) — should carry the explicit `dtoverlay=imx708` step.
- Bringup checkpoint: `docs/hardware/2026-05-31-mpu6050-bringup-checkpoint.md`.
