# Deployment Model — Reconciliation Design

Date: 2026-06-13
Repo: `the-sunset-webcam-map` (cloud DB + setup wizard + map). Touches
`sunset-cam-firmware` only at the device-protocol seam (placement now comes from
the active deployment).

**Status: design-of-record for the cloud deployment model.** Reconciles the
1:many Camera/Deployment model with sub-project F (the cloud setup wizard), which
shipped *after* the original model was drafted.

Extends / supersedes in part:
- `sunset-cam-firmware/docs/superpowers/specs/2026-06-12-new-camera-commissioning-pipeline-design.md`
  — the Camera-vs-Deployment design-of-record. Its "Core data model" and lifecycle
  rules stand; this doc resolves the cloud-side specifics and the F conflicts.
- `docs/superpowers/plans/2026-06-13-subproject-F-cloud-wizard-plan.md` — F's
  cloud-persistence slice (Tasks 4–7) and Tasks 22/23 **retarget** to deployments
  (see §10). F's wizard UI / solver / validation are reused unchanged.

---

## 1. Why this spec exists

The Camera/Deployment model says: a **Camera** is identity (created once, never
carries location); a **Deployment** is a placement + image archive (many per
camera; `testing → deployed → ended`). F was built before that landed, so F's
`pre-register` writes placement **onto the `cameras` row**, and decommission/pause
(Task 23) act on `cameras.status`. This doc retargets all of that onto deployments.

