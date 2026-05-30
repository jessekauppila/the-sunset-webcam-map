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

> ### Streamlined path (recommended for unit #2 and onward)
>
> The firmware repo already has `scripts/install.sh` that collapses steps 1.4–1.8 + 1.10 into one command. As of `sunset-cam-firmware` PR #3 it also enables I2C and installs `i2c-tools` automatically. Per-unit workflow becomes:
>
> 1. **On Mac:** mint a claim code via `/api/admin/claim-codes` (per step 1.9 below — save the returned code).
> 2. **Flash SD card** with Pi Imager (per step 1.1 — set hostname, WiFi, SSH credentials in advanced settings).
> 3. **Boot the Pi, SSH in** (per steps 1.2–1.3).
> 4. **Clone the repo and run install.sh:**
>    ```bash
>    sudo git clone https://github.com/jessekauppila/sunset-cam-firmware.git /opt/sunset-cam
>    ```
>    ```bash
>    sudo bash /opt/sunset-cam/scripts/install.sh
>    ```
> 5. **Create `config.json`** at `/opt/sunset-cam/config/config.json` with your minted claim code (per step 1.9 below).
> 6. **Physically connect the MPU + camera.**
> 7. **Enable + start the service:**
>    ```bash
>    sudo systemctl enable --now sunset-cam
>    ```
> 8. **Reboot once:** `sudo reboot`
>
> Per-unit time drops from ~30 minutes to ~5 minutes of active work. The manual steps below (1.4–1.10) document what `install.sh` does, useful for debugging if the script ever fails.

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

### 1.7. Clone the firmware repo

```bash
git clone https://github.com/jessekauppila/sunset-cam-firmware.git ~/sunset-cam-firmware
```

### 1.8. Install firmware as a Python package

```bash
cd ~/sunset-cam-firmware
```

```bash
python3 -m pip install -e ".[dev]"
```

Installs the firmware (and its dependencies including `smbus2` for the MPU6050) in editable mode. Wait ~2 minutes.

If you get `error: externally-managed-environment`, run instead:

```bash
python3 -m pip install -e ".[dev]" --break-system-packages
```

(Pi OS Bookworm restricts pip by default; the `--break-system-packages` flag is the workaround for system-wide installs.)

### 1.9. Create the device config

Mint a claim code first (from your Mac, not the Pi — needs `CRON_SECRET`):

```bash
export CRON_SECRET="$(grep '^CRON_SECRET=' .env.production.local | cut -d= -f2- | tr -d '"')"
```

```bash
curl -sS -X POST https://sunsetsunset.studio/api/admin/claim-codes -H "authorization: Bearer $CRON_SECRET" -H "content-type: application/json" -d '{"label":"sunset-cam-N-install"}'
```

(Replace `N`. Adjust hostname `sunsetsunset.studio` if your deploy URL differs.)

You'll get `{"code":"SUNSET-XXXX-YYYY","expires_at":"..."}`. Save the code.

Back on the Pi (SSH session), create the config file:

```bash
mkdir -p ~/sunset-cam-firmware/config
```

```bash
nano ~/sunset-cam-firmware/config/config.json
```

Paste this content (substituting your claim code + your install location):

```json
{
  "claim_code": "SUNSET-XXXX-YYYY",
  "lat": 48.7519,
  "lng": -122.4787,
  "elevation_m": 30,
  "timezone": "America/Los_Angeles",
  "placement": {
    "azimuth_deg": 270,
    "tilt_deg": 5,
    "horizon_altitude_deg": 2.5
  },
  "phase_preference": "sunset"
}
```

(`Ctrl-O` then `Enter` to save in nano, `Ctrl-X` to exit. The lat/lng above is for Bellingham — change to your actual install spot.)

### 1.10. Install the systemd service

> **Doing this before the MPU or camera is physically connected?** Run only the first two commands (the `cp` + `daemon-reload`) — they just register the unit file with systemd. **Skip** `enable` and `start` until the hardware is in; without a camera the firmware will fail-loop on missing devices. When the camera arrives, come back and run:
>
> ```bash
> sudo systemctl enable sunset-cam.service
> ```
>
> ```bash
> sudo systemctl start sunset-cam.service
> ```
>
> Then verify with `systemctl status sunset-cam.service`. Otherwise, run all four commands below in order.

```bash
sudo cp ~/sunset-cam-firmware/systemd/sunset-cam.service /etc/systemd/system/
```

```bash
sudo systemctl daemon-reload
```

```bash
sudo systemctl enable sunset-cam.service
```

```bash
sudo systemctl start sunset-cam.service
```

Check it's running:

```bash
systemctl status sunset-cam.service
```

You should see "active (running)" in green. Press `q` to exit.

If it failed: check logs with `journalctl -u sunset-cam.service -n 50`.

### 1.11. Reboot once

```bash
sudo reboot
```

Wait ~30 seconds. SSH back in. Firmware should now be running.

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

### `snap-now.sh` errors with "no camera"

- Camera not enabled: `sudo raspi-config nonint do_camera 0` then reboot
- Ribbon cable inserted backward — the blue side should face away from the SoC on the Pi end
- Camera not seated properly — open the latch, reinsert ribbon, close latch firmly

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

