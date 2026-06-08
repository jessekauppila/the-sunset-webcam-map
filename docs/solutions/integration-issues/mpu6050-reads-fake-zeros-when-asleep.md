---
title: MPU6050 reads a fake (0.0, 0.0) orientation — sensor never woken from SLEEP
date: 2026-06-07
category: docs/solutions/integration-issues
module: pi-firmware-gyro
problem_type: integration_issue
component: tooling
symptoms:
  - "read_orientation() returns a suspiciously perfect (0.0, -0.0) on every sample, with no jitter"
  - "accel raw block reads [0, 0, 0, 0, 0, 0]"
  - "PWR_MGMT_1 (register 0x6B) reads 0x40 — the SLEEP bit is set"
root_cause: incomplete_setup
resolution_type: code_fix
severity: high
tags: [mpu6050, gyro, imu, i2c, raspberry-pi, sleep, sensor-init, silent-failure]
---

# MPU6050 reads a fake (0.0, 0.0) orientation — sensor never woken from SLEEP

## Problem

During a hardware validation pass on sunset-cam-1, the gyro returned roll/pitch of exactly `(0.0, -0.0)` on every read. The MPU6050 hardware was fine — the driver simply never woke it, so it was reporting zeros that *looked* like "perfectly level."

## Symptoms

- `read_orientation(bus)` returns `(0.0, -0.0)` repeatedly with **zero jitter** (a real accelerometer always has ±0.x° noise — a perfectly clean reading is the tell).
- Raw accel block (`read_i2c_block_data(0x68, 0x3B, 6)`) is all zeros.
- `PWR_MGMT_1` (reg `0x6B`) reads `0x40` — bit 6 (SLEEP) set.
- `WHO_AM_I` (`0x75`) still reads `0x68`, so the chip is present and addressable — masking the problem.

## What Didn't Work

- Trusting `i2cdetect` / `WHO_AM_I`. They confirm the chip is *wired and addressable*, not that it's *producing data*. The chip answered `0x68` while feeding pure zeros.

## Solution

The MPU6050 powers up with the SLEEP bit set; it must be cleared once before reads return real data. Added to `gyro_driver.py`:

```python
PWR_MGMT_1 = 0x6B  # bit 6 (0x40) is SLEEP, set at power-on

def wake(bus, addr=MPU6050_ADDR):
    """Clear the SLEEP bit so the accelerometer produces real data."""
    bus.write_byte_data(addr, PWR_MGMT_1, 0x00)

def make_orientation_reader(bus, addr=MPU6050_ADDR):
    """Wake the chip, then return the zero-arg reader OrientationSampler expects."""
    wake(bus, addr)
    return lambda: read_orientation(bus, addr)
```

`OrientationSampler` takes an injected zero-arg reader and is deliberately unaware of the bus, so the wake can't live inside it. The `make_orientation_reader` factory is the wiring point that guarantees the chip is awake before the first sample — the sampler can never be handed a sleeping sensor. (firmware PR #4, TDD.)

## Why This Works

Until `PWR_MGMT_1`'s SLEEP bit is cleared, the MPU6050's accel registers read `0`, and `atan2(0,0)`-based roll/pitch compute to `(0, 0)`. Writing `0x00` clears SLEEP (and selects the internal oscillator), and the accelerometer starts producing real data immediately.

## Prevention

- **Treat a perfectly clean, jitter-free sensor reading as suspect.** Real analog sensors are noisy; a stable exact `0.0` usually means "not actually reading."
- **Distinguish "addressable" from "producing data."** `WHO_AM_I` / `i2cdetect` only prove the former. Validate an actual value range, not just presence.
- **Wire init through a factory** so a consumer can't be constructed against an un-initialized device.
- This is the sensor-layer instance of a broader pattern: a fallback/uninitialized path emitting a plausible-but-fake value that masquerades as the real signal. See [[2026-06-06-fallbacks-must-not-impersonate-real-signal]] and `../best-practices/validate-output-before-optimizing-pipeline.md`.

## Related Issues

- `sunset-cam-firmware` PR #4 — `wake()` + `make_orientation_reader()`.
- `../best-practices/validate-output-before-optimizing-pipeline.md` — the validation pass that surfaced this bug.
