# MPU6050 + Camera Hardware Bringup — Checkpoint

Date: 2026-05-31
Pi unit: `sunset-cam-1` (the FIRST production-deployment unit; the test unit `sunset-cam-0` has been running since 2026-05-15)

---

## TL;DR — resume here

You're mid-install on a new Pi (`sunset-cam-1`) bringing up the MPU6050 + Arducam IMX708 stack. **Software install is done through step 1.10** of `2026-05-29-pi-mpu6050-install-and-bringup-guide.md`. The CSI ribbon cable is in transit; once it arrives, plug in the camera, finish step 1.9 (write `config.json` with a freshly-minted claim code), enable + start the systemd service, then run the **Part 3 bringup tests** (i2cdetect → WHO_AM_I → live readings → 6-position protocol → snapshot). Paste the six (roll, pitch) readings back and I'll write the `gyro_driver.py` patch.

## Decisions locked

- **MPU orientation: X-down.** The wiring forced it; don't rewire. The firmware will be patched to match observed behavior, not the other way around.
- **Camera: Arducam IMX708 Autofocus** (per sub-project C v0.3 spec).
- **MPU mount: stacked face-to-face with the Pi** (Pi → MPU → camera, all parallel) for lowest profile. MPU is glued/foam-taped to the back of the Pi or the enclosure floor.
- **Pi physical orientation: portrait (long axis vertical) with the power cable hanging down.** Camera ribbon connector on the bottom edge of the captured image.

## What's done as of this checkpoint

