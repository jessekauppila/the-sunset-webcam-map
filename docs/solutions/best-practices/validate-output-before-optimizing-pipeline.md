---
title: Validate the product output before optimizing the pipeline
date: 2026-06-07
category: docs/solutions/best-practices
module: engineering-process
problem_type: best_practice
component: development_workflow
severity: medium
applies_when:
  - A pipeline "works" by a proxy metric (bytes uploaded, 200 OK, IDs returned) but the actual output artifact hasn't been inspected
  - About to invest in automating, scaling, or optimizing a flow
  - Success is currently measured by a stand-in rather than the thing you actually care about
tags: [process, validation, debugging, premature-optimization, proxy-metrics, hardware-bringup]
---

# Validate the product output before optimizing the pipeline

## Context

During the sunset-cam-1 bringup, the camera had been capturing and uploading ~300 KB frames to production — the logs showed `uploaded snapshot_id=…` and the server returned IDs, so the plumbing was provably working. The instinct was to move on to optimizing how to commission *more* units faster. But we had **never once looked at an actual frame, or read a single real gyro value.** The pull to optimize the pipeline arrived before anyone confirmed the pipeline produced a good product.

## Guidance

Before building automation, scaling, or optimization on top of a working pipeline, **inspect the actual output artifact** — the image, the file, the record a human cares about — not just the proxy that says data moved.

"Plumbing works" (bytes transferred, `200 OK`, IDs assigned, device addressable) is **not** "the product is good" (image in focus, sensor reading real values, record correct). Proxy metrics are necessary but not sufficient; they're exactly the signals that stay green while the real output is broken.

Concretely: pull one real artifact and look at it. View the frame. Read the sensor value and sanity-check its range. Open the generated file. *Then* decide whether the thing is worth optimizing.

## Why This Matters

On sunset-cam-1, spending ten minutes to actually validate the output before optimizing:
- **Confirmed the image was genuinely good** (sharp, well-exposed) — so the effort to scale was justified.
- **Caught a silent bug**: the gyro was reporting a fake `(0.0, 0.0)` because the sensor was never woken (see `../integration-issues/mpu6050-reads-fake-zeros-when-asleep.md`). Every proxy was green — `i2cdetect` showed the chip, uploads succeeded — yet the orientation data was fabricated. Had we built the AR aiming tool first, it would have shown a permanently perfect "level" and silently lied.

Optimizing the commissioning of five units before confirming that one produces a good picture and a real orientation is effort poured into an unvalidated foundation.

## When to Apply

- Any "it's working, let's scale/automate it" moment.
- Whenever success is currently judged by a stand-in (HTTP status, byte counts, "device detected") rather than the artifact itself.
- Right after first end-to-end success and right before the first optimization — that gap is where this check belongs.

## Examples

- **Proxy green, product unchecked:** server returned `snapshot_id`s for every upload (success signal) — but no one had viewed a frame. The frame turned out fine; the point is we didn't *know* until we looked.
- **Proxy green, product fake:** `i2cdetect` showed the MPU at `0x68` and `WHO_AM_I` returned `0x68` — yet the accelerometer fed pure zeros because it was asleep. Addressable ≠ producing data.

## Related

- `../integration-issues/mpu6050-reads-fake-zeros-when-asleep.md` — the silent bug this check caught.
- [[2026-06-06-fallbacks-must-not-impersonate-real-signal]] — same family: a fake value masquerading as the real signal; this practice is how you catch it.