**Decision context (already made with the user):**
- Full location **trail** wanted (a Pi's past placements are retained) → deployments, not a single mutable row.
- **Deployments-first**: PR #67 is held (not merged, migrations not applied to prod); F's persistence retargets to deployments before merge.

## 2. Current reality (verified in code, 2026-06-13)

- **Placement is duplicated today.** The `cameras` row holds `lat/lng/azimuth_deg/
  tilt_deg/...` (F's `upsertCameraByClaimCode` writes it). The `webcams` row *also*
  holds `lat/lng` and **owns the snapshot archive** via `webcam_snapshots.webcam_id`.
- **`webcams` is shared** between thousands of Windy webcams (`source='windy'`) and
  custom cameras (`source='custom'`, `webcams.custom_camera_id` → `cameras.id`).
  The public map (`/api/db-all-webcams`) renders **all** webcams rows.
- **`cameras.status` is already read**: My Cameras (`/api/my-cameras`) filters
  `where c.status='active'` and joins `webcams` via `cameras.webcam_id` for title +
  latest snapshot. So decommission/pause already drop a camera from My Cameras.
- Today the link is **1:1** (`cameras.webcam_id` ↔ `webcams.custom_camera_id`).

## 3. Locked decisions

1. **`webcams` *is* the deployment table** (evolve it; do not add a separate
   `deployments` table). A custom camera owns **many** `webcams` rows over time —
   one per deployment. Rationale: snapshots already key on `webcam_id`, so a new
   deployment = a new webcams row = a **clean archive for free**; the public map
   already reads webcams, so it only needs a `state` filter. A separate table would
   force re-keying `webcam_snapshots` — far larger blast radius.
   - Terminology: in cloud code/SQL, "deployment" = a `webcams` row with
     `source='custom'` and the lifecycle columns below. We do **not** rename the table.
2. **Placement lives on the active deployment**, not the camera. `cameras` becomes
   pure identity (see §4 column map). F's wizard, `bracket.ts` solver, and
   `pre-register` validation are reused; only the **write target** moves.
3. **Owner-aware `testing` vs `deployed`** via `isOwner(session)`, server-enforced,
   with a Publish control in owner mode (§7).

## 4. Data model after reconciliation

### `cameras` — identity (no location)
Keeps: `id`, `hardware_id`, `device_token_hash`, `device_class`,
`firmware_version`, `capabilities`, `claim_code` (permanent setup pointer, §8),
`registered_at`, `last_heartbeat_at`, `last_seen_at`, `webcam_id` (now a **cached
pointer to the active deployment** — see invariant below), and
`wifi_wipe_requested` (device directive; camera-level — stays here, §6).

`cameras.status`: narrowed to **hardware-level** only — `active | retired`
(`retired` = the physical unit is dead, e.g. the jesse-house board). The
placement lifecycle (testing/deployed/ended/paused) moves to the deployment.
Decommission/pause **no longer touch `cameras.status`** (§6).

**Removed from `cameras` (moved to the deployment):** `lat`, `lng`, `elevation_m`,
`timezone`, `azimuth_deg`, `tilt_deg`, `horizon_altitude_deg`, `horizon_profile`,
`azimuth_source`, `coarse`, `bracket`, `delivery_preferences`, `phase_preference`.
(They remain as columns during migration for backfill, then reads switch to the
deployment — see §11. Dropping the columns is a later, optional cleanup.)

> **Deviation from the firmware design-of-record:** that doc lists
> `phase_preference` on `Camera`. The bracket flow derives phase from the install
> **facing** (sunrise vs sunset), which is per-placement — so `phase_preference`
> belongs on the **deployment**. Recorded here as the reconciled decision.

### `webcams` (custom rows) — deployment = placement + archive
Add (all nullable; Windy rows leave them NULL):
- Lifecycle: `state TEXT` (`testing | deployed | ended`), `paused BOOLEAN DEFAULT FALSE`,
  `started_at TIMESTAMPTZ`, `ended_at TIMESTAMPTZ` (NULL = active).
- Placement: `azimuth_deg`, `tilt_deg`, `elevation_m`, `timezone`,
  `horizon_altitude_deg`, `horizon_profile JSONB`.
  (`lat`/`lng` already exist on `webcams`.)
- Provenance: `azimuth_source TEXT`, `coarse BOOLEAN`, `bracket JSONB`.
- Operator: `phase_preference TEXT`, `delivery_preferences JSONB`.
- `custom_camera_id` already exists (FK → `cameras.id`).

### Invariants
- **Active deployment** of camera N = the `webcams` row with
  `custom_camera_id = N AND ended_at IS NULL`. At most one exists.
- `cameras.webcam_id` is a **denormalized cache** of that active row, updated
  whenever a new deployment opens or the active one ends. Keeping it avoids
  rewriting the My Cameras / snapshot joins. (Enforced in `upsertActiveDeployment`.)
- A camera with **zero** non-ended deployments has `webcam_id = NULL` and renders
  nowhere public.

## 5. Lifecycle

`state`: `testing` (private to owner, never public) → `deployed` (public, real
archive) → `ended` (closed; `ended_at` set; archive frozen, retains lat/lng for
the trail). `paused` is an **orthogonal boolean** on the active deployment
(resumable; placement + WiFi intact; not a `state`).

- **Bench bringup** = deployment #1, `state='testing'` (owner mode default, §7).
- **Field install** = `state='deployed'` (customer mode default, or owner Publish).
- **A new placement commit auto-ends the prior deployment** when the move is
  > ~100 m and confirmed (§8); ≤100 m re-aims the active one in place.

## 6. Decommission / Pause / wipe_wifi — retargeted

The Task 23 endpoints (`/api/cameras/[id]/{decommission,pause}`) keep their
claim-code-OR-id resolution and shape, but **act on the active deployment**:
- **decommission** → end the active deployment: `ended_at = NOW()`, `state='ended'`;
  clear `cameras.webcam_id` (now no active deployment); with `relocate:true` set
  `cameras.wifi_wipe_requested = TRUE`.
- **pause** → set the active deployment `paused = TRUE` (state unchanged).
- **resume** (new, trivial) → `paused = FALSE`.
- `wifi_wipe_requested` stays a **camera-level** directive; heartbeat surfaces
  `directives:['wipe_wifi']` once via the existing CTE (unchanged from Task 23c).

A **passerby decommission is recoverable**: re-running the wizard opens a fresh
deployment (the camera identity + token are untouched).

## 7. Owner-aware testing vs deployed

The setup page is a server component; it calls `auth()` → `isOwner(session)`
(existing `app/lib/owner.ts` + `ownerEmails.ts`).
- **Owner signed in** → new deployment defaults to `state='testing'`; the wizard
  shows a **Publish / Go live** control that promotes `testing → deployed`.
- **Anyone else** (customer, no owner session) → defaults to `state='deployed'`.
- **Server-enforced**: `pre-register` sets `state` from `isOwner(session)` (and an
  explicit publish flag in owner mode), **never** from a client-sent field. Hiding
  the Publish button is cosmetic; the endpoint is the gate (same principle as
  `requireOwner`).
- Discriminator is **identity, not location** — so bench-testing at the same spot
  you'd later use for a real install is a non-issue.

Precedent: GitHub/Google Docs/YouTube (owner sees admin controls on a public URL),
Next.js Draft Mode / WordPress draft preview (authenticated editors see
unpublished; public sees published) = `testing → deployed`.

Deferred (not in this build): a server-side **"armed / needs-approval"** state to
vet customer installs before they go public. Same mechanism, third gate.

## 8. Placement flow + the >100 m rule

Camera identity is created at **provisioning** (§9), so the wizard always operates
on an existing camera and only ever creates/updates a **deployment**.

`upsertActiveDeployment(cameraId, placement, { state, confirmedNewLocation })`:
1. Resolve the camera (must exist; else 404 — provisioning missing).
2. Find the active deployment (`ended_at IS NULL`).
3. **None** → INSERT deployment #1 (`started_at=NOW()`, `state` per §7); set
   `cameras.webcam_id`.
4. **Active exists** → `haversine(new, active)`:
   - **> ~100 m AND `confirmedNewLocation`** → end the active (`ended_at`,
     `state='ended'`), INSERT a new deployment, repoint `cameras.webcam_id`.
   - **≤ 100 m** (or not confirmed) → UPDATE the active deployment in place
     (re-aim; GPS jitter never splits a feed).
5. Reconciliation when device + cloud disagree: **latest-timestamp wins**; cloud is
   system-of-record once the camera is online (carried over from the firmware spec).

`haversine` + the 100 m threshold live in a small pure lib (`app/lib/deploymentPlacement.ts`, TDD).

## 9. Camera identity at provisioning

- **Provisioning** (owner action, at flash/bench time) mints the **permanent**
  claim code (non-expiring, ~3650 d) and creates the **Camera** row (identity +
  `device_token_hash`, `claim_code`, `status='active'`), with **no deployment yet**.
- The claim code is a **permanent per-camera setup pointer** (the QR), not a
  single-use token. `consumeClaimCode`'s single-use semantics are **dropped** for
  the shipped flow; the code resolves the camera for the life of the unit.
- The device `register` call then **authenticates against its existing camera row**
  and updates `firmware_version`/`capabilities`/`last_seen_at`. **The register-creates-
  camera and pre-register-creates-camera paths are removed** — both assumed no
  provisioning step; now there always is one. (Simplifies the either-order
  contract: the camera always pre-exists; only the deployment is created by the wizard.)

> If a lightweight provisioning endpoint doesn't already exist, this build adds an
> owner-only `POST /api/cameras/provision` (mint code + create camera row). The
> 2026-06-12 renumber did this by hand for camera 1.

## 10. Map + My Cameras

- **Public map** (`/api/db-all-webcams`): custom rows are shown only when
  `state='deployed' AND ended_at IS NULL AND paused=FALSE`. Windy rows
  (`state IS NULL`) are unaffected — the filter is `source <> 'custom' OR (state=...)`.
- **My Cameras** (owner): lists the owner's cameras with their **active** deployment
  by default; a **"Show decommissioned"** toggle reveals `ended` deployments on the
  map at their retained lat/lng (owner-only client filter). This is the trail.
- The per-camera detail page can show the deployment history (list of placements
  with date ranges) — nice-to-have, can be a follow-up task.

## 11. F retargeting (what changes in already-built code)

PR #67 is held; these change before merge:
- `cameraRegistration.ts`: replace `upsertCameraByClaimCode` with
  `upsertActiveDeployment` (writes the deployment, applies §8). `derivePlacementStatus`
  reads the active deployment.
- `pre-register/route.ts`: resolve camera by claim code (must exist), determine
  `state` from `isOwner(session)` + publish flag, call `upsertActiveDeployment`.
  Keep all bracket validation as-is.
- `register/route.ts`: drop the INSERT path; authenticate + update device fields on
  the existing camera. `heartbeat/route.ts`: placement comes from the active
  deployment (join), not the camera row.
- `setup-status/[claim_code]/route.ts`: derive from camera + active deployment
  (the `WizardEntry` "already-placed" signal becomes "has an active deployment").
- `decommission` / `pause` routes (Task 23): retarget to the active deployment (§6);
  add `resume`.
- **Held migrations are superseded**: `20260613_cameras_bracket_provenance.sql` and
  `20260613_cameras_lifecycle.sql` are **not** applied to prod as-is. The new
  deployment migration (§12) replaces them: provenance (`azimuth_source/coarse/
  bracket`) lands on the **deployment** (webcams), while the single camera-level
  piece — `wifi_wipe_requested` — is the one column carried over onto `cameras`.
  The wizard **UI** slice (Tasks 8–22) is reused unchanged (it POSTs a payload;
  only the endpoint's storage changes).

## 12. Migration plan (prod-safe, additive-first)

1. **Add** the deployment columns to `webcams` (§4), all nullable/defaulted —
   no effect on Windy rows. Also add `wifi_wipe_requested BOOLEAN DEFAULT FALSE`
   to `cameras` (the one camera-level piece of the superseded lifecycle migration).
2. **Backfill** each existing custom camera: its current `webcams` row becomes the
   active deployment — set `state` (`testing` for camera 1 the bench unit),
   `started_at = created_at`, `ended_at = NULL`; copy placement/provenance from the
   `cameras` row into the webcams row where the webcams columns are NULL.
3. **Repoint** `cameras.webcam_id` at that active row (already true for 1:1 today).
4. Ship the retargeted routes (read from the deployment).
5. **Later/optional cleanup**: drop the moved columns from `cameras` once nothing
   reads them.

Order matters: columns + backfill **before** the routes deploy (else reads miss).
All steps additive; reversible until the §5 cleanup.

## 13. Open questions / risks

- **Provisioning endpoint**: confirm whether a usable owner-only provision path
  exists or must be added (§9). Camera 1 was provisioned by hand.
- **Windy filter correctness**: the public-map `state` filter must not hide the
  thousands of Windy rows — assert via test that `state IS NULL` rows still show.
- **`cameras.webcam_id` cache drift**: every active-deployment transition must
  repoint it in the same transaction; covered by `upsertActiveDeployment` tests.
- **Either-order contract**: removing pre-register-creates-camera changes the E↔F
  contract's registration ordering — update the contract doc when E is built.

## 14. Out of scope (YAGNI)

- Renaming `webcams` → `deployments` (terminology only; not worth the churn).
- The deferred "armed/needs-approval" customer-vetting state (§7).
- Per-deployment delivery routing beyond storing `delivery_preferences`.
- Dropping the moved `cameras` columns (separate cleanup once reads are migrated).
