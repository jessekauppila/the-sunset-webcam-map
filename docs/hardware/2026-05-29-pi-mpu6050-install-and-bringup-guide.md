# Pi + MPU6050 — Install and Bringup Guide

A start-to-finish guide for taking a fresh Raspberry Pi Zero 2 W from "in the box" to "MPU6050 read out via firmware, camera snapshot captured, orientation verified." Follow top-to-bottom; skip Part 1 if your Pi already has the firmware.

## Contents

- [Hardware checklist](#hardware-checklist)
- [Part 1 — Fresh firmware install (skip if Pi is already set up)](#part-1--fresh-firmware-install)
- [Part 2 — Pre-flight checks](#part-2--pre-flight-checks)
- [Part 3 — MPU bringup tests](#part-3--mpu-bringup-tests)
- [Part 4 — What to send back](#part-4--what-to-send-back)
- [Troubleshooting cheat sheet](#troubleshooting-cheat-sheet)

---

## Hardware checklist

Confirm you have all of these before starting:

- Raspberry Pi Zero 2 W (the 2 W variant, not the original Zero W)
- microSD card, 32 GB, SanDisk Ultra or Samsung EVO (Class 10 / U1)
- Arducam IMX708 Autofocus camera + CSI ribbon cable
- MPU6050 / GY-521 IMU breakout, **with rigid pin headers soldered onto it**
- Pi power adapter (5V 2.5A micro-USB)
- 4 short solid-core jumper wires for MPU → Pi connection (~5-10 mm each)
- An IP65 weatherproof enclosure for final install (not needed for bench bringup)
- A Mac/laptop on the same WiFi network as the Pi
- A phone with a browser, also on the same WiFi
- Wired connections from MPU to Pi: VCC↔pin 1 (3.3V), GND↔pin 9, SDA↔pin 3, SCL↔pin 5

---

## Part 1 — Fresh firmware install

Skip this part if you're working with the existing `sunset-cam-0.local` Pi. This is for setting up a new Pi from scratch.

> ### ✅ Streamlined path — USE THIS (proven end-to-end 2026-06-07 on sunset-cam-1)
>
> This is the real, verified per-unit flow (~5 min active work). The manual steps 1.4–1.11 below are **reference only** — they show what `install.sh` does, and an earlier draft of them was wrong (see the ⚠️ box at the end of this callout). Trust this path.
>
> **1. On the Mac — create the camera record + device token** (writes to prod DB; the token prints ONCE):
>
> ```bash
> cd ~/GitHub/the-sunset-webcam-map
> export DATABASE_URL="$(grep '^DATABASE_URL=' .env.production.local | cut -d= -f2- | tr -d '"')"
> ./scripts/tier0-create-camera.sh \
>   --hardware-id pi-zero-2w-sunset-cam-N \
>   --lat 48.7519 --lng -122.4787 \
>   --timezone America/Los_Angeles \
>   --title "sunset-cam-N" --phase sunset
> ```
>
> Save the printed **`camera_id`** and **`device_token`** (64 hex chars).
>
> **2. Flash the SD card** (§1.1), boot (§1.2), SSH in (§1.3), then **install your SSH key** (§1.3b — `ssh-copy-id pi@sunset-cam-N.local`) so the rest is passwordless and AI/script-drivable.
>
> **3. Physically connect the MPU + camera** (the Arducam CSI ribbon and the MPU wiring).
>
> **4. On the Pi — install firmware to `/opt/sunset-cam`:**
>
> ```bash
> sudo git clone https://github.com/jessekauppila/sunset-cam-firmware.git /opt/sunset-cam
> sudo bash /opt/sunset-cam/scripts/install.sh
> ```
>
> `install.sh` apt-installs deps, enables I2C, builds the venv at `/opt/sunset-cam/.venv` (which the systemd unit requires), and registers the service. It stops with a note that `config.json` doesn't exist yet — expected.
>
> **5. Apply the Arducam camera-overlay fix** (the ⚠️ box in §1.6 — **required on every Arducam unit**, then `sudo reboot`).
>
> **6. Write the config + start the service:**
>
> ```bash
> sudo bash /opt/sunset-cam/scripts/configure.sh \
>   --camera-id <ID> --device-token <TOKEN> \
>   --phase sunset --api-base https://www.sunrisesunset.studio \
>   --window-id setup --window-from-now-min 0 --window-duration-min 30
> sudo systemctl enable --now sunset-cam
> ```
>
> Watch `journalctl -u sunset-cam -f` for `uploaded snapshot_id=…` (server-assigned IDs = frames landing in prod). **Then stop it** so a bench unit doesn't spam ~1 frame/sec to prod: `sudo systemctl stop sunset-cam`. Set a real sunset capture window only when the unit is actually deployed.
>
> > ### ⚠️ Two things the old manual steps got WRONG (don't trust 1.7–1.11 blindly)
> >
> > - **Config uses `device_token`, NOT a `claim_code`.** The `/api/admin/claim-codes` endpoint is a *different* (cloud-wizard) flow this firmware does not use. The real config schema is `camera_id`, `device_token`, `api_base`, `phase`, `window_id`, `capture_window_start_utc`, `capture_window_end_utc`, `capture_interval_s` — no `lat`/`lng`/`placement`. Always write it with `configure.sh`, never by hand.
> > - **Install to `/opt/sunset-cam`, not `~/sunset-cam-firmware`.** The systemd unit hard-codes `/opt/sunset-cam/.venv/bin/python`; a `~`-based manual install won't start.
> > - Use **`https://www.sunrisesunset.studio`** for `--api-base`. The apex `sunrisesunset.studio` issues a 307 redirect that strips the auth header → uploads fail.

### Manual install (steps 1.4-1.11 below)

The rest of Part 1 walks through each step manually. Use this on your first unit to understand what's happening; switch to the streamlined path above for unit #2 onward.

### 1.1. Flash the SD card

On your Mac, install **Raspberry Pi Imager** (download from raspberrypi.com if you don't have it).

1. Open Pi Imager.
2. Click **CHOOSE DEVICE** → "Raspberry Pi Zero 2 W."
3. Click **CHOOSE OS** → "Raspberry Pi OS Lite (64-bit)." Lite — no desktop.
4. Click **CHOOSE STORAGE** → select your inserted microSD card.
5. Click **NEXT** → click **EDIT SETTINGS** when it asks about applying customisation.

In the customisation dialog, set:

- **Hostname:** `sunset-cam-N` (where `N` is your unit number, e.g., `sunset-cam-1`). This becomes the address you SSH to (`sunset-cam-1.local`).
- **Username:** `pi`
- **Password:** something memorable, write it down
- **Configure wireless LAN:** check this box, enter your WiFi SSID and password, set your country
- **Set locale settings:** your timezone

Under the **Services** tab:

- **Enable SSH** — check
- **Use password authentication** — check (or SSH key if you've got one set up)

Click **SAVE**. Then **YES** to apply. Then **YES** to confirm overwriting the card. Wait ~5 minutes for write + verify.

### 1.2. First boot

1. Eject the SD card from your Mac.
2. Insert into the Pi.
3. Plug in the power adapter.
4. Wait ~60 seconds for first boot (the Pi resizes the filesystem on first boot — this is slow).

### 1.3. SSH in

From your Mac terminal:

```bash
ssh pi@sunset-cam-1.local
```

(Replace `N` with your unit number.) Type the password you set.

If it says "host not found": wait another 30 seconds and try again, mDNS sometimes takes a moment.

You should see a prompt like `pi@sunset-cam-1:~ $`. You're in.

### 1.3b. Install your SSH key — makes the unit AI/script-drivable (do this every unit)

Commissioning is dozens of small commands run over SSH. Typing the password for each one is the single biggest source of friction — and it blocks an AI assistant (or any script) from driving the checks for you. Install your Mac's public key on the Pi **once**, and every later `ssh`/`scp` is passwordless.

From your **Mac** terminal (not inside the SSH session):

```bash
ssh-copy-id pi@sunset-cam-1.local
```

Type the Pi password one last time. You should see `Number of key(s) added: 1`. (If it says "No identities found," you have no key yet — run `ssh-keygen -t ed25519` first, accept the defaults, then re-run `ssh-copy-id`.)

After this, capture/gyro/log verification can be run non-interactively — by you in a script, or by an AI assistant driving the bench checks directly. This is what turns "dozens of typed, logged-in commands" into an automatable commissioning pass.

### 1.4. Update system packages

```bash
sudo apt update
```

```bash
sudo apt upgrade -y
```

Wait for upgrade to finish (~5 minutes on first run).

### 1.5. Install build dependencies

```bash
sudo apt install -y git python3-pip python3-venv python3-picamera2 libcap-dev i2c-tools
```

This installs git, Python tooling, the picamera2 library (for the Arducam), libcap (a picamera2 dependency), and i2c-tools (for the `i2cdetect` command).

### 1.6. Enable I2C and camera

```bash
sudo raspi-config nonint do_i2c 0
```

```bash
sudo raspi-config nonint do_camera 0
```

`0` is "yes/enable." Confirms I2C and camera interfaces are turned on.

> ### ⚠️ Arducam cameras: force the overlay explicitly — don't rely on auto-detect
>
> The default `camera_auto_detect=1` in `/boot/firmware/config.txt` **does not work with Arducam IMX708 boards.** Arducam modules ship with a blank/non-standard camera EEPROM (the kernel reports `camera module ID 0x0000`), so auto-detect can't identify the sensor and loads **nothing** — you get `No cameras available!` with a completely silent `dmesg`. Set the overlay explicitly instead:
>
> ```bash
> sudo sed -i 's/camera_auto_detect=1/camera_auto_detect=0/' /boot/firmware/config.txt
> ```
>
> ```bash
> echo "dtoverlay=imx708" | sudo tee -a /boot/firmware/config.txt
> ```
>
> This is required on **every** Arducam unit. The stock `imx708` driver works fine — only auto-detection is broken. After a reboot, `dmesg | grep imx708` should show `imx708 10-001a: camera module ID ...` with no chip-id error. Full write-up: `docs/solutions/integration-issues/arducam-imx708-not-detected-on-pi-zero.md`.

> **The streamlined callout at the top of Part 1 is the path to follow.** Steps 1.7–1.10 below are kept only as an explanation of what `install.sh` + `configure.sh` do under the hood — for debugging when something fails. They install to `/opt/sunset-cam` to match the systemd unit; do **not** install to `~/sunset-cam-firmware`.

### 1.7. Clone the firmware repo to `/opt/sunset-cam`

```bash
sudo git clone https://github.com/jessekauppila/sunset-cam-firmware.git /opt/sunset-cam
```

The systemd unit runs `/opt/sunset-cam/.venv/bin/python -m sunset_cam.main /opt/sunset-cam/config/config.json` — the path is hard-coded, so the firmware must live at `/opt/sunset-cam`.

### 1.8. Run `install.sh` (builds the venv, registers the service)

```bash
sudo bash /opt/sunset-cam/scripts/install.sh
```

This is what `install.sh` does, and why a hand-rolled `pip install` isn't enough: it creates a venv at `/opt/sunset-cam/.venv` **with `--system-site-packages`** (so the apt-installed `python3-picamera2` is importable), installs `requirements.txt` + the package editable, copies the systemd unit, and `daemon-reload`s. It enables+starts the service **only if `config.json` already exists** — on a fresh unit it doesn't, so it prints a note and stops. That's expected; the config comes next.

### 1.9. Create the device config with `configure.sh`

First, on the **Mac**, create the camera record and device token (see the streamlined callout, step 1 — `scripts/tier0-create-camera.sh`). It prints a `camera_id` and a 64-hex `device_token`.

> **The config uses `device_token`, not a claim code.** Do not hand-edit JSON and do not use `/api/admin/claim-codes` — that's a separate cloud-wizard mechanism this firmware does not read. `configure.sh` writes the correct schema for you and validates it.

Back on the **Pi**, write the config (substitute your `camera_id` and `device_token`):

```bash
sudo bash /opt/sunset-cam/scripts/configure.sh \
  --camera-id <ID> --device-token <TOKEN> \
  --phase sunset --api-base https://www.sunrisesunset.studio \
  --window-id setup --window-from-now-min 0 --window-duration-min 30
```

`--window-from-now-min 0 --window-duration-min 30` makes the capture window active immediately for 30 minutes — handy for a bench test (don't wait for actual sunset). For a deployed unit, pass the real sunset window with `--window-start`/`--window-end` (ISO8601 UTC, `Z` suffix) instead. The written config has these keys and no others: `camera_id`, `device_token`, `api_base`, `phase`, `window_id`, `capture_window_start_utc`, `capture_window_end_utc`, `capture_interval_s`, `log_level`.

### 1.10. Enable + start the service

```bash
sudo systemctl enable --now sunset-cam
```

Check it and watch the logs:

```bash
journalctl -u sunset-cam -f
```

You want `starting; camera_id=… api_base=…` followed by `uploaded snapshot_id=… bytes=…` roughly once per second. Those `snapshot_id`s are returned by the server — proof the frames are landing in prod.

> **Stop a bench unit after verifying.** At ~1 frame/sec each ~300 KB, a 30-min window is ~1,800 frames / ~0.5 GB to prod — needless storage/bandwidth cost for a test. Once you've seen `uploaded snapshot_id=…`, run `sudo systemctl stop sunset-cam`. (Planned: validate framing/orientation with a live MJPEG preview that saves nothing, instead of uploading at all — the `setup_alignment.py` building blocks exist but the HTTP server to run them is not wired up yet.)

### 1.11. Reboot once

```bash
sudo reboot
```

Wait ~30 seconds. SSH back in. If you left the service enabled, the firmware comes back up on boot.

You're done with Part 1.

---

## Part 2 — Pre-flight checks

This part takes ~5 minutes. Verifies all four prerequisites are good before you start the actual MPU bringup tests.

### 2.1. Pi is reachable

From your **Mac terminal**:

```bash
ping -c 3 sunset-cam-N.local
```

(Use your hostname. For the test camera that's `sunset-cam-0.local`.)

Expected: 3 "64 bytes from..." lines.


| If you get...             | Do this                                           |
| ------------------------- | ------------------------------------------------- |
| 3 replies                 | ✅ Pi is on the network. Continue.                 |
| "cannot resolve hostname" | mDNS isn't working — find IP another way (below). |
| Requests time out         | Pi powered down or different network.             |


**If hostname doesn't resolve**, find the Pi's IP via your router admin page (usually `http://192.168.1.1` — look for a device named `raspberrypi` or your hostname), or:

```bash
arp -a | grep -i raspberrypi
```

Use the IP directly: `ping -c 3 <ip>`.

Once ping works, SSH in:

```bash
ssh pi@sunset-cam-N.local
```

(Or `ssh pi@<ip>` if you needed the IP.) Once you see `pi@sunset-cam-N:~ $`, you're in.

### 2.2. MPU stack — 30-second visual inspection

**Before powering on**, eyeball check:

- All 4 solder joints **shiny and tear-drop-shaped**, not dull or globby. Cold joints are the #1 cause of intermittent I2C failures.
- **No solder bridges** between adjacent Pi pins (especially pin 1↔pin 3 — would short 3.3V to SDA and possibly fry the MPU).
- MPU's **VCC wire goes to Pi pin 1 (3.3V)**, NOT pin 2 (5V). Pin 1 is the corner of the GPIO header, closest to the microSD slot.
- **GND wire goes to Pi pin 9**, not pin 6.
- The 4 wires aren't pressing against anything that could short them.

If anything looks sketchy, fix it before powering on. A cold joint that survives the eyeball check will reveal itself when `i2cdetect` returns no devices.

### 2.3. Phone/laptop on the same WiFi

Find the Pi's IP — easier than dealing with `.local` resolution on phones. On the Pi (SSH'd in):

```bash
hostname -I
```

You'll get something like `192.168.1.42 fe80::...`. The first token (the IPv4) is what you want. Write it down — call it `PI_IP`.

From your phone's browser, open:

```
http://<PI_IP>/
```


| If you see...         | What it means                                                                                |
| --------------------- | -------------------------------------------------------------------------------------------- |
| A page or 404         | ✅ Phone reaches Pi. Same network confirmed.                                                  |
| Browser hangs forever | Phone is on a different WiFi, OR firmware web server not on port 80. Try `:8000` or `:5000`. |


If hangs persistently: confirm phone WiFi network name = Pi WiFi network name. Check on Pi:

```bash
iwgetid -r
```

Make sure your phone's WiFi matches.

### 2.4. Image viewing path — get SCP working now

Easier to debug this before you need it. On the Pi:

```bash
~/sunset-cam-firmware/scripts/snap-now.sh
```

Read the output — it'll print where it saved. Something like:

```
saved: /home/pi/snaps/snap-20260529-103045.jpg
```

Copy that exact path. From your **Mac terminal** (open a new tab, leave SSH alive):

```bash
scp pi@sunset-cam-N.local:/home/pi/snaps/snap-20260529-103045.jpg ~/Desktop/snap.jpg
```

(Replace the path with what `snap-now.sh` actually printed and the hostname.)

Open `~/Desktop/snap.jpg` on your Mac — you should see whatever the camera is currently looking at.

This gives you:

- ✅ Confirms the SCP workflow works (you'll reuse this in Part 3).
- ✅ A baseline snapshot for comparing orientation later.

---

## Part 3 — MPU bringup tests

Now the actual MPU work. This part takes ~20 minutes once the camera is physically mounted.

### 3.1. Confirm I2C is on (sanity check)

```bash
sudo raspi-config nonint get_i2c
```

Should print `0`. If it prints `1`, run `sudo raspi-config nonint do_i2c 0` then `sudo reboot` and reconnect.

### 3.2. Confirm the Pi sees the MPU

```bash
sudo i2cdetect -y 1
```

You should see a grid like:

```
     0  1  2  3  4  5  6  7  8  9  a  b  c  d  e  f
00:                         -- -- -- -- -- -- -- --
10: -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- --
...
60: -- -- -- -- -- -- -- -- 68 -- -- -- -- -- -- --
70: -- -- -- -- -- -- -- --
```

**The key thing: `68` at row `60`, column `8`.** That's the MPU6050 answering on its default I2C address (0x68).


| What you see        | What it means                   | What to do                                                       |
| ------------------- | ------------------------------- | ---------------------------------------------------------------- |
| `68` appears        | ✅ Wiring is right, MPU is alive | Continue to next step                                            |
| All dashes, no `68` | Wiring problem                  | Check VCC/GND/SDA/SCL — most common error is SDA and SCL swapped |
| Multiple addresses  | Something else is on the bus    | Probably fine if `68` is one of them                             |


### 3.3. Confirm the chip identifies itself

```bash
python3 -c "import smbus2; b=smbus2.SMBus(1); print('WHO_AM_I:', hex(b.read_byte_data(0x68, 0x75)))"
```

Expected: `WHO_AM_I: 0x68`. This reads the MPU6050's identity register; a real MPU6050 reports its own address back.

If 3.2 and 3.3 both pass, **the hardware install is done.** Everything from here is software.

### 3.4. Get live orientation readings

```bash
cd ~/sunset-cam-firmware
```

```bash
python3
```

You're now at the Python `>>>` prompt. Paste each of these one at a time:

```python
from sunset_cam.gyro_driver import read_orientation
```

```python
import time
```

```python
for _ in range(120): print(read_orientation()); time.sleep(0.5)
```

That'll print `(roll_deg, pitch_deg)` twice a second for 60 seconds. You should see numbers like `(2.3, -1.1)` (small values if the Pi is sitting flat).

**Wiggle the Pi while it's printing.** Roll/pitch should change in real time. If they're frozen or random — bad wiring or sensor not awake. If they respond — you're cleared for the observation protocol.

Ctrl-C to stop the loop early.

### 3.5. Mount the camera (if you haven't already)

If you haven't already physically stacked the Arducam on top of the MPU, do that now. Mount the camera in whatever orientation makes the silkscreen text right-side-up when the Pi is in its intended mounted position (portrait, power cable hanging down).

### 3.6. Take a snapshot and confirm image orientation

Restart the camera snapshot path now that the camera is mounted:

```bash
~/sunset-cam-firmware/scripts/snap-now.sh
```

Note the new path it printed. Then from your Mac terminal:

```bash
scp pi@sunset-cam-N.local:<that-new-path> ~/Desktop/snap-mounted.jpg
```

Open the file. Two questions:

1. **Is the image right-side-up?** (Sky on top, ground on bottom.)
2. **Is it landscape orientation?** (Wider than tall.)


| Result      | What it means               | Action                                                                        |
| ----------- | --------------------------- | ----------------------------------------------------------------------------- |
| Yes + Yes   | Camera mounted right        | Continue to 3.7                                                               |
| Rotated 90° | Camera is sideways in stack | Either physically rotate, or set `picamera2` rotation flag in firmware config |
| Upside down | Camera is upside-down       | Same fix options                                                              |


### 3.7. Run the 6-position observation

Back in the Pi SSH session, restart the live readings:

```bash
cd ~/sunset-cam-firmware
```

```bash
python3
```

```python
from sunset_cam.gyro_driver import read_orientation
```

```python
import time
```

```python
for _ in range(240): print(read_orientation()); time.sleep(0.5)
```

That gives you 120 seconds. Hold the Pi+camera assembly in each of these 6 positions for ~5 seconds. **Write down what you see in each.**


| #     | Position                                                                                                                     | What you should write down |
| ----- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| **A** | Camera lens pointing out window, image-top toward sky, power cable hanging straight down (the **intended mounted position**) | `roll = __, pitch = __`    |
| **B** | Rotated 90° clockwise around the lens axis (image-top points world-right)                                                    | `roll = __, pitch = __`    |
| **C** | Upside down (180° around lens axis from A)                                                                                   | `roll = __, pitch = __`    |
| **D** | Rotated 90° counterclockwise from A                                                                                          | `roll = __, pitch = __`    |
| **E** | Image-top tipped FORWARD (camera nods down toward ground)                                                                    | `roll = __, pitch = __`    |
| **F** | Image-top tipped BACK (camera looks up at ceiling)                                                                           | `roll = __, pitch = __`    |


If you can hold it steady for a few seconds in each, that's enough. Doesn't need to be perfect.

Ctrl-C when done. `exit()` to leave Python.

---

## Part 4 — What to send back

Paste the following back to Claude:

1. **The six observed `(roll, pitch)` readings** from step 3.7.
2. **Snapshot orientation result** from step 3.6 (right-side-up + landscape: yes/no/which way wrong).
3. **Anything that failed** — which step + what error you got.

With the six readings, Claude can write the exact firmware patch — typically a 4-line change in `gyro_driver.py` swapping which axis is treated as "up." Single commit, no rerunning the bringup.

---

## Troubleshooting cheat sheet

### "Cannot resolve hostname"

mDNS issue. Find the IP via router admin page or `arp -a` on Mac, then use the IP directly.

### `i2cdetect` shows no devices

Most common causes, in order of likelihood:

1. **SDA and SCL swapped.** Pin 3 (GPIO 2) is SDA. Pin 5 (GPIO 3) is SCL.
2. **Cold solder joint** on one of the 4 wires. Reflow it.
3. **I2C not enabled.** Run `sudo raspi-config nonint do_i2c 0` then reboot.
4. **MPU dead.** If you're confident about wiring + I2C, swap in a different MPU module.

### `WHO_AM_I` returns something other than `0x68`

Possibilities:

- Returns `0x00` or `0xFF` — sensor not responding properly, check power
- Returns something else (e.g., `0x71`) — might be a different chip (some "MPU6050" boards are actually MPU9250 or similar); check the chip markings

### Live readings are frozen / always 0 / random

- **Frozen at 0:** sensor not initialized. The first read should auto-wake it; if not, may need to call `gyro_driver.init_sensor()` first (check `gyro_driver.py` for the right call).
- **Random / wildly changing:** bad ground connection. Re-check the GND wire to Pi pin 9.

### `snap-now.sh` errors with "no camera" / `rpicam-hello --list-cameras` says "No cameras available!"

**First, check `dmesg | grep -iE 'imx708|csi|unicam'` — the output tells you which way to go:**

- **Total silence (no imx708 line at all):** this is almost always the **Arducam auto-detect problem**, not wiring. `camera_auto_detect` can't identify the Arducam's blank EEPROM. Apply the explicit `dtoverlay=imx708` fix from step 1.6 and reboot. (See `docs/solutions/integration-issues/arducam-imx708-not-detected-on-pi-zero.md`.) **Don't start swapping cables — that wastes time.**
- **`imx708 ...: failed to read chip id` / `-EIO` / i2c timeout:** *now* it's physical. The driver is loaded but the sensor isn't answering — reseat/flip the ribbon or suspect a dead module.

Other causes, once the overlay is correctly set:

- Camera not enabled: `sudo raspi-config nonint do_camera 0` then reboot
- Wrong cable for the connector: Pi Zero 2 W + Arducam IMX708 are both **22-pin (0.5 mm)** → use the **22-to-22** cable; a 15-pin cable won't mate. Full-size Pi 3/4 is 15-pin → use the **15-to-22** cable.
- Ribbon orientation: contacts (gold) face the board at **both** ends; blue stiffener faces the latch.
- Camera not seated properly — open the latch, reinsert ribbon, close latch firmly
- **Note:** runtime `sudo dtoverlay imx708` failing with `Failed to apply overlay (kernel)` is **expected** — camera overlays only apply at boot. It is not a hardware signal.

### Firmware service won't start

Check logs:

```bash
journalctl -u sunset-cam.service -n 100
```

Common issues:

- `config.json` not at `~/sunset-cam-firmware/config/config.json` — check path
- `config.json` has invalid JSON — paste into a JSON validator
- Claim code expired — mint a new one
- I2C or camera not enabled — see above

