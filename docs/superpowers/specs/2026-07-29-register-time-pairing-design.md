# Register-Time Camera Pairing — Design

**Date:** 2026-07-29
**Branch:** `feat/cloud-https-setup`
**Status:** Approved design, ready for implementation plan

## Problem

A custom (edge) camera needs a paired `webcams` row — with `cameras.webcam_id`
pointing at it — before it can do anything user-visible. Without it:

- `POST /api/cameras/[id]/snapshot` returns **404 "camera has no paired webcam row"**
  (it reads `cameras.webcam_id` and rejects when null).
- The camera never surfaces on any map view.

On `feat/cloud-https-setup` the pairing is created by
`upsertActiveDeployment()`, which today runs **only from the operator placement
path** (`pre-register` / the setup wizard). The **device-boot path**
(`provision` → `register`) never creates a pairing. So a camera that boots and
registers but has not yet been placed by an operator sits at setup-status
`registered` with `webcam_id = NULL` — invisible and unable to accept frames.

**Live symptom:** camera 2 (`hw-sunset-cam-2`, `cameras.id = 2`) onboards
unattended and heartbeats to prod, but `webcam_id` is empty, so it is invisible
and its snapshot POSTs 404.

### Why this is the device path's problem, not a bug in `pre-register`

`pre-register` correctly pairs when an operator runs placement. But a streamlined,
non-technical onboard may boot the device before (or without) an operator doing
AR placement. The device-boot contact — `register` — must be able to establish
the pairing on its own so the unit is snapshot-capable the moment it registers.

## Decision

**Pair at registration.** `register` creates the `webcams` pairing row + sets
`cameras.webcam_id` if none exists, in a **pre-placement state**
(`state = 'testing'`, placement columns NULL). Placement (via `pre-register` /
the wizard) later fills in lat/lng/aim and promotes the row to `deployed`.

Rationale for `register` (not `provision`): `provision` runs at flash time before
a device identity is confirmed; `register` is the authenticated device-boot contact
and runs on **every** boot (re-registration is idempotent by design — see the
route's own comment: "a consumed code is normal on re-register"). Putting pairing
here means **camera 2 self-heals on its next reboot**, with no manual backfill.

## Two surfaces, deliberately different requirements

| Surface | Query gate | Needs |
| --- | --- | --- |
| All-webcams map (`db-all-webcams`) | `state='deployed' AND ended_at IS NULL AND paused=false` | the `webcams` row, promoted to `deployed` (i.e. placed) |
| Terminator mosaic (curated winners) | join `terminator_webcam_state.active=true` | a `terminator_webcam_state` row — **owned by the cron**, not onboarding |
| Snapshot ingest (`/snapshot`) | `cameras.webcam_id` non-null | the `webcams` row + back-pointer |

A `testing` row therefore stays **off the public map** (the map filters
`state='deployed'`) until placement promotes it, but **is** enough to make snapshot
ingest succeed. `terminator_webcam_state` is intentionally **not** touched — it is
the cron's curated-winner cache, and force-inserting every onboarded camera as
`active=true` would inject unrated cameras into the mosaic. (The tier-0 seed does
this only because it is a test fixture.)

## Components

### 1. `ensureDeploymentPairing(cameraId)` — new, in `app/lib/cameraDeployment.ts`

- Calls `getActiveDeployment(cameraId)`.
  - If an active deployment exists → **no-op**, return it. Never clobbers placement.
  - If none → INSERT a minimal `webcams` row and set `cameras.webcam_id`, return it.
- Inserted row shape (pre-placement):
  - `source='custom'`, `custom_camera_id=cameraId`,
    `external_id='custom-{cameraId}-{Date.now()}'`, `title='Camera {cameraId}'`,
    `status='active'`, `state='testing'`, `paused=FALSE`, `started_at=NOW()`,
    all placement columns (`lat`, `lng`, `elevation_m`, `timezone`, `azimuth_deg`,
    `tilt_deg`, `horizon_altitude_deg`, `horizon_profile`, `azimuth_source`,
    `coarse`, `bracket`, `phase_preference`, `delivery_preferences`) **NULL**.
  - Then `UPDATE cameras SET webcam_id = <inserted.id> WHERE id = cameraId`.
- **Targeted DRY:** extract the ~20-column INSERT + `webcam_id` back-pointer that
  `upsertActiveDeployment` and `ensureDeploymentPairing` share into a private
  `insertActiveDeployment(cameraId, placement, state)` helper in the same file.
  `ensureDeploymentPairing` calls it with an all-null placement and
  `state='testing'`.

### 2. Wire into `app/api/cameras/register/route.ts`

- After step 4 (update device fields: firmware/capabilities/`registered_at`/
  `last_seen_at`) and before step 5 (read active deployment for placement status),
  call `await ensureDeploymentPairing(cameraId)`.
- Response is **unchanged** for the unplaced case: `derivePlacementStatus(null)`
  and `derivePlacementStatus(testingRow)` both return `'awaiting_location'` (the
  testing row has null lat/lng). The only observable change is that `webcam_id` is
  now set.

## How it composes with existing placement

- Later, `pre-register` / the wizard call `upsertActiveDeployment`:
  - `mode='reaim'` → **updates the testing row in place** with real placement and
    (for an owner publishing) promotes `testing → deployed`.
  - `mode='new'` → ends the testing row (`ended_at=NOW()`, `state='ended'`) and
    opens a fresh deployment.
  Both paths already exist; register-pairs-first simply front-loads the row.

## Error handling & edge cases

- **Idempotent:** re-register on every boot is a no-op once paired
  (`getActiveDeployment` returns the existing row → early return).
- **Concurrency:** the partial unique index
  `webcams_active_deployment_idx UNIQUE (custom_camera_id) WHERE source='custom'
  AND ended_at IS NULL` guarantees one active deployment. `ensureDeploymentPairing`
  uses the same check-then-insert shape as the existing `upsertActiveDeployment`;
  concurrent registers from a single device are not a realistic contention source.
- **No new migration.** Uses existing columns only. **Dependency:** the 4 un-applied
  `20260613_*` migrations (which add `webcams.state`, etc.) must be applied to prod
  for any of this branch — including this fix — to function. That prod step is
  tracked separately and is not part of this slice.

## Testing (TDD, mocked SQL — matches the existing suite)

- `app/lib/cameraDeployment.test.ts`
  - `ensureDeploymentPairing` inserts a `testing` row and sets `webcam_id` when no
    active deployment exists.
  - `ensureDeploymentPairing` is a no-op (returns the existing row, issues no
    INSERT / no `webcam_id` update) when an active deployment already exists.
- `app/api/cameras/register/route.test.ts`
  - register ensures pairing: `webcam_id` is set after a first-time register.
  - register is idempotent on re-register: no duplicate `webcams` insert when a
    deployment already exists.

## Verification against camera 2

After deploy + a reboot (which triggers re-register):

1. `cameras.webcam_id` for `id = 2` is **non-null**.
2. A snapshot POST returns **202** instead of 404.

Appearing on the *public* map additionally requires running the wizard placement to
promote the row to `deployed` — that is an optional confirmation, **not** part of
this slice. Prod DB reads require Jesse's explicit OK (auto-mode blocks unprompted
prod queries).

## Scope

**In:** `ensureDeploymentPairing` + `insertActiveDeployment` DRY helper + register
wiring + tests.

**Out:** the firmware commissioning self-test frame (separate firmware slice, now
*unblocked* by this change); any `terminator_webcam_state` change; new migrations;
the public-map promotion.
