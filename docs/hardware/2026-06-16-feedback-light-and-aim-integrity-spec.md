# Feedback, Light & Aim-Integrity Spec

**Date:** 2026-06-16
**Status:** 🚩 Spec captured — **flagged for further pursuit** (not yet built). See "Open / next" (§11) and the repo flags at the bottom.

> **Resume note (2026-07-29):** Committing this so it's saved — **parked, want to come back to it.**
> Nothing here is built yet; it's a captured spec, not in-flight work. When you pick it back up,
> start at the "Status flags for tracking" section (5 workstreams) and resolve the two open
> questions first: (1) where `one-light-sim.html` lives — it's referenced as the source of truth
> for §3–§5 but isn't in this repo, and (2) the camera conflict — this buy list names the Arducam
> IMX708, but `2026-06-15-camera-hardware-decision.md` chose the Pi Camera Module 3 Wide (FOV +
> HDR). The spec is otherwise left as-authored.
**Build stage:** moving from bare-bones prototypes → **2 representative units, then ~10**, all
working prototypes meant to look and behave like the long-term product. A custom board is the
eventual direction but **way off** — this buy list is for the prototype run, branded breakouts
and all.

> Consolidated spec for the status light, the IMU/aim subsystem, and the prototype buy list.
> Values match `one-light-sim.html`; keep the two in sync. **Note:** `one-light-sim.html` is a
> separate prototyping artifact and is **not yet checked into this repo** — bringing it in (or
> linking it) is one of the open items below.

---

## 1. Scope & philosophy

The device sits in a window and captures **only around sunrise and sunset**; it idles the rest
of the day with a cloud heartbeat running. It shows nothing visible where it's installed, so it
needs feedback to prove it's working — but the owner hates bright LEDs and it must not become a
nuisance, especially at night. Design spine = **calm technology**: the light lives in the
periphery, dark by default, moving to the center only when something's wrong.

Because the camera is off most of the day, the light language and IMU can be bench-tested any
time in daylight without touching a capture window.

**Commitments**
- **One user-facing light.** Color = state class, rhythm = which signal, brightness = the model.
- **Closed color vocabulary.** Amber + green = healthy; **red = fault, and only fault.**
- **Dark resting state**, eased motion (fades/breaths, never hard blinks), **gamma-corrected** dimming.
- **Looks finished.** Soldered pixel behind a diffuser, properly mounted — no exposed strip.
- **Cheap now.** Branded breakouts for reliable prototypes; defer the bare-chip board.

---

## 2. Hardware — the one light

- **Pixel:** Adafruit **DotStar 5050 (SK9822)** — PID **2343**, 10-pack $4.50. SK9822 is the
  APA102-compatible part with cleaner low-brightness/anti-flicker behavior, which is where this
  device lives. Soldered (not a strip) for a finished look.
- **Carrier:** Adafruit **5050 LED breakout PCB** — PID **1762**, 10-pack $4.95. Adafruit
  recommends this exact breakout for the 5050 DotStars; you reflow/iron the SK9822 onto it
  (small SMT step) and it hands you 0.1" pads for wiring. **2343 + 1762 is the correct pairing.**
- **Level shift:** Adafruit **74AHCT125** — PID **1787**, ~$1.50. Buffers the Pi's 3.3V data +
  clock up to 5V. Belt-and-suspenders for one short-run SK9822, but cheap insurance and keeps the
  10-unit run consistent.
- **Bus:** Pi hardware SPI0 — data → MOSI (GPIO10, pin 19), clock → SCLK (GPIO11, pin 23), +5V, GND.
- **Diffusion:** recess the pixel behind frosted/opal acrylic so it reads as a soft ember, not a dot.
- **Drive:** `adafruit-circuitpython-dotstar` or raw `spidev`; all brightness through a **gamma 2.2 LUT**.

