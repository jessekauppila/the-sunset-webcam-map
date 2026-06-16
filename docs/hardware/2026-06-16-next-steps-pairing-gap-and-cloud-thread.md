# Next Steps — 2026-06-16 (post camera-2 onboarding fix)

Where we landed and the two highest-leverage things to do next, each with a
paste-ready resume prompt. Supersedes the open items in
`docs/hardware/2026-06-15-resume-checkpoint.md` for the onboarding thread.

## What just shipped (done + verified)

**Camera 2 now onboards unattended.** A cold boot → the supervisor auto-starts →
registers + heartbeats to prod, with zero SSH / zero manual commands. Verified by
two clean reboots on `hw-sunset-cam-2` (192.168.0.103).

- Root cause was a missing `if __name__ == "__main__": main()` in firmware
  `boot.py` (`ExecStart=python -m sunset_cam.boot` ran the module but never called
  `main()`, so the dispatcher never executed — device booted and sat dark).
- Fix: firmware **PR #10** (`feat/e-onboarding-stage1`), commit `1465680` + learning
  doc `docs/solutions/integration-issues/systemd-oneshot-python-module-missing-main-entrypoint.md`.
- Pi access: `ssh pi@192.168.0.103` (key-based), passwordless sudo enabled
  (`/etc/sudoers.d/010-pi-nopasswd`) — burner board, leave as-is for now.

---

## Item 1 — The register-API pairing gap (next substantive build)

**Symptom:** camera 2 heartbeats fine but `cameras.webcam_id` is empty, so it does
**not** surface on the public map and **cannot accept snapshots** (snapshot POST 404s).
An onboarded-but-invisible camera isn't really onboarded.

**Root cause:** the `webcams` pairing row (the thing `cameras.webcam_id` points at) is
created today only by the **tier-0 seed script**, not by the register/provision API
path a claim-code onboard goes through. See memory `reference-custom-camera-pairing`.

**Where to look (cloud repo `the-sunset-webcam-map`):**
- `app/api/cameras/register/`, `app/api/cameras/provision/`, `app/api/cameras/pre-register/`
- `app/lib/cameraRegistration.ts` (and the deployment-model variants on
  `feat/cloud-https-setup`)
- the tier-0 seed (`scripts/tier0-create-camera.sh` / the `.superpowers/camera4-bringup/`
  scripts) — copy how IT creates the `webcams` row + sets `cameras.webcam_id`
- the snapshot route `app/api/cameras/[id]/snapshot/` (confirm what it requires)

**Goal:** provisioning/registration creates the `webcams` pairing (and links
`cameras.webcam_id`) so a claim-code onboard surfaces and accepts frames — no manual
seed. Consider the "commissioning self-test frame" idea (device pushes one frame at
the end of onboarding to prove the whole path) from the pairing memory.

**Decision to make first:** which endpoint owns pairing — `provision` (owner mints the
unit) vs `register` (device first contact). Likely `provision`, so the unit is
map-ready before it ships. Brainstorm before building.

### Paste-ready prompt — pairing gap

> Resume the sunset-cam onboarding work. Camera 2 now onboards unattended (firmware
> PR #10 merged/landed). The next blocker is the **register-API pairing gap**: a
> claim-code onboard creates the `cameras` row but never the `webcams` pairing, so
> `cameras.webcam_id` stays empty and the camera never surfaces on the map or accepts
> snapshots (snapshot POST 404s). Read memory `reference-custom-camera-pairing` and
> `docs/hardware/2026-06-16-next-steps-pairing-gap-and-cloud-thread.md`. Look at how
> the tier-0 seed creates the `webcams` row and replicate that in the
> provision/register path (decide which endpoint owns pairing — probably `provision`).
> Brainstorm the approach first (incl. the commissioning self-test frame), then
> TDD it. Verify against camera 2 (id 2, `hw-sunset-cam-2`): after the fix, a
> provisioned unit should get a non-null `webcam_id` and appear on the map. Prod DB
> reads need my explicit OK (auto-mode blocks unprompted prod queries).

---

## Item 4 — The cloud HTTPS / deployment-model thread

Branch `feat/cloud-https-setup` (60 commits ahead of `main`, pushed) carries:
- the **deployment-model refactor** — provision → pre-register → register →
  heartbeat / setup-status / decommission all act on a `deployments` table; public map
  + my-cameras read deployments; owner-aware wizard with re-aim/new + publish.
- **4 un-applied migrations** dated 2026-06-13 in `database/migrations/`:
  `20260613_deployment_model.sql`, `_backfill.sql`, `cameras_lifecycle.sql`,
  `cameras_bracket_provenance.sql`. **Prod does NOT have the `deployments` table yet**
  (confirmed 2026-06-15) — this refactor is unmerged and not live.
- the kept HTTPS phone-compass pieces: `app/lib/solar.ts`, `app/lib/declination.ts`,
  and the route at **`app/api/setup/declination/`** (NOTE: the older checkpoint says
  `/api/setup/[code]/declination` and references an `ArPlacementPlaceholder` step —
  both are stale; the live wizard steps are `MeasureWindow`, `HingeToEquinox`,
  `FacingPhase`, `MountConfirm`, `BracketSpec` under `app/setup/[claim_code]/`).

**Decision to make:** apply the 4 deployment migrations and open the PR for
`feat/cloud-https-setup` (the refactor is built; a 60-commit unmerged branch is risk,
not progress) — vs. keep iterating first. Folding the sun-arc overlay into the
existing wizard's heading step is a separate follow-on slice, not a blocker for the PR.

**Caution:** the deployment-model refactor changes the same register/provision code
the pairing gap (Item 1) lives in. Sequence them deliberately — either fix the pairing
gap **on** `feat/cloud-https-setup` (so it lands with the refactor), or merge the
refactor first then fix pairing on `main`. Don't fix pairing on `main` and refactor on
the branch in parallel and have them diverge.

### Paste-ready prompt — cloud thread

> Resume the cloud thread on branch `feat/cloud-https-setup`. Read
> `docs/hardware/2026-06-16-next-steps-pairing-gap-and-cloud-thread.md` and memory
> `cloud-https-setup-mvp-in-progress` if present. The deployment-model refactor is
> built (provision/register/heartbeat/etc. on a `deployments` table) with 4 un-applied
> migrations dated 2026-06-13 in `database/migrations/`; prod does not have the
> `deployments` table yet. Decide with me: apply the migrations + open the PR now, or
> iterate first. If we PR: review the 60-commit diff vs main, run the full cloud test
> suite, apply migrations to prod carefully (backfill is prod-safe per its header),
> and confirm the public map + my-cameras still render. Note the pairing-gap fix
> (Item 1) touches the same register/provision code — decide ordering so the two don't
> diverge. Prod DB reads need my explicit OK.

---

## Pointers
- Onboarding status + lessons: memory `project-streamlined-deployment-status`,
  `feedback-instrument-the-silent-component`, `reference-sunset-cam-2-access`.
- Prior escape hatch: `docs/hardware/2026-06-15-resume-checkpoint.md`.
- Two repos: cloud `~/GitHub/the-sunset-webcam-map`, firmware `~/GitHub/sunset-cam-firmware`.
