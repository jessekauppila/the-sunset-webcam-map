---
title: Trace the data path before planning a "new" feature — it may be 90% built already
date: 2026-06-09
category: docs/solutions/best-practices
module: engineering-process
problem_type: best_practice
component: development_workflow
severity: medium
applies_when:
  - About to write a plan or spec for a feature in an area that already has related infrastructure (models, endpoints, UI components, cron jobs)
  - The request sounds like a build ("implement X") but X might reduce to enabling something that already exists
  - You're tempted to scope a multi-task plan before reading the end-to-end data path
tags: [process, scoping, planning, yagni, ops-vs-code, verify-first]
---

# Trace the data path before planning a "new" feature — it may be 90% built already

## Principle

Before scoping a build, **trace the full data path end-to-end in the actual code** and find the one piece that's genuinely missing. Features that touch mature areas are often already wired; the real work is frequently an operational flip, not new code. Planning the build before reading the path means planning work that's already done.

## The case that taught this

The ask was to "implement the two-tier popup binary sunset classifier verdict" — show a real *Sunset detected* verdict in the public popup from the binary model instead of thresholding the regression score. It sounded like a feature. Tracing the path showed it was almost entirely built:

- the popup's `AiRatingDisplay` **already** preferred the binary "is-sunset" signal when present, only falling back to the regression-threshold proxy when it was absent;
- the live cron **already** wrote `webcams.ai_rating_binary` and `binaryIsSunset` (gated by an env flag);
- `next.config.ts` **already** bundled the binary model into the function.

The only real gap was **operational**: the binary head wasn't enabled in the live Vercel env, plus a bundle-size guard so the deploy would fit. The whole thing reduced to one env flip + one config pin — not a feature build. (cloud #50, #54.)

## How to apply

- **Grep/Read the consumer first.** Does the UI/endpoint that "needs" the feature already accept the input? (Here: the component already had an `isSunset` prop and used it.)
- **Walk backward to the producer.** Is the data already being written/computed somewhere, perhaps behind a flag? (Here: the cron already wrote it.)
- **Name the single missing link.** Usually it's one of: a disabled flag, an unset env var, an unbundled asset, an unapplied migration — not a new subsystem.
- **Distinguish "build" from "enable."** If the answer is "enable," the plan is a checklist (flip flag → redeploy → verify), and most of your planning budget evaporates — correctly.

## Why it compounds

Every plan you *don't* write for already-built work is saved effort, and the verification you do instead (confirm the flip worked) is cheaper and higher-signal than re-implementing. The failure mode is the opposite: writing a confident multi-task plan, then discovering mid-execution that tasks 1–4 were already done.

## Related

- [[vercel-bundles-all-model-versions-near-size-limit]] — the one piece of real code work the "build" actually needed (the bundle pin).
- [[verifying-prod-behind-vercel-deployment-protection]] — how the "enable" was verified instead of re-built.
- `../best-practices/reuse-existing-llm-labels-before-rescoring.md` — the data-layer sibling of this principle (reuse what's computed before recomputing).