**Pi onboard LED:** internal bench-only boot indicator (green-only; can't carry red-fault). Not
part of the user-facing language.

### Is that all for the light?
The three parts above (2343 / 1762 / 1787) are the active electronics. For a *working, mounted,
nice* pixel you also need the connective + mounting bits (see §6 buy list): hookup wire, header
pins, a ~1µF decoupling cap across the pixel, a diffuser, standoffs/bezel to mount it, and a
small proto board to give the 74AHCT125 a tidy home instead of dangling.

---

## 3. Brightness model

```
peak = ceiling × dial × ambient × weight        →  gamma(2.2)  →  shown
```

| Term      | Value / source |
|-----------|----------------|
| ceiling   | 0.85 (hard cap) |
| dial      | 0..1, owner-set "how dim" |
| ambient   | `0.12 + 0.88 × smoothstep(sun)`; ~1.0 day, ~0.12 deep night |
| weight    | per-signal (§4) |
| bench mode| overrides dial & ambient to 1.0 for testing |
| faults    | floor: `max(globalMul, 0.42)` |

At night, warm the green idle toward amber and prefer breaths over blinks.

---

## 4. The light language

| Event              | Color | Rhythm (on/off ms)                    | Weight | Notes |
|--------------------|-------|---------------------------------------|--------|-------|
| Idle / "still here"| warm green→amber | 140 / 7600, loop           | 0.30   | only resting presence; runs all day incl. cloud heartbeat |
| Handshake — call   | amber | 95,95 + 500 (da-da-dummm)             | 0.46   | "asking" — power-on or QR scan |
| Handshake — answer | green | 85,85 + 300 (da-da-dum)               | 0.50   | camera detected + sensor read clean |
| Streaming          | green | 80 / 3000, loop                       | 0.34   | only during sunrise/sunset capture |
| Sunset upload done | amber | fade 1000 / 600 / 1500                | 0.70   | warmest, proudest moment |
| Button press       | green | fade 70 / 110 / 300                   | 0.80   | one bright confirm |

Handshake = call-and-response on one light: amber (asking) settles to green (camera + IMU in);
a broken answer comes back red.

---

## 5. Fault blink-codes (red only)

| Fault              | Rhythm                                   | Meaning |
|--------------------|------------------------------------------|---------|
| Power loss         | dark                                      | most legible failure |
| Cloud unreachable  | slow soft breath (~2.6 s)                 | gentle — frames buffer locally |
| Camera not detected| red double-blink (150,150 / 1100 off)     | green answer never comes; check CSI ribbon |
| Sensor fault       | fast red stutter (70/80 ×3, 520 off)      | I2C reached IMU but no valid data |

---

## 6. Buy list (prototype run — Adafruit unless noted; ~USD, verify at order)

### Per-unit
| Item | PID | ~Each | ×2 units | ×10 units | Notes |
|------|-----|-------|----------|-----------|-------|
| DotStar 5050 SK9822 (10-pk) | 2343 | $4.50/pk | 1 pk | 1–2 pk | 1 pixel/unit; extra pk for SMT solder spares on the 10-run |
| 5050 LED breakout PCB (10-pk) | 1762 | $4.95/pk | 1 pk | 1 pk | covers 10 units |
| 74AHCT125 level shifter | 1787 | $1.50 | 2 | 10 | one per unit |
| **IMU: Adafruit MPU-6050 (STEMMA QT)** | 3886 | ~$5 | 2 | 10 | the cheap-now pick (see §7) |
| STEMMA QT cable, **female sockets**, 150mm | 4397 | $0.95 | 2 | 10 | plugs onto Pi GPIO pins; **same cable works for the LSM6DSOX too** |
| Raspberry Pi Zero 2 W | — | ~$15 | 2 | 10 | prototype compute |
| Arducam IMX708 AF camera (incl. case) | — | ~$35 | 2 | 10 | unchanged |

### Mounting & assembly (shared consumables — "everything to mount it")
| Item | ~Cost | Notes |
|------|-------|-------|
| Frosted/opal acrylic offcut | ~$6–10 | cut small diffuser discs for the ember look |
| M2.5 nylon standoff/screw kit | ~$10 | mount Pi + breakout PCB + bezel |
| Silicone stranded hookup wire (26–30 AWG, few colors) | ~$10 | pixel ↔ shifter ↔ Pi |
| 0.1" header pin strips | ~$4 | for the 5050 breakout + proto board |
| 1µF ceramic caps (small bag) | ~$3 | decoupling across pixel + shifter power |
| Small Perma-Proto / perfboard (per unit) | ~$3–5 ea | tidy home for the 74AHCT125 |

**No strip, no runner-up bi-color** — both dropped per the finished-prototype direction.

---

## 7. IMU part choice — cheap now, easy swap later

| | **MPU-6050 (PID 3886, ~$5) — chosen for now** | **LSM6DSOX (PID 4438, ~$12) — later** |
|---|---|---|
| Cost | cheapest branded | ~$7 more |
| Accuracy | noisier/more drift (fine for level + bump) | lower noise, steadier tilt |
| Smart features | none — host polls | on-chip wake-on-motion, FSM/ML core |
| Power fit | irrelevant here (mains + idle, Pi awake anyway) | nicety, not needed here |
| Longevity | ~2012, EOL-ish (matters only at custom-board stage) | current part |
| Familiarity | same chip as your GY-521s; code carries over | well-supported, slightly newer |

**Decision:** start on the **MPU-6050 (3886)** for the prototype run — cheapest, and you already
know the chip. **Do NOT buy the LSM6DSOX 9-DoF (#4517)** — it adds a magnetometer you don't want.

### How big a deal is swapping MPU-6050 → LSM6DSOX later?
**Small, and software-only.**
- **Mechanically/electrically: zero change.** Both are STEMMA QT I2C breakouts with the *same*
  connector and pinout, so the **same #4397 cable and the same mount** carry over. The INT pin is
  present on both for the wake/bump line.
- **Firmware: a contained change.** Different I2C address (MPU 0x68/0x69 vs LSM6DSOX 0x6A/0x6B),
  different driver library (`adafruit_mpu6050` → `adafruit_lsm6ds.lsm6dsox`), different config for
  ranges/ODR and the richer LSM6DSOX wake-on-motion, then re-tune bump thresholds.
- **Mitigation:** write a thin IMU abstraction now — e.g. `read_tilt()`, `read_motion()`,
  `on_bump(cb)` — so the rest of the firmware never names the chip. Then the swap is one module
  plus threshold re-tuning, roughly an afternoon. Starting cheap costs you almost nothing later.

---

## 8. Aim-integrity subsystem

**Two layers — *IMU triggers, sun confirms*.**
1. **Authoritative aim truth = camera + sun ephemeris** (needs the sun visible).
2. **Always-on watchdog = IMU (6-DoF):** accel → gravity → absolute level/tilt; gyro → bump.
   Works day or night. Bonus: gravity gives the camera "down," improving the sun-solve.

IMU does **not** compute bearing — that's camera + location + time. No magnetometer.

**Timing (fits the duty cycle).** Capture runs only at sunrise/sunset. **Sun-recalibration is
decoupled from capture** — run it opportunistically any time the sun is usable (e.g. midday
idle), so aim is verified without spending a capture window. The IMU watchdog runs continuously;
on a bump → raise the "moved" signal, queue an opportunistic sun re-check. **INT pin → Pi GPIO**
doubles as the LINK "answer" proof and the disturbance trigger.

---

## 9. Custom board — future direction (way off)

Eventually a custom PCB ("only what we need"), likely on a Raspberry Pi **Compute Module
(CM4/CM5)** carrier. At that stage every breakout becomes a **bare chip** placed directly:
removes the breakout premium, the level-shifter line, the STEMMA cable, and the onboard-LED
concern; makes **part longevity** the priority (→ a current bare IMU, not the EOL MPU-6050); and
turns the light into a bare SK9822 (~$0.10–0.30). The cost endgame is cheaper, not more
expensive. Not in scope for the current prototype run.

---

## 10. Cost note

Camera (~$35) + Pi (~$15) dominate every unit; everything else is a few dollars. Per representative
unit you're around **$60–65 in major parts** (camera + Pi + MPU-6050 + light + cable + shifter),
plus a shared pool of mounting consumables (~$35–45 total for the run). The MPU-6050 keeps the IMU
line at ~$5; the LSM6DSOX swap later adds ~$7/unit only if/when you choose it.

---

## 11. Open / next

- `one-light-sim.html` covers §3–§5. Not yet: the §8 disturbance flow (bump → "moved" → queued
  re-check) and decoupled daytime recalibration.
- Firmware: gamma LUT, SK9822 driver, camera-detect → handshake, **thin IMU abstraction** (so the
  later LSM6DSOX swap is one module), IMU INT wiring + bump logic.
- **Repo housekeeping:** `one-light-sim.html` is referenced throughout but not yet in this repo —
  decide whether it lives here (and link it) or stays in the firmware repo, then keep this spec
  and the sim in sync.

---

## Status flags for tracking

This spec is **captured but not yet executed**. Concrete pursuable workstreams:

1. **Prototype buy** — place the §6 Adafruit/Pi order for the 2-unit representative run.
2. **Light firmware** — gamma 2.2 LUT + SK9822/DotStar driver over SPI0; implement the §4 light
   language and §5 fault blink-codes; wire to the §3 brightness model.
3. **IMU abstraction** — thin `read_tilt()` / `read_motion()` / `on_bump(cb)` layer on the
   MPU-6050 so the later LSM6DSOX swap is one module (§7).
4. **Aim-integrity** — IMU watchdog + INT→GPIO bump trigger; decouple sun-recalibration from the
   capture window (§8).
5. **Sim sync** — resolve the `one-light-sim.html` location question and keep it aligned with §3–§5.

Related hardware records: `2026-06-15-camera-hardware-decision.md` (Module 3 Wide + central
scoring), `2026-05-29-pi-mpu6050-install-and-bringup-guide.md` (MPU-6050 bring-up).
