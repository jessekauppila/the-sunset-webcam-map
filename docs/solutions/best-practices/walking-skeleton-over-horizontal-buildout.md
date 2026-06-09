---
title: Build a thin end-to-end walking skeleton before fleshing out components
date: 2026-06-08
category: docs/solutions/best-practices
module: engineering-process
problem_type: best_practice
component: development_workflow
severity: medium
applies_when:
  - Building a feature that spans multiple layers/services (device + cloud, UI + API + DB)
  - Each component is being completed and unit-tested before any end-to-end run
  - Tempted to keep adding components because the unit suites are all green
tags: [process, integration, walking-skeleton, thin-vertical-slice, tdd, testing]
---

# Build a thin end-to-end walking skeleton before fleshing out components

## Context

The sunset-cam deployment integration was built *horizontally* — each component finished and unit-tested in isolation (v0.4 aiming tool, cloud placement protocol, `/setup/confirm`, the config launcher, the device supervisor), every suite green. But the pieces had **never run together**. Reasoning about the full end-to-end path (before even deploying) surfaced a **missing wire**: `/setup/confirm` wrote the aim to a local file but **never reported it to the cloud**, so the cloud would never flip to `ready` and the supervisor would never leave aiming mode. Every unit test was green; the *seam* was unwired.

## Guidance

Get **one crude end-to-end path working through all the layers as early as possible** — a "walking skeleton" — before completing any single component. The integration seams (the wires *between* components) are where the real surprises live, not inside the well-specified components.

Unit tests prove each piece *works*; they do **not** prove the pieces *fit*, or that the design is right. A wall of green unit tests can coexist with a system that doesn't function end-to-end.

Concretely: as soon as you have rough versions of each layer, run the whole path — even with stubs, fakes, or (here) a fake sun. Find the missing/wrong wires while they're cheap. Then flesh out.

## Why This Matters

Horizontal build-out front-loads a tall stack of un-integrated code; the integration risk is deferred to the very end, where it's most expensive and most surprising. On this project:
- Building the supervisor + wizard on top of an aiming flow we'd never run end-to-end meant we were piling on an *unvalidated foundation*.
- The missing confirm→cloud wire would have made the bench run silently stall (camera never flips to capture) — invisible to every unit test, obvious the moment you trace the seam.

This is the same lesson as [[validate-output-before-optimizing-pipeline]], one level up: there, validate the *artifact* before optimizing; here, validate the *integration* before building more on top.

## When to Apply

- Any multi-layer/multi-service feature, especially device↔cloud.
- The moment you notice you're "completing the next component" without having run the previous ones together.
- Before investing in components that *sit on top of* an un-run foundation.

## Examples

- **Green pieces, unwired seam:** `/setup/confirm` (tested: writes placement to an injected sink) + cloud `POST /placement` (tested: accepts a placement) + supervisor (tested: flips on `ready`) — all green, but nothing connected confirm to the cloud. Caught by tracing the end-to-end path, not by any unit test.
- **The cheap fix:** run a bench end-to-end with a *fake* sun — only sun-tap *accuracy* needs a real sunset; the *plumbing* (tap → heading → confirm → cloud → mode flip) runs anytime, and exercises every seam.

## Related
- [[validate-output-before-optimizing-pipeline]] — validate the real artifact, not just proxy/green signals.
- `../integration-issues/stacked-branch-missing-merged-dependency.md` — another seam-level bug a walking-skeleton run catches.