- [x] Cloud-side custom-cam visibility fix shipped and deployed (PR #11 + #12 + radius fix in #12)
- [x] Cloud wizard skeleton at `/setup/[claim_code]` (PR #21)
- [x] Sub-project C iterated to v0.3 (`docs/superpowers/specs/2026-05-17-pi-alignment-v0.3-sun-self-calibration-design.md`)
- [x] Pi-side alignment-tool firmware Tasks 1–7 in `sunset-cam-firmware` (`gyro_driver.py`, `orientation_sampler.py`, `solstice_math.py`, `setup_alignment.py` all built and unit-tested)
- [x] Physical MPU6050 soldered to Pi GPIO holes 1/3/5/9 with X-down orientation
- [x] Install guide written: `docs/hardware/2026-05-29-pi-mpu6050-install-and-bringup-guide.md`
- [x] Streamlined install path: `sunset-cam-firmware` `scripts/install.sh` extended with I2C enable + `i2c-tools` (PR #3 on the firmware repo)
- [x] sunset-cam-1 walked through guide steps 1.1–1.5 (SD card flash, boot, SSH, apt update, apt deps)
- [x] sunset-cam-1 step 1.6 (raspi-config: enable I2C + camera)
- [x] sunset-cam-1 step 1.7 (git clone the firmware repo)
- [x] sunset-cam-1 step 1.8 (`pip install -e ".[dev]" --break-system-packages`)
- [x] sunset-cam-1 step 1.10 modified (only `cp` + `daemon-reload` ran — service registered, NOT enabled, NOT started)

## What's still in flight — pick up here

### Hardware-blocked (waiting for the new CSI ribbon cable)

- [ ] Physically connect the Arducam IMX708 to the Pi via the new CSI cable
- [ ] Mount the camera face-to-face on top of the MPU (silkscreen-up orientation so the captured image will be right-side-up)
- [ ] Mint a claim code from the Mac:
  ```bash
  export CRON_SECRET="$(grep '^CRON_SECRET=' .env.production.local | cut -d= -f2- | tr -d '"')"
  ```
  ```bash
  curl -sS -X POST https://sunrisesunset.studio/api/admin/claim-codes -H "authorization: Bearer $CRON_SECRET" -H "content-type: application/json" -d '{"label":"sunset-cam-1-install"}'
  ```
  Save the returned `code`.

### On-Pi steps after hardware is connected

- [ ] Step 1.9 — write `config.json`:
  ```bash
  ssh pi@sunset-cam-1.local
  ```
  ```bash
  mkdir -p ~/sunset-cam-firmware/config
  ```
  ```bash
  nano ~/sunset-cam-firmware/config/config.json
  ```
  Paste the JSON template from the install guide (replace `claim_code` + adjust lat/lng for the actual install location).

- [ ] Enable + start the service:
  ```bash
  sudo systemctl enable sunset-cam.service
  ```
  ```bash
  sudo systemctl start sunset-cam.service
  ```
  ```bash
  systemctl status sunset-cam.service
  ```

- [ ] Reboot:
  ```bash
  sudo reboot
  ```

### Then run Part 3 bringup tests

Following `docs/hardware/2026-05-29-pi-mpu6050-install-and-bringup-guide.md`:

- [ ] 3.1 confirm I2C is on (`sudo raspi-config nonint get_i2c` → `0`)
- [ ] 3.2 `sudo i2cdetect -y 1` → expect `68` at row 60, column 8
- [ ] 3.3 `python3 -c "import smbus2; b=smbus2.SMBus(1); print('WHO_AM_I:', hex(b.read_byte_data(0x68, 0x75)))"` → expect `0x68`
- [ ] 3.4 live orientation readings via interactive Python loop — confirm values respond to motion
- [ ] 3.5 mount the camera physically (already done above)
- [ ] 3.6 capture a snapshot with `snap-now.sh`, `scp` to Mac, confirm right-side-up + landscape
- [ ] 3.7 the **6-position observation** — write down (roll, pitch) for each position A–F

### Then send Claude the data

Paste back:

1. The six (roll, pitch) readings
2. Snapshot orientation result (right-side-up + landscape: yes/no/which way wrong)
3. Anything that failed

Claude will write a `gyro_driver.py` patch that maps MPU's X-down orientation to the correct world frame. Expected: a 4-line `atan2()` argument swap. One commit on the firmware repo.

## Open PRs that may affect the next session

- **`sunset-cam-firmware` PR #3** — `scripts/install.sh` enables I2C + installs `i2c-tools` for future units. Doesn't affect sunset-cam-1 (already past those steps manually). Merge whenever.
  - https://github.com/jessekauppila/sunset-cam-firmware/pull/3

- **`the-sunset-webcam-map` PR #23** — the install + bringup guide itself. If it gets merged before the next session, the guide lives on main. If not, it's on the `docs/pi-mpu6050-install-guide` branch.
  - https://github.com/jessekauppila/the-sunset-webcam-map/pull/23

## Reference docs (in this repo)

| Doc | Purpose |
|---|---|
| `docs/hardware/2026-05-29-pi-mpu6050-install-and-bringup-guide.md` | The full install + bringup walkthrough you're following |
| `docs/hardware/2026-05-17-housing-up-arrow-and-mpu6050.md` | Hardware spec stub (BOM + wiring) |
| `docs/superpowers/specs/2026-05-17-pi-alignment-v0.3-sun-self-calibration-design.md` | Sub-project C current design (v0.3) |
| `docs/superpowers/specs/2026-05-17-pi-side-alignment-tool-design.md` | Sub-project C v0.2 (the firmware-side tool design) |
| `docs/superpowers/plans/2026-05-17-pi-side-alignment-tool.md` | The plan for the firmware tasks (1–7 done) |
| `docs/superpowers/specs/2026-05-15-streamlined-deployment-overview.md` | The umbrella project status |

## Repos involved

| Repo | Path | Role |
|---|---|---|
| `the-sunset-webcam-map` | `~/GitHub/the-sunset-webcam-map` | Cloud / web-app side, docs, specs |
| `sunset-cam-firmware` | `~/GitHub/sunset-cam-firmware` | Pi-side Python firmware |

## How to resume with Claude next session

Open Claude Code from `~/GitHub/the-sunset-webcam-map`, then say something like:

> "Pick up the MPU6050 bringup on sunset-cam-1. Read the checkpoint at `docs/hardware/2026-05-31-mpu6050-bringup-checkpoint.md`."

Claude will pull the project memory (which knows the resume protocol) and walk through the "What's still in flight" checklist.
