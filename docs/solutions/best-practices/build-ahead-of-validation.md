---
title: Don't let the build get ahead of the validation (stop stacking on un-validated foundations)
date: 2026-06-09
category: docs/solutions/best-practices
module: engineering-process
problem_type: best_practice
component: development_workflow
severity: medium
applies_when:
  - Building a multi-layer feature where each layer stacks on the previous one
  - A foundation layer is built + unit-tested but not yet validated end-to-end (or is gated on hardware / an external step)
  - Tempted to keep building the next slice because the code keeps flowing and the suites stay green
tags: [process, integration, stacked-branches, validation, walking-skeleton, gated-work]
---

# Don't let the build get ahead of the validation

## Context

The sunset-cam deployment work grew a tall stack of branches — v0.4 aiming → confirm/launcher → device supervisor → label/admin → read-only-root — each layer green-tested and each stacked on the one below. But **almost the entire stack was gated on physical validations that hadn't been run yet**: the cam1 bench run, the real-sun aim, the read-only unplug-test, the label scan. Every new slice was being built on a foundation that *passed unit tests* but had *never run for real*.

## Guidance

When work stacks, periodically ask: **"What's the lowest un-validated layer, and am I building on top of it anyway?"** If yes, the highest-leverage move usually isn't the next slice — it's **one validation pass on the foundation** that either confirms it or surfaces a problem cheaply, before more code depends on it.

Unit tests prove each layer *works in isolation*; they don't prove the foundation is *right* once integrated or run on real hardware. Stacking more code on an un-validated/gated layer compounds risk: if the foundation is wrong, everything above it inherits the flaw, and you've spent the effort twice.

Concretely:
- Track which layer is the **lowest un-validated one**.
- Before starting a slice that *depends* on it, decide: validate the foundation now, or accept that this slice is provisional until it's validated.
- If a validation is *gated* (needs hardware, the sun, an external merge), prefer building things that are **independent** of the gate over things that **stack on** it. (Read-only root and the label generator were buildable independently; cloud log-shipping stacked on the gated supervisor — so it was correctly deferred.)
- Name it out loud when "the build is getting ahead of the validation," and offer the validation as the alternative to the next slice.

## Why This Matters

On this project, flagging it changed the plan: instead of building cloud log-shipping (which stacked on the still-un-run supervisor), the work pivoted to the **cam1 bench run** — one sun-free hardware session that validates the *entire* firmware stack at once and unblocks merging all of it. Building log-shipping first would have added more un-mergeable, un-validated code on top of an un-proven base.

This is the same family as [[walking-skeleton-over-horizontal-buildout]] (run a thin end-to-end path early) and [[validate-output-before-optimizing-pipeline]] (inspect the real artifact before scaling) — one level up: *validate the foundation before you keep stacking on it.*

## When to Apply

- Stacked feature branches / a layered subsystem where slice N depends on slice N-1.
- Any time a foundation is "done" by tests but un-run end-to-end, and the next task builds on it.
- Especially when a validation is gated (hardware, external, a pending merge) — that's exactly when the temptation to "just keep coding" is strongest and the risk is highest.

## Examples

- **The trap:** v0.4 → deploy-firmware → supervisor → (would-be) log-shipping, all green-tested, none run on cam1. Each new layer assumed the one below worked end-to-end.
- **The correction:** stop before log-shipping; queue the cam1 bench run (sun-free, validates the whole firmware stack); build only the *independent* slices (read-only root, label generator) while the gate is unresolved.

## Related
- [[walking-skeleton-over-horizontal-buildout]] — run one end-to-end path early.
- [[validate-output-before-optimizing-pipeline]] — inspect the real artifact, not green proxies.
- `../integration-issues/stacked-branch-missing-merged-dependency.md` — a concrete failure mode of stacking (a dependency that didn't ride along).
