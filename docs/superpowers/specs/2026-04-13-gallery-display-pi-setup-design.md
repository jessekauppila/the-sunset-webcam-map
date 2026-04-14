# Gallery Display — Raspberry Pi Kiosk Setup Design

**Date:** 2026-04-13
**Status:** Approved

---

## Overview

Two vertical 27" Dell monitors (1080×1920 portrait) driven by a Raspberry Pi 4B display live sunrise and sunset webcam mosaics from The Sunset Webcam Map. The Pi is a thin client — it runs no app code. The Next.js app lives on Vercel; the Pi simply opens two Chromium windows in kiosk mode pointing at dedicated display routes.

---

## Architecture

```
Your Mac  →  git push  →  Vercel  →  live at URL
                                          ↑
Raspberry Pi  →  Chromium  →  /kiosk/sunrise  (monitor 1)
                           →  /kiosk/sunset   (monitor 2)

You (SSH)  →  Tailscale  →  Pi reload script
```

**Key principles:**
- No Docker. No app code on the Pi. No build step on the Pi.
- Webcam data refreshes every 60 seconds via SWR — seamless, no page reload needed.
- Full browser reload only needed when you push new code. Triggered manually via SSH using `xdotool` to send Ctrl+R to Chromium — fast, minimal flash.
- Push to `main` → Vercel deploys → next reload picks it up.

---

## Hardware

- Raspberry Pi 4B
- 2× 27" Dell monitors, 1080×1920 portrait orientation, 100Hz
- **Samsung PRO Endurance 32GB microSD** (high-endurance card — rated for 24/7 continuous write workloads; standard cards can fail in 6–18 months under kiosk use)
- Argon ONE V2 aluminum case

---

## Part 1: New Next.js Routes

Two new pages added to the app:

```
app/kiosk/sunrise/page.tsx
app/kiosk/sunset/page.tsx
app/kiosk/layout.tsx        ← shared kiosk layout
```

**`app/kiosk/layout.tsx`** — shared wrapper for both kiosk routes:
- Black background
- Cursor hidden
- No scrollbars
- `h-screen w-screen overflow-hidden`
- `<meta name="viewport">` locked to display dimensions

**Each page** renders only `MosaicCanvas` full-screen — no header, no map, no drawer, no mode toggle.

**Mosaic config tuning** — `masterConfig.ts` settings will need adjustment for portrait 1080×1920:
- Taller tiles, more vertical rows
- Tune `MOSAIC_MAX_IMAGE_HEIGHT_PX`, `MOSAIC_MIN_IMAGE_HEIGHT_PX`, `MOSAIC_SIZE_SCALE_STRENGTH`
- `canvasMaxImages` may need increasing for the taller viewport

These routes deploy automatically with the rest of the app on every push to `main`. No special Vercel configuration needed.

---

## Part 2: microSD Fresh Install

**Hardware needed:** Samsung PRO Endurance 32GB microSD card + USB card reader

**Steps on your Mac:**

1. Download **Raspberry Pi Imager** from raspberrypi.com (free)
2. Insert microSD card
3. In Imager, select:
   - **Device:** Raspberry Pi 4
   - **OS:** Raspberry Pi OS (64-bit) — Desktop *(not Lite — you need the GUI for Chromium)*
   - **Storage:** your microSD card
4. Click the **gear icon (⚙)** before writing to pre-configure:
   - **Hostname:** `sunsetdisplay.local`
   - **Enable SSH:** yes — paste your Mac's public key (`~/.ssh/id_rsa.pub` or `id_ed25519.pub`)
   - **Username:** `pi` (or your preference)
   - **Password:** set a strong one
   - **WiFi:** your home network SSID + password
   - **Locale/timezone:** set appropriately
5. Click **Write** — takes ~5 minutes
6. Eject card safely, insert into Pi, connect both monitors via micro-HDMI, power on
7. Wait ~90 seconds for first boot, then from your Mac: `ssh pi@sunsetdisplay.local`

> Pi is now SSH-accessible with no keyboard or monitor required.

---

## Part 3: Pi Setup (via SSH — in order)

### Step 1: Install Argon ONE V2 case script

Do this first — it requires a reboot, and you want the power button working before all other config.

```bash
curl https://download.argon40.com/argon1.sh | bash
sudo reboot
```

Wait ~60 seconds, then SSH back in: `ssh pi@sunsetdisplay.local`

**Power button behavior after install:**

| Action | Result |
|--------|--------|
| Single tap | Safe shutdown |
| Double tap | Reboot |
| Hold 3 seconds | Forced shutdown |

The script also configures temperature-based fan control — the aluminum case acts as heatsink so the fan runs quietly most of the time.

---

### Step 2: System configuration

```bash
# Auto-login to desktop (no password prompt on boot)
sudo raspi-config nonint do_boot_behaviour B4

# Disable screen blanking at system level
sudo raspi-config nonint do_blanking 1

# Install xdotool for remote browser reload
sudo apt install -y xdotool

# Add Chromium cache tmpfs to reduce SD card writes
echo "tmpfs /tmp/chromium-cache tmpfs defaults,noatime,nosuid,size=64m 0 0" | sudo tee -a /etc/fstab

# Apply fstab without reboot
sudo mount -a
```

