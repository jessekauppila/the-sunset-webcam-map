# Deployment Checkpoint + Resume Prompt — 2026-06-09

Where the streamlined-deployment work stands, and a ready-to-paste prompt for next time.

---

## Resume prompt (paste this next session)

> Pick up the sunset-cam deployment work — read `docs/hardware/2026-06-09-deployment-checkpoint-and-resume-prompt.md`. The whole firmware stack (v0.4 sun-tap aiming + `/setup/confirm` + config launcher + the device supervisor + the confirm→cloud placement report) is built on `feat/deploy-aiming-supervisor` and pending the **cam1 bench run** (sun-free, see `docs/hardware/2026-06-08-supervisor-bench-run-runbook.md`).
> - If I've run the bench run and it's green: merge the firmware stack in order (firmware #5 v0.4 → deploy-aiming-firmware → deploy-aiming-supervisor), then build the **cloud log-shipping** slice.
> - If not yet: walk me through the bench run, then debug the journal output.
> Also pending physical checks: v0.4 real-sun aim accuracy, the read-only unplug-test (PR #6), and scanning/printing the QR label (PR #59).

## What's built (all PRs)

**Firmware (`sunset-cam-firmware`):**
- `main` has: gyro wake fix (#4 merged), install.sh I2C (#3 merged).
- **#5** `feat/v0.4-sun-tap-aiming` — OPEN, gated on real-sun validation.
- `feat/deploy-aiming-firmware` (confirm + config launcher) and `feat/deploy-aiming-supervisor` (supervisor + heartbeat + service-control + confirm→cloud report; `main` merged in for the gyro dep) — pushed, **gated** behind #5.
- **#6** `feat/read-only-root` — OPEN, INDEPENDENT (overlay-toggle helper + provisioning docs). Mergeable now; real validation = a cam1 unplug-test.

**Cloud (`the-sunset-webcam-map`):**
- Merged: deployment protocol (#52), install guide (#55), gitignore (#56), learnings (#48), specs/plans (#53), three-judge/labeling + binary classifier (#49, #54 — other session).
- **#57** supervisor bench runbook + learnings; **#58** QR-label spec + plans — OPEN docs.
- **#59** `feat/qr-label-generator` — OPEN, INDEPENDENT (label module + CLI; output visually verified). Pending Jesse's physical scan/print before merge.
- **#60** `feat/qr-label-admin-page` — OPEN, stacked on #59 (the first admin page; owner-gated label UI). Retarget to main once #59 merges.

## The bottleneck: physical validations (the build is ahead of the validation)

A lot of code is built + stacked, almost all gated on hardware steps not yet run:
1. **cam1 bench run** (sun-free) — validates the WHOLE firmware stack; the unblock. Runbook: `2026-06-08-supervisor-bench-run-runbook.md`.
2. **v0.4 real-sun aim** — tap the actual sun on cam1; gates merging #5 (and thus the stack).
3. **Read-only unplug-test** — `overlay.sh on` + pull power ~10× (PR #6).
4. **QR label scan/print** — scan the generated label → confirm `/setup/{code}`; print on the Nelko at 14×75mm (PR #59).

Per the new `build-ahead-of-validation` learning: the highest-leverage next move is one of these validations, not more stacked code.

## Remaining build work

- **Cloud log-shipping** (last hardening slice) — firmware heartbeat log-blob + a cloud endpoint. **Deferred on purpose**: it stacks on the gated supervisor, so build it after the bench run validates the stack.
- Follow-on (own specs): the state-aware control surface (onboard/recalibrate/turn-off + `reaim`/`shutdown` directives), E's WiFi captive portal, v0.3 auto-calibration.

## Merge order (once validations pass)

1. Independent, mergeable now: read-only-root (#6), QR-label generator (#59, after scan) → then retarget #60 to main, merge.
2. After bench run + real-sun: firmware #5 → `feat/deploy-aiming-firmware` → `feat/deploy-aiming-supervisor` (each needs `main` merged in / rebased; watch for the stacked-branch dependency-drift bug).

## Key references
- Runbook: `docs/hardware/2026-06-08-supervisor-bench-run-runbook.md`
- Specs: `docs/superpowers/specs/2026-06-07-pi-deployment-aiming-integration-design.md`, `2026-06-08-qr-label-and-shippable-unit-hardening-design.md`
- Learnings (this session): `docs/solutions/best-practices/build-ahead-of-validation.md`, `docs/solutions/developer-experience/git-worktrees-for-js-and-python-repos.md`, plus the earlier `walking-skeleton-over-horizontal-buildout.md`, `validate-output-before-optimizing-pipeline.md`, `integration-issues/stacked-branch-missing-merged-dependency.md`, `mpu6050-reads-fake-zeros-when-asleep.md`, `arducam-imx708-not-detected-on-pi-zero.md`.
