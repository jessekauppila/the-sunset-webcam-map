# Resume Checkpoint — 2026-06-15

Escape hatch from a long session. Three live threads; read the anchor doc for each
before acting. The build is **ahead of validation** — prefer the next *validation*
over more stacked code.

Two repos: cloud = `~/GitHub/the-sunset-webcam-map`, firmware = `~/GitHub/sunset-cam-firmware`.

---

## Resume prompt (paste this next session)

> Resume the sunset-cam work — escape hatch from a long prior session. There are
> three live threads; read the anchor doc for each before acting (build is ahead of
> validation, so prefer the next *validation* over more stacked code).
>
> Two repos: cloud = ~/GitHub/the-sunset-webcam-map, firmware = ~/GitHub/sunset-cam-firmware.
>
> 1. CLOUD PROGRAM — branch `feat/cloud-https-setup` (ahead of origin).
>    Carries (a) the deployment-model refactor: provision → pre-register → register →
>    heartbeat/setup-status/decommission now act on a `deployments` table, with 4
>    un-applied migrations dated 2026-06-13 (deployment_model + backfill, lifecycle,
>    bracket_provenance); and (b) HTTPS phone-compass calibration.
>    The standalone-wizard plan
>    `docs/superpowers/plans/2026-06-13-cloud-https-phone-compass-calibration.md` is
>    SUPERSEDED — kept only `app/lib/solar.ts`, `app/lib/declination.ts`, and
>    `GET /api/setup/[code]/declination`. REAL NEXT STEP: fold the sun-arc overlay into
>    the existing wizard at `app/setup/[claim_code]/` (ArPlacementPlaceholder, spec
>    `2026-05-16-cloud-wizard-frontend-design.md` §4) — do NOT build a second wizard.
>    See memory `cloud-https-setup-mvp-in-progress`. Decide: apply the deployment
>    migrations + open a PR, or keep iterating on the branch first.
>
> 2. COMMISSION THIS ONE PI — cam1 (`camera_id 4`, `pi-zero-2w-sunset-cam-1`; already
>    paired webcam_id 28759753, reads Stale, window expired 2026-06-07).
>    The firmware stack (v0.4 sun-tap aiming PR #5 + the device supervisor) is BUILT and
>    STACKED, gated on physical validations. Anchor:
>    `docs/hardware/2026-06-09-deployment-checkpoint-and-resume-prompt.md` (PR landscape
>    + merge order + validation backlog). The unblock is the sun-free cam1 BENCH RUN
>    (`docs/hardware/2026-06-08-supervisor-bench-run-runbook.md`): deploy
>    `feat/deploy-aiming-supervisor`, start the supervisor, tap+Confirm on a phone, watch
>    it flip aiming→capture. Then: v0.4 real-sun aim accuracy, read-only-root unplug-test
>    (firmware PR #6), QR-label scan/print (PR #59).
>
> 3. SCRIPT TO COMMISSION PIs IN FUTURE — the operator `provision-unit.sh` (Mac flash +
>    claim-code mint + sticker) is partially covered by firmware `scripts/install.sh` +
>    the QR-label generator (cloud PRs #59/#60). BLOCKER to fix first: the register-API
>    pairing gap — `register` creates a `cameras` row but never the `webcams` pairing
>    (`cameras.webcam_id`); only the tier0 seed does, so a claim-code onboard never
>    surfaces or accepts snapshots. See memory `reference_custom_camera_pairing` (+ the
>    commissioning-self-test-frame idea). Streamlined-deployment umbrella status is in
>    memory `project-streamlined-deployment-status`.
>
> Also note: the camera *hardware* choice is now decided —
> `docs/hardware/2026-06-15-camera-hardware-decision.md` (Module 3 Wide + central
> scoring, not the IMX500).
>
> Tell me which thread to pick up; if I just say "where are we," summarize all three
> from the anchor docs and recommend the highest-leverage next move.

---

## Thread detail

### 1. Cloud program — `feat/cloud-https-setup`
- **Deployment-model refactor:** the camera lifecycle (provision → pre-register →
  register → heartbeat / setup-status / decommission / pause / resume) was retargeted
  onto a `deployments` table; public map + my-cameras read deployments; the wizard is
  owner-aware with re-aim/new mode + publish. **4 migrations dated 2026-06-13 are not
  yet applied** (`deployment_model`, `deployment_model_backfill`, `cameras_lifecycle`,
  `cameras_bracket_provenance`).
- **HTTPS phone-compass calibration:** the standalone plan
  `docs/superpowers/plans/2026-06-13-cloud-https-phone-compass-calibration.md` is
  **superseded** — kept only `app/lib/solar.ts`, `app/lib/declination.ts`, and
  `GET /api/setup/[code]/declination`. **Real next step:** fold the sun-arc overlay
  into the *existing* wizard (`app/setup/[claim_code]/` → `ArPlacementPlaceholder`,
  spec `2026-05-16-cloud-wizard-frontend-design.md` §4). Do **not** build a 2nd wizard.
- **Decision pending:** apply the deployment migrations + open a PR, or keep iterating
  on the branch first.

### 2. Commission this one Pi — cam1 / `camera_id 4`
- `pi-zero-2w-sunset-cam-1`; already paired (`webcam_id 28759753`); reads **Stale**
  (heartbeating but not capturing since the window expired 2026-06-07).
- Firmware stack (v0.4 sun-tap aiming PR #5 + device supervisor) is **built + stacked,
  gated on physical validation**. Anchor:
  `docs/hardware/2026-06-09-deployment-checkpoint-and-resume-prompt.md`.
- **Unblock = the sun-free cam1 bench run**
  (`docs/hardware/2026-06-08-supervisor-bench-run-runbook.md`). Then: v0.4 real-sun aim,
  read-only-root unplug-test (firmware PR #6), QR-label scan/print (PR #59).

### 3. Script to commission Pis in future
- Operator `provision-unit.sh` (Mac flash + claim-code mint + sticker) — partially
  covered by firmware `scripts/install.sh` + QR-label generator (cloud PRs #59/#60).
- **Blocker:** the register-API pairing gap — `register` creates a `cameras` row but
  never the `webcams` pairing, so a claim-code onboard never surfaces or accepts
  snapshots (only the tier0 seed pairs today). See memory `reference_custom_camera_pairing`
  (+ commissioning-self-test-frame idea).

### Decided this session
- Camera hardware: `docs/hardware/2026-06-15-camera-hardware-decision.md` — Module 3
  Wide + central scoring, not the IMX500.