---

### Step 3: LXDE autostart

This launches both Chromium windows automatically when the desktop loads.

```bash
mkdir -p ~/.config/lxsession/LXDE-pi
nano ~/.config/lxsession/LXDE-pi/autostart
```

Paste the following (replace `yourdomain.com` with your actual Vercel domain):

```
@xset s off
@xset -dpms
@xset s noblank
@chromium-browser --kiosk --noerrdialogs --disable-infobars --incognito \
  --disk-cache-dir=/tmp/chromium-cache \
  --window-position=0,0 \
  https://yourdomain.com/kiosk/sunrise
@chromium-browser --kiosk --noerrdialogs --disable-infobars --incognito \
  --disk-cache-dir=/tmp/chromium-cache \
  --window-position=1080,0 \
  https://yourdomain.com/kiosk/sunset
```

> `--incognito` prevents Chromium from showing crash-restore prompts after power loss.
> Two separate remote debugging ports (9222, 9223) — one per monitor.

---

### Step 4: Remote reload script

```bash
nano ~/reload-kiosk.sh
```

Paste:

```bash
#!/bin/bash
# Reload all Chromium kiosk windows by sending Ctrl+R via xdotool
# Requires: sudo apt install -y xdotool (done in Step 2)
DISPLAY=:0 xdotool search --class chromium key --clearmodifiers ctrl+r
echo "Reloaded all kiosk windows"
```

```bash
chmod +x ~/reload-kiosk.sh
```

**To reload from your Mac:**
```bash
ssh pi@sunsetdisplay 'bash ~/reload-kiosk.sh'
```

---

### Step 5: Install Tailscale

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

Follow the auth link printed in the terminal — log in with your Tailscale account (free for personal use). Install Tailscale on your Mac too if not already installed.

After setup, the Pi is reachable from anywhere as `sunsetdisplay` regardless of network:
```bash
ssh pi@sunsetdisplay         # from home, gallery, anywhere
ssh pi@sunsetdisplay 'bash ~/reload-kiosk.sh'   # remote reload
```

---

### Step 6: Final reboot and verify

```bash
sudo reboot
```

After ~45 seconds both monitors should show the kiosk views. Verify:
- Both displays load correctly
- No browser chrome visible (no address bar, no tabs)
- Monitors do not sleep after 10+ minutes
- Power button single-tap triggers safe shutdown
- Remote reload works from your Mac

---

## Part 4: Local Development Workflow

No Docker needed. Standard Next.js dev:

```bash
npm run dev
```

Navigate to `localhost:3000/kiosk/sunrise` in Chrome. Use Chrome DevTools (Cmd+Shift+M or device toolbar) to set viewport to **1080×1920** — this is your accurate portrait preview.

**Iteration loop:**
1. Adjust mosaic config / kiosk route styles locally
2. Preview at 1080×1920 in Chrome DevTools
3. `git push` to `main` → Vercel deploys automatically
4. `ssh pi@sunsetdisplay 'bash ~/reload-kiosk.sh'` → Pi picks up changes

---

## Part 5: Monitor Orientation

The Dell monitors need to be set to portrait orientation in their own OSD menu (physical button on the monitor). The Pi will detect them as rotated displays. If the output appears landscape on the portrait screen, add to `/boot/config.txt`:

```
display_rotate=1    # 90 degrees clockwise for HDMI port 1
display_rotate_2=1  # 90 degrees clockwise for HDMI port 2
```

Exact values depend on physical monitor orientation — may need `1` (90°) or `3` (270°).

---

## Part 6: WiFi Management

Raspberry Pi Imager only configures one WiFi network (your home network). For the gallery — or any second location — add networks via SSH after the Pi is set up.

**Adding a new WiFi network:**

```bash
sudo nmcli device wifi connect "NetworkName" password "thepassword"
```

Pi OS Bookworm uses NetworkManager. The Pi remembers all added networks and auto-connects to whichever is in range — no further config needed when switching locations.

**How to get the Pi online at a new location (pick one):**

| Situation | Approach |
|---|---|
| You have the gallery WiFi credentials in advance | SSH from home before you go, run `nmcli` to pre-add the network |
| You're physically at the gallery | Plug in ethernet temporarily → SSH in → add WiFi → unplug |
| No ethernet available | Connect Pi to your phone hotspot once via keyboard/monitor, add gallery WiFi, done |

**Recommended:** Get the gallery WiFi credentials ahead of time and add them from home via SSH before the Pi leaves the house. It will connect automatically when it arrives.

---

## What's Not In Scope

- Docker (not needed for thin client approach)
- App code running on Pi
- Git pull / auto-deploy on the Pi (Vercel handles deployment; Pi just reloads the browser)
- Offline/fallback display if Vercel is unreachable
