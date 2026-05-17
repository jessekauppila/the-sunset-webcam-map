# Housing UP-Arrow Marker + MPU6050 BOM Addition — Hardware Stub

Status: Stub — 2026-05-17
Owner: Jesse Kauppila
Triggered by: software spec `docs/superpowers/specs/2026-05-17-pi-side-alignment-tool-design.md` (v0.2)

## What

Two hardware changes tracked here:

1. **UP marker on the housing.** Sharpie ↑ arrow on the case for v1 (acceptable). Future: molded/etched ↑ as part of the STL.
2. **MPU6050 / GY-521 IMU module** wired to the Pi via I2C. New BOM line item.

## Requirements (UP marker)

- Top-center of the front face, ≥3mm above the lens cutout, ≥3mm from the top edge
- Relief or recess, 8–12mm tall, depth/height ≥0.4mm for weather resistance
- v1: Sharpie applied during operator prep (accepts weathering risk; trivial to redo)

## Requirements (MPU6050)

- Part: MPU6050 / GY-521 breakout board ($3–8 single, ~$2/unit in bulk)
- Pi Zero 2 W wiring: SDA→GPIO 2 (pin 3), SCL→GPIO 3 (pin 5), VCC→3.3V (pin 1), GND→GND (pin 9)
- ESP32 wiring: SDA→GPIO 21, SCL→GPIO 22, same 3.3V + GND
- I2C must be enabled in `raspi-config`
- Soldering or hammer-header kit required for Pi Zero 2 W (non-WH variant)
- Physical mount: needs to be rigidly fixed to the camera body so its gravity vector matches the camera's

## Becomes a real spec when

Units acquired, soldered onto a test Pi, software (this plan's output) verified to read live values. At that point the hardware spec graduates from stub to "production assembly procedure."
