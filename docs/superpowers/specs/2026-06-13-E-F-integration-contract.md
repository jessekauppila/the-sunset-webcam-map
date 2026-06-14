# E ↔ F Integration Contract — WiFi Onboarding ⟷ Cloud Setup Wizard

Status: Authoritative v1.0 — 2026-06-13
Owner: Jesse Kauppila
Scope: The single source of truth for the seam between **sub-project E** (WiFi
captive-portal onboarding + SD provisioning — firmware repo `sunset-cam-firmware`)
and **sub-project F** (the cloud setup wizard at `/setup/[claim_code]` —
`the-sunset-webcam-map`). Both implementation plans MUST cite this document. Where
this contract and a source spec disagree, this contract wins; divergences are flagged
explicitly in §8.

Source specs reconciled here:
- E: `docs/superpowers/specs/2026-05-15-wifi-onboarding-and-provisioning-design.md`
- F: `docs/superpowers/specs/2026-06-13-wizard-reconciliation-design.md`
- Umbrella: `docs/superpowers/specs/2026-05-15-streamlined-deployment-overview.md`
- Wire protocol: `docs/device-protocol.md`
- Current code (read 2026-06-13, all paths under `the-sunset-webcam-map`):
  - `app/api/cameras/setup-status/[claim_code]/route.ts`
  - `app/api/cameras/pre-register/route.ts`
  - `app/api/cameras/register/route.ts`
  - `app/api/cameras/[id]/heartbeat/route.ts`
  - `app/lib/cameraClaimCode.ts`, `app/lib/cameraRegistration.ts`
  - `app/setup/[claim_code]/{WizardClient,types}.tsx/.ts`, `steps/*`, `lib/*`
  - `database/migrations/20260516_cameras_either_order_registration.sql`

The two sides never call each other directly. **The claim code is the only shared
key, and the cloud DB row (`cameras` keyed by `claim_code`) is the only shared
state.** E's device writes to that row via `register`/`heartbeat`; F's wizard writes
to it via `pre-register` and reads it via `setup-status`.

---

## 0. Cloud file ownership

All cloud-side bracket persistence is owned by **sub-project F**. To avoid two plans
authoring the same files, the following are F-owned (F plan Tasks 4–7); E only
**verifies** they exist (E plan Task 0) and **consumes** the endpoints from the device:

- `database/migrations/20260613_cameras_bracket_provenance.sql` (F plan Task 4)
- `app/lib/cameraRegistration.ts` — `CameraUpsertInput` + `upsertCameraByClaimCode`
  INSERT/UPDATE (F plan Task 5)
- `app/api/cameras/pre-register/route.ts` — validation/parse (`parseBracket`, the
  single canonical validator) + forward to upsert (F plan Task 6)
- `app/api/cameras/register/route.ts` — `azimuth_source`/`coarse`/`bracket`
  SELECT + `placement` emit block (F plan Task 7)
- `app/api/cameras/[id]/heartbeat/route.ts` — same SELECT + emit block (F plan Task 7)

E's firmware plan must NOT author or rewrite any of these; it depends on them.
(`app/api/admin/claim-codes/route.ts` `ttlDays` forwarding is the one cloud edit the E
plan keeps, since it is part of the provisioning path — E plan Task 16b.)

---

## 1. Claim-code binding end-to-end

One opaque token threads sticker → SD `config.json` → wizard URL → cloud row. No
other identifier is ever human-handled.

| Stage | Form | Owner | Authority |
|---|---|---|---|
| Mint | `POST /api/admin/claim-codes` (Bearer `CRON_SECRET`) → `{ code, expires_at }` | operator script (`provision-unit.sh`) | cloud |
| Format | `SUNSET-XXXX-XXXX`, regex `^SUNSET-[A-HJKMNPQRTUVWXYZ2-9]{4}-[A-HJKMNPQRTUVWXYZ2-9]{4}$` | `app/lib/cameraClaimCode.ts` | cloud |
| Sticker | human-readable code + URL + QR encoding `https://sunrisesunset.studio/setup/<code>` | operator | — |
| SD `config.json` | `{ "claim_code": "<code>" }` — **and nothing else** (no lat/lng, no WiFi, no placement) | `provision-unit.sh` (E §5.2) | firmware |
| Wizard URL | `/setup/[claim_code]` — `claim_code` is the route param, read by `page.tsx` and passed to `WizardClient` | F | cloud |
| Device → cloud | `register`/`heartbeat` send the same `claim_code` | firmware | — |
| Wizard → cloud | `pre-register` / `setup-status` send the same `claim_code` | F | — |

**Invariants**
- **CC-1**: The code on the sticker === the code in `config.json` === the code in the
  QR URL. `provision-unit.sh` mints once and uses that one value for all three.
- **CC-2**: Codes are single-use and expire (default 30 days). Both `register` and
  `pre-register` reject `404` (unknown) and `410` (expired). Only `register`
  *consumes* the code (sets `consumed_at`); `pre-register` and `setup-status` never
  consume it.
- **CC-3**: TTL caution — the code is minted at provisioning time but consumed only
  when the recipient powers the unit on. A unit that sits in a box >30 days ships a
  dead code. **Shipped units MUST be minted effectively NON-EXPIRING:** `provision-unit.sh`
  passes a very long TTL (`ttlDays ~3650`, ≈10 years) or uses a dedicated `shipped`
  no-expiry path. Rationale: the code lives on the physical sticker for the device's
  *life* and MUST stay valid to support **recommissioning** (a relocated/re-aimed
  camera re-scans the same permanent QR — see §11). The 30-day default is
  **operator/test-only** (short-lived bench codes). `mintClaimCode` already accepts
  `ttlDays`; `provision-unit.sh` must pass the long/shipped value, keeping 30d only for
  test codes. This ties to **PR-3**: because shipped codes are consumed at first boot
  but never expire, pre-register must keep accepting the consumed-but-unexpired code on
  every recommission. (This is the "expired capture window" risk also noted in operator
  memory.)
- **CC-4**: `claim_code` is the join key on the `cameras` table
  (`cameras.claim_code`, indexed). It is NOT in `device-protocol.md` §10's schema; it
  was added by migration `20260516_…` (see §8 divergence D-1).

---

## 2. Device lifecycle ⟷ cloud setup-status lifecycle

Two state machines run independently and rendezvous on the `cameras` row.

### 2.1 Device states (E §5.3, firmware-owned)

`BOOT → SETUP → ONLINE → {IDLE | ACTIVE}`, with `IDLE → ACTIVE` on placement arrival.

- **SETUP** — no usable WiFi creds; AP `Sunset-Cam-XXXX` + captive Flask up; capture paused.
- **ONLINE** — joined WiFi; reachable; capture paused; about to call `register`.
- **IDLE** — registered, `placement_status != ready`; heartbeats with `request_placement: true` on a **bounded backoff** (≈30 s cadence early, backing off to a longer ceiling) so a device whose recipient abandons the wizard does not poll forever (see LC-4).
- **ACTIVE** — placement `ready`; normal capture loop (`device-protocol.md` §9).

### 2.2 Cloud setup-status states (F-facing, cloud-owned)

`GET /api/cameras/setup-status/[claim_code]` → `{ status }`. **The ACTUAL current
implementation returns four values, not the three named in E §5.6.** Authoritative
set for this contract:

| `status` | Meaning | Row condition (per `derivePlacementStatus` + sentinel check) |
|---|---|---|
| `awaiting_wifi` | No real device row yet | No `cameras` row for the code, **or** a pre-register-first row whose `hardware_id`/`device_token_hash` both equal the sentinel `pending-<code>` |
| `registered` | Device called `register`, but no location yet | row exists, real device fields, `lat`/`lng` null (`derivePlacementStatus → awaiting_location`) |
| `awaiting_aim` | Location present, azimuth/tilt missing | `lat`/`lng` set, `azimuth_deg`/`tilt_deg` null |
| `ready` | Full placement present | `lat,lng,azimuth_deg,tilt_deg` all non-null |

> **Note on `'unknown'`**: F's client `DeviceStatus` TS union carries an extra
> `'unknown'` sentinel for the wizard's pre-first-poll initial state. It is a
> **client-only** value — `setup-status` NEVER returns `'unknown'` over the wire (the
> four values above are the complete server vocabulary). Keep it in F's union, but no
> endpoint produces it.

### 2.3 The mapping (authoritative)

| Device state | setup-status value the wizard sees | How it gets there |
|---|---|---|
| SETUP | `awaiting_wifi` | no register call has landed |
| ONLINE (pre-`register`) | `awaiting_wifi` | still no row (or sentinel-only row from a pre-register-first) |
| IDLE (registered, no placement) | `registered` | device `register` created/filled the device half; `lat/lng` still null |
| IDLE (location only) | `awaiting_aim` | rare for bracket flow; device-supplied geo without aim |
| ACTIVE | `ready` | `pre-register` (or device `register`) filled placement |

**Invariants**
- **LC-1**: The wizard's `ConfirmCamera` (Screen 1) treats **any** status `!=
  awaiting_wifi` as "device is online, advance." It does NOT require `ready` —
  `ready` is reached only *after* the wizard itself submits `pre-register`. So Screen
  1 advances on `registered`/`awaiting_aim`.
- **LC-2**: `setup-status` returns `404` for unknown/expired codes; the wizard surfaces
  "Unknown or expired claim code."
- **LC-3**: A pre-register-first row (wizard ran before the device booted) is reported
  as `awaiting_wifi` until the device's `register` swaps the sentinel for real device
  fields — i.e. setup-status reflects *device presence*, never wizard progress.
- **LC-4 (abandoned flow / stranded IDLE)**: a device may register and then sit in IDLE
  indefinitely if the recipient abandons the wizard before Submit. The device's IDLE
  heartbeat therefore uses **bounded backoff** (not a fixed forever-30 s poll). The
  wizard must support re-entry: the `claim_code` URL is **resumable** (re-opening
  `/setup/[claim_code]` resumes setup), and the wizard has a distinct
  **"device registered but placement not yet submitted"** re-entry state (setup-status
  `registered`/`awaiting_aim` on first load → land the operator in the bracket flow, not
  Screen 1's "waiting for the device").
- **LC-5 (410 at Submit, not just Connect)**: a unit whose code is near TTL can expire
  *mid-flow*. The wizard must surface setup-status `404`/`410` (`"Unknown or expired
  claim code"`) on the **final Submit** as well as on Screen 1 (Connect) — pre-register
  can return `410` at the last step even though Connect succeeded earlier.

### 2.4 Bench-test lifecycle (operator dry-run before ship)

A unit is exercised end-to-end at the bench before it ships, using the SAME flow the
customer will use — proving the seam, not a separate mode:

`provision → SETUP → **operator** onboards to operator WiFi → a `testing` deployment
(private, discardable) → verify capture/post → DECOMMISSION (end the testing deployment
+ optional WiFi-wipe) → ship clean → **customer** onboards → `deployed` deployment.`

Because shipped codes are non-expiring (CC-3) and the device keeps its token across
recommission (§11d), the bench `testing` deployment and the field `deployed` deployment
are two deployments on the same camera (1:many) — the bench one is ended at
decommission, not carried to the customer. WiFi-wipe at decommission is the "clean
ship" nicety (§12); auto-SETUP would handle a new location regardless.

---

## 3. `register` — request/response & either-order semantics (E Amendments A/B)

`POST /api/cameras/register`, body-borne `claim_code` (no Bearer). **First boot only;
consumes the code.**

### 3.1 Request (firmware-sent). CURRENT code accepts ONLY:
```jsonc
{
  "claim_code":  "SUNSET-7K3M-9XQ2",   // required
  "hardware_id": "pi-zero-2w-...",       // required
  "firmware_version": "0.3.0",            // optional
  "capabilities": { ... }                  // optional, stored as jsonb
}
```
Placement / lat-lng / operator_preferences in the request body are **silently
ignored** by the current handler (see §8 divergence D-2). For the bracket-first flow
this is acceptable: the device never supplies placement — the wizard does, via
`pre-register`. The device half is device-identity only.

### 3.2 Response (cloud-sent):
```jsonc
{
  "camera_id": 17,
  "device_token": "<64-char hex>",        // returned exactly once
  "placement_status": "ready" | "awaiting_location" | "awaiting_aim",
  "placement": { ... }                      // present IFF placement_status === "ready"
}
```
`placement` (when `ready`) carries: `lat, lng, elevation_m, timezone, azimuth_deg,
tilt_deg, horizon_altitude_deg, horizon_profile, phase_preference,
delivery_preferences`. (No bracket fields today — see §8 D-3.)

### 3.3 Either-order (Amendment A — IMPLEMENTED)
- **register-first** (the captive-portal norm): no row exists → insert a row with
  device fields + `phase_preference=NULL` (NOT `'both'`), no placement → respond
  `placement_status: "awaiting_location"`, no `placement`. Device → IDLE. Later
  `pre-register` fills placement AND sets `phase_preference` to `sunrise|sunset`; device
  gets it via heartbeat. **A bracket install MUST NOT reach ACTIVE with
  `phase_preference='both'`** — the bracket aims a single event, so the register-first
  default is NULL, forcing the wizard to pick `sunrise|sunset` (see §8 D-8).
- **pre-register-first** (wizard ran before boot): a sentinel row exists
  (`hardware_id = device_token_hash = "pending-<code>"`) with placement already set →
  `register` UPDATEs that row's device fields and responds `placement_status:
  "ready"` + full `placement`. Device → ACTIVE directly (skips IDLE).

**Errors** (current code): `400` missing `claim_code`/`hardware_id`; `404` unknown
code; `410` expired; `409` code already consumed **or** `hardware_id` collision
(latter includes `existing_camera_id`).

**Note on Amendment B**: E spec named only `"pending"|"ready"`. The actual handler
returns the finer `awaiting_location | awaiting_aim | ready`. Firmware MUST treat
**anything other than `ready`** as "go IDLE, poll." (§8 D-4.)

---

## 4. `pre-register` — request schema + REQUIRED bracket additions

`POST /api/cameras/pre-register`, body-borne `claim_code`, no Bearer. Wizard-sent at
the final Submit step. Idempotent per code (overwrite-on-repeat). Never consumes the
code, never mints a token. **Returns HTTP 202** (current code) — F's `SubmitStep`
only checks `res.ok`, so 202 is fine.

**PR-3 (consumed-but-unexpired codes)**: pre-register MUST accept a claim code that is
already consumed (`consumed_at` set, `consumed_by_camera_id` populated) as long as it is
unexpired. In the register-first flow — the captive-portal norm — the device's
`register` call has *already consumed* the code by the time the wizard reaches Submit,
so a consumed code is the **normal** state at pre-register. Only `register` consumes;
pre-register rejects only `404` (unknown) and `410` (expired), never `409` for a
consumed code. (F plan Task 6 has a test mocking `getClaimCode` with `consumed_at` set.)

### 4.1 What the handler accepts and validates TODAY
Required (else `400`): `claim_code`, `lat`, `lng`, `timezone`,
`placement.azimuth_deg`, `placement.tilt_deg`, `operator_preferences.phase_preference`
∈ `sunrise|sunset|both`. Optional: `elevation_m`, `placement.horizon_altitude_deg`
(defaults 0), `placement.horizon_profile` (array|null), `operator_preferences.delivery`.
Response: `{ camera_id, placement_status }`.

### 4.2 The full payload the F reconciliation spec REQUIRES (target contract)
```jsonc
{
  "claim_code": "SUNSET-7K3M-9XQ2",
  "lat": 47.6062,
  "lng": -122.3321,
  "elevation_m": 30,
  "timezone": "America/Los_Angeles",
  "placement": {
    "azimuth_deg": 271.4,          // realized bracket aim (window_normal + snapped wedge ≈ equinox); COARSE
    "tilt_deg": 0,                 // v19: always 0 (camera level)
    "horizon_altitude_deg": 0,     // horizon-sweep dropped v1
    "horizon_profile": null,
    "azimuth_source": "bracket",   // NEW — 'bracket' (coarse) | 'sun' (precise); drives Pi sun self-refine
    "coarse": true,                // NEW
    "bracket": {                   // NEW — full provenance from the bracket prototype
      "window_normal_az_true": 263.0,
      "window_azimuth_offset_deg": 8.4,
      "window_offset_side": "north" | "south",   // canonical solver vocab; null at a 0° wedge
      "wedge_angle_deg": 8,
      "flip_direction": "north" | "south" | null, // null at a 0° (flat, symmetric) wedge
      "residual_aim_error_deg": 0.6,
      "lens": "wide_120" | "standard_66",
      "material_thickness_mm": 3.0   // fixed v1 case thickness (sourced from the part spec)
    }
  },
  "operator_preferences": {
    "phase_preference": "sunset",  // 'sunrise' | 'sunset' (bracket flow drops 'both')
    "delivery": null               // null when "Skip for now"
  }
}
```

### 4.3 EXACTLY what must be ADDED to reach the target (work items)
The current handler/lib do **none** of the bracket persistence. Required changes:

1. **Validation/parse** in `pre-register/route.ts`: accept `placement.azimuth_source`,
   `placement.coarse`, and the nested `placement.bracket` object. Validate `lens` ∈
   `{wide_120, standard_66}`, `window_offset_side` ∈ `{north, south}` **or `null`**,
   `flip_direction` ∈ `{north, south}` **or `null`**; numbers finite. The enum check is
   **NULL-TOLERANT** — only enum-check `window_offset_side`/`flip_direction` when the
   value is non-null (both are `null` at a 0° / flat-symmetric wedge, which is the
   bracket prototype solver's normal output). `tilt_deg` is allowed to be `0` (current
   `asNumber(0)` → `0`, passes the non-null check — OK). The canonical validator is F's
   `parseBracket` (see F plan Task 6) — F owns this file (see §0 Cloud file ownership).
2. **`CameraUpsertInput`** in `app/lib/cameraRegistration.ts`: add
   `azimuth_source: string | null`, `coarse: boolean | null`, `bracket: unknown`.
3. **`upsertCameraByClaimCode`** UPDATE + INSERT: persist the three new fields.
4. **DB migration**: `ALTER TABLE cameras ADD COLUMN azimuth_source TEXT`,
   `ADD COLUMN coarse BOOLEAN`, `ADD COLUMN bracket JSONB`. (No such migration exists
   today — see §8 D-3.) **DEPLOY ORDERING (required):** the migration is forward-only
   and idempotent (`ADD COLUMN IF NOT EXISTS`) and MUST be applied to the database
   BEFORE shipping any route code that SELECTs `azimuth_source`/`coarse`/`bracket`
   (items 1, 3, 5). If route code that references the columns ships first,
   `register`/`heartbeat`/`pre-register` will 500 for **every** camera (not just bracket
   installs), because the SELECT references columns that don't yet exist.
5. **`register` + `heartbeat` placement blocks**: include `azimuth_source`, `coarse`,
   `bracket` in the `placement` object so the Pi receives them and the sun-self-refine
   loop can read `azimuth_source/coarse`.
6. **F `WizardState`/`SubmitStep`**: the current `SubmitStep` sends NO bracket fields
   and hard-codes `horizon_altitude_deg: 0`. It must be extended to carry the bracket
   provenance from the new bracket steps (reconciliation spec steps 2–7).

**Invariant PR-1**: `azimuth_deg` submitted by the bracket flow is the *realized,
coarse* aim. The pair (`azimuth_source: 'bracket'`, `coarse: true`) is the signal that
the Pi must sun-self-refine. Omitting them defaults to the legacy "precise" assumption
and disables refine — so they are REQUIRED for bracket installs.

**Invariant PR-2 (azimuth_source ⟷ bracket consistency)**: pre-register MUST enforce
that if `placement.bracket` is present, `azimuth_source === 'bracket'` **and**
`coarse === true` — else `400`. Equivalently, the handler MAY default
`azimuth_source`/`coarse` to `'bracket'`/`true` when `bracket` is present. A `bracket`
blob without these signals is a contradiction (it would persist provenance but disable
the very refine that the provenance exists to drive). F's `pre-register` owns this
check (F plan Task 6, with a dedicated test).

---

## 5. Heartbeat placement-delivery (E Amendment C — IMPLEMENTED)

`POST /api/cameras/[id]/heartbeat`, Bearer `device_token`. Implemented in
`app/api/cameras/[id]/heartbeat/route.ts`.

- Device in **IDLE** sends `{ "request_placement": true }` every ~30 s.
- If `request_placement !== true`: response is `{ acknowledged_at }` only.
- If `true`, response carries `placement_status` and, when `ready`, the full
  `placement` block (same shape as `register`'s, to be extended with bracket fields
  per §4.3.5). On `awaiting_aim` it also returns `lat,lng`.
- When the device sees `placement_status: "ready"` in a heartbeat, it transitions
  **IDLE → ACTIVE**. This is the channel that closes the loop when the device
  registered *before* the wizard finished.

**Divergences from E spec text** (§8 D-5): the implemented response uses
`acknowledged_at` (not the spec's `acknowledge`/`ack`+`server_time`), and there is NO
`config_overrides`, `next_heartbeat_in_s`, `stream_request`, or `edge_model_update` in
the current handler. The device-protocol.md §6.3 full heartbeat response is **not yet
built**; only the placement-delivery slice is. Firmware must not depend on
`config_overrides`/`next_heartbeat_in_s` from heartbeat yet.

---

## 6. The authoritative handoff timeline

Numbered, with the exact call, direction, and resulting state. "D" = device (E),
"R" = recipient, "W" = wizard (F), "C" = cloud API.

1. **(operator, pre-ship)** `provision-unit.sh` → `C POST /api/admin/claim-codes` →
   mints `code`; writes `{claim_code: code}` to SD `config.json`; prints sticker (code
   + QR → `/setup/code`). [CC-1, CC-3]
2. **(R)** Unboxes, powers on. **D: BOOT → SETUP** (no WiFi creds); AP
   `Sunset-Cam-XXXX` + captive Flask up.
3. **(R)** Scans QR → phone opens `W /setup/[claim_code]`. **W Screen 1
   (ConfirmCamera)** begins polling `C GET /api/cameras/setup-status/[code]` every 3 s.
   Initially `awaiting_wifi`.
4. **(R)** Per Screen-1 instructions, joins phone to `Sunset-Cam-XXXX`; captive sheet
   pops the device-local form; submits home-WiFi SSID + password to **D
   `POST /wifi`** (device-local, NOT a cloud call).
5. **D** writes `wpa_supplicant.conf`, tears down AP, associates (≤15 s). On success
   **D: SETUP → ONLINE**. (On failure: stays SETUP, form shows "wrong password?".)
6. **D ONLINE** → `C POST /api/cameras/register` with `{claim_code, hardware_id,
   firmware_version, capabilities}`. Code consumed; `device_token` returned.
   - register-first (typical): `placement_status: "awaiting_location"` → **D: ONLINE →
     IDLE**.
   - pre-register-first (if W already submitted): `placement_status: "ready"` +
     `placement` → **D: ONLINE → ACTIVE** (jump to step 11).
7. **(R)** Reconnects phone to home WiFi, returns to the still-open W tab.
8. **W Screen 1** poll now sees `registered` (or `awaiting_aim`) → status `!=
   awaiting_wifi` → **auto-advances** [LC-1].
9. **W** runs the bracket placement flow (reconciliation steps 2–7): phase →
   measure window → hinge to equinox → bracket spec → assemble → mount & confirm.
   Computes realized coarse `azimuth_deg` + full `bracket` provenance. Captures
   `lat/lng/elevation_m` (phone geolocation) and `timezone` (browser).
10. **W Submit step** → `C POST /api/cameras/pre-register` with the §4.2 payload
    (incl. `azimuth_source:'bracket'`, `coarse:true`, `bracket{…}`). Server matches the
    existing register-first row by `claim_code`, fills placement → row becomes `ready`.
    202 → wizard shows success.
11. **D IDLE** next heartbeat `C POST /api/cameras/[id]/heartbeat
    {request_placement:true}` → response `placement_status:"ready"` + `placement`
    (with bracket fields) → **D: IDLE → ACTIVE**. (If step 6 already returned ready,
    this step is skipped.)
12. **D ACTIVE** runs the capture loop; sun-self-refine reads `azimuth_source:'bracket'`
    / `coarse:true` and tightens `azimuth_deg` over subsequent windows [PR-1].

Recipient-touch budget: two WiFi networks (device AP, then home), one URL, zero typed
config — exactly E's promise.

---

## 7. Contract invariants (cross-cutting checklist)

- **I-1** Claim code is the *only* shared key; the `cameras` row is the *only* shared
  state. Neither sub-project imports the other's code.
- **I-2** Only `register` consumes the code and mints the token; `pre-register`,
  `setup-status`, `heartbeat` never do.
- **I-3** Either order is supported and converges on the same `ready` row; the late
  party (device via heartbeat, or wizard via pre-register) fills the missing half.
- **I-4** `setup-status` reflects **device presence + placement completeness**, never
  wizard UI progress. Screen 1 advances on `!= awaiting_wifi`.
- **I-5** Bracket installs MUST send `azimuth_source:'bracket'` + `coarse:true` +
  `bracket{}`; this is the signal driving on-device sun refine. (Requires §4.3 work.)
- **I-6** `tilt_deg` is `0` for v1 (no vertical tilt); `horizon_altitude_deg` is `0`
  (horizon-sweep dropped); `horizon_profile` is `null`.
- **I-7** All cloud endpoints are HTTPS-only. `setup-status`/`pre-register`/`register`
  are unauthenticated but claim-code-bearer; rate-limit to mitigate enumeration
  (not yet implemented — tracked, not blocking).

---

## 8. Divergences: existing code vs. the specs (FLAGGED)

- **D-1 — `cameras.claim_code` column is undocumented in the protocol.**
  `device-protocol.md` §10 has no `claim_code` column on `cameras`; the code relies on
  it (added by `20260516_…`). The protocol schema must be amended to match. (Code is
  ahead of doc; code is correct.)
- **D-2 — `register` ignores body placement/lat-lng/operator_preferences.** The
  protocol's `register` request (§6.2) shows a rich body; the current handler parses
  ONLY `claim_code, hardware_id, firmware_version, capabilities`. For the bracket-first
  flow this is fine (device never supplies placement), but firmware authors must NOT
  expect device-supplied lat/lng to persist. Decision for this contract: **device half
  is identity-only; placement always comes from the wizard.** Aligns with reconciliation
  spec; diverges from protocol §6.2.
- **D-3 — bracket provenance is NOT persisted anywhere.** No
  `azimuth_source`/`coarse`/`bracket` columns, no validation, not in `pre-register`,
  `register`, or `heartbeat` responses, and `SubmitStep` doesn't send them. This is the
  largest gap; §4.3 enumerates the exact additions. The F reconciliation spec is the
  authority; code lags.
- **D-4 — `placement_status` enum is finer than E spec.** E Amendment B says
  `"pending"|"ready"`; code returns `awaiting_location | awaiting_aim | ready`.
  Contract resolution: firmware treats **non-`ready` ⇒ IDLE/poll**. Cloud keeps the
  three-value enum (more informative for the wizard). Update E spec text to match.
- **D-5 — heartbeat response is a thin slice, not protocol §6.3.** Implemented
  response is `{ acknowledged_at, placement_status, placement?, lat?, lng? }` — no
  `ack`/`server_time`/`config_overrides`/`next_heartbeat_in_s`/`stream_request`/
  `edge_model_update`. Firmware must not depend on those fields from heartbeat yet.
- **D-6 — setup-status returns 4 states, E §5.6 named 3.** Actual:
  `awaiting_wifi | registered | awaiting_aim | ready`. F's `WizardState` /
  `ConfirmCamera` only type three (`awaiting_wifi|registered|ready`) — `awaiting_aim`
  is unhandled in the wizard's TS union and would fall through. F must widen its
  `StatusResponse`/`deviceStatus` union to include `awaiting_aim` (treat as advance).
- **D-7 — `pre-register` returns 202, F checks only `res.ok`.** This contract pins
  **202 = success** as the single canonical value (no "align to 200" alternative — the
  protocol §6.2a's 200 is superseded here). F treats 2xx as ok (it already does).
- **D-8 — `phase_preference` still accepts `'both'`.** Reconciliation spec drops
  `both` for single-aimed bracket cameras, but `PHASE_VALUES` still includes it. The
  register-first INSERT default is now `NULL` (NOT `'both'`) — see §3.3 / Fix 8 — so a
  bracket install cannot reach ACTIVE with `phase='both'`; the wizard must set
  `sunrise|sunset`. F's UI offers only `sunrise|sunset`; the `pre-register` API may stay
  permissive about accepting `'both'` for legacy callers, but the bracket flow never
  sends it.

---

## 9. QR → WiFi handoff timeline (credential entry, network switch)

This expands §6 specifically around the WiFi/credential seam. The phone runs the
cloud wizard over **its own current internet (cellular, or whatever WiFi the phone is
already on)** — the wizard NEVER depends on the camera's WiFi or the home WiFi.

1. **Scan QR** → the phone opens the cloud wizard at `/setup/{code}` **over cellular**
   (or the phone's existing internet). The wizard loads independent of any local network.
2. The wizard instructs: **"join Sunset-Cam-XXXX"** (the Pi's open AP, SETUP mode).
3. The recipient **joins the phone to the Pi's open AP**. The Pi's captive page pops
   (system captive sheet).
4. The recipient **enters the home-WiFi credentials ONCE** on that captive page.
5. The Pi **writes the creds, drops its AP, and joins home WiFi**, then calls `register`.
6. When the AP drops, the **phone AUTO-REJOINS its known home WiFi** (the network it
   already remembers) — the recipient does not retype anything.
7. The recipient returns to the still-open wizard tab; the wizard **polls
   `setup-status`**, sees `!= awaiting_wifi`, and **advances to placement**.

**KEY INVARIANTS**
- **HT-1**: The WiFi password is entered **exactly ONCE** (on the Pi's captive page).
- **HT-2**: The network switch is **taps, not re-typed credentials** — joining the Pi
  AP and rejoining home WiFi are both tap-to-select against networks the phone already
  has (the Pi AP is open; home WiFi is remembered).
- **HT-3**: The **cloud wizard never depends on WiFi** — it runs on cellular/whatever
  the phone already has, so the network dance below it does not interrupt the wizard.
- **HT-4 (no double credential entry across the lifecycle)**: across the FULL
  lifecycle there is no double credential entry. The **operator** enters home/operator
  WiFi once at the bench (then it is wiped on decommission, §12), and the **customer**
  enters home WiFi once at install. Neither retypes the other's creds.
- **HT-5 (known UX risk)**: iOS captive auto-pop is unreliable. Wizard copy MUST
  hedge: *"If the page doesn't appear, open any website."* (forces the captive sheet).

## 10. Single state-aware wizard entry

The QR / wizard is **ONE entry point** for a camera's whole life. The wizard reads the
camera's commission state (via `setup-status` + the camera row) and routes:

- **Fresh camera** (no active deployment / never placed) → straight into the
  **commission flow** (§6/§9 → bracket placement).
- **Already-placed camera** (active deployment exists) → the wizard opens offering, at
  the **TOP**:
  - **"Re-aim / move this camera"** — *primary* action (re-runs the wizard, §11).
  - **"Turn off / decommission"** — *secondary*, present but not in the way (§12).

**SE-1**: Recommissioning = **re-running the wizard**. The user NEVER has to find a
decommission button first in order to recommission — re-aim/move is the primary path
and a new placement commit handles the deployment lifecycle automatically (§11c).

## 11. Recommissioning / relocation

A permanent QR + a life-of-device claim code (CC-3) make the same sticker the entry
point for every move. Cases:

- **11a — moved to a NEW network.** On boot the old WiFi creds fail to associate
  (BOOT → try-associate → fail(≈15s) → SETUP — the *existing* path, no new trigger).
  The recipient re-scans the QR and re-onboards the new WiFi exactly as §9. There is
  **no separate "relocate" trigger** — association failure is the trigger.
- **11b — re-aim / same network.** The unit is already online; the user re-scans the
  permanent QR, the wizard opens in the already-placed state (§10), picks "Re-aim,"
  and submits a new placement via `pre-register`. PR-3 applies: the code is
  consumed-but-unexpired and pre-register accepts it.
- **11c — deployment lifecycle on a new placement commit.** A new placement commit
  **AUTO-ENDS the prior deployment**. A move **> 100 m** makes it a **NEW deployment**
  with a fresh archive (camera : deployment is **1:many**); a move **≤ 100 m** re-aims
  the **active** deployment in place (GPS jitter never splits a feed). See the firmware
  deployment-model doc for the canonical `testing → deployed → ended` states.
- **11d — token persistence.** The device **KEEPS its `device_token` across
  recommission** — it does NOT re-register. Recommission changes the deployment/placement
  (and possibly WiFi), never device identity. (Only a brand-new unit's first boot ever
  calls `register`/consumes a fresh-mint; a relocated unit reuses its token and reaches
  the cloud via heartbeat with the new placement.)

## 12. Pause vs decommission

Two distinct stop actions, both triggerable by the **operator** (My Cameras) AND the
**customer** (the open-access QR/setup page scoped to that one camera, no account):

- **PAUSE** = stop capture, **keep WiFi + the active deployment**, fully resumable
  ("turn it off for now"). The deployment stays active; resuming restarts capture.
- **DECOMMISSION** = **end the active deployment cloud-side** (archive frozen or
  discarded) **+ OPTIONAL WiFi-wipe**. The WiFi-wipe is a "clean ship" nicety only —
  because a relocated unit auto-re-enters SETUP on association failure (§11a) anyway,
  wiping creds is **optional**, not required for relocation.

**PD-1 (device executes the wipe via a directive)**: when decommission-with-relocation
is chosen, the device clears its `wpa_supplicant` creds via a heartbeat **DIRECTIVE**
(`reprovision`/`wipe_wifi`, §13) when it is next online → it falls back to SETUP.
**PD-2 (UNPLUG ≠ DECOMMISSION)**: unplugging is just power-off — the deployment and the
WiFi creds stay intact; plugging back in resumes. There is **NO physical reset button**
(unplug is the only physical control).
**PD-3 (open-QR decommission risk)**: a passerby could turn a camera off via the open
QR. This is **fully recoverable** by re-commissioning (re-scan, re-onboard). An
armed-toggle / confirm gate MAY be added later if abused — server-side, no label
reprint (mirrors the deployment-model doc's deferrable armed-toggle).

## 13. Decommission/pause action surface + heartbeat directives (new seams)

These are the cloud seams the above sections imply. They follow the existing
claim-code-scoped, open-for-the-setup-page pattern (I-7).

- **Decommission/pause action surface** — usable by **both** the operator and the
  open-access setup page. Either:
  - `POST /api/cameras/{id|code}/decommission` and `POST /api/cameras/{id|code}/pause`, or
  - a field on an existing camera-action endpoint.
  Shape: **claim-code-scoped** (the open setup page authenticates with *only* the claim
  code — no account, no Bearer, exactly as `setup-status`/`pre-register`; the operator
  path may additionally use its existing auth). `decommission` **ends** the active
  deployment (`ended_at` set; `state → ended`) and MAY set a `wipe_wifi` flag that the
  next heartbeat surfaces as a directive; `pause` **pauses** capture on the active
  deployment without ending it. Rate-limit per I-7.
  > **Keying decision (judgment call):** the open-access page only ever holds the
  > **claim_code** (the QR encodes the code, not the serial `id`), so the
  > **claim-code-scoped form is authoritative for the customer path**; the `{id}` form
  > is a convenience for the authenticated operator (My Cameras already knows the id).
  > A single endpoint SHOULD accept either key and resolve to the same camera row.
- **Heartbeat `reprovision` / `wipe_wifi` directive** — the device honors a heartbeat
  directive instructing it to clear `wpa_supplicant` creds and drop to SETUP (the device
  half of a cloud-triggered decommission-with-relocation, §12 PD-1). It rides the same
  heartbeat-response channel as placement delivery (§5).
- **Deployment lifecycle states** referenced throughout: **`testing | deployed | ended`**
  (see the firmware deployment-model doc for the canonical definitions and the
  >100 m / ≤100 m commit rule).

---

## Lifecycle addendum (2026-06-13)

Agreed device-lifecycle refinements folded into this contract (and the E/F plans +
the firmware deployment-model doc). Summary of items 1–6:

1. **Shipped-code TTL (CC-3 amended).** `provision-unit.sh` mints shipped codes
   effectively non-expiring (`ttlDays ~3650` or a `shipped` no-expiry path); the
   sticker code must stay valid for the device's life to support recommissioning. 30d
   is operator/test-only. Ties to PR-3 (consumed-but-unexpired accepted).
2. **QR → WiFi handoff timeline (§9).** Wizard runs on cellular; WiFi password entered
   exactly once; network switch is taps not re-typed creds; no double credential entry
   across operator-bench-then-customer; iOS captive auto-pop hedge copy.
3. **Single state-aware wizard entry (§10).** One QR/entry point: fresh → commission;
   already-placed → "Re-aim/move" (primary) + "Turn off/decommission" (secondary).
   Recommission = re-run the wizard; no hunt for a decommission button first.
4. **Recommissioning / relocation (§11).** New network → association fails → auto-SETUP
   (existing path, no new trigger). Re-aim same network → re-scan permanent QR →
   pre-register (PR-3). New commit auto-ends the prior deployment; >100 m = new
   deployment + fresh archive (1:many); device keeps its `device_token`.
5. **Pause vs decommission (§12).** PAUSE = stop capture, keep WiFi+deployment,
   resumable. DECOMMISSION = end the active deployment + OPTIONAL WiFi-wipe. Both
   operator- and customer-triggerable; device wipes WiFi via a heartbeat directive when
   online. UNPLUG ≠ DECOMMISSION; no physical reset button; open-QR decommission risk
   is recoverable (armed-toggle deferrable).
6. **Bench-test lifecycle (§13/timeline).** provision → SETUP → operator onboards to
   operator WiFi → `testing` deployment (private, discardable) → verify capture/post →
   DECOMMISSION (end testing deployment + optional WiFi-wipe) → ship clean → customer
   onboards → `deployed` deployment.

New seams specified: a claim-code-scoped decommission/pause action surface (open for
the setup page, also operator-usable), a heartbeat `reprovision`/`wipe_wifi` directive,
and the `testing | deployed | ended` deployment states.

---

## Reconciliation log (2026-06-13)

Adversarial review of the E/F seam found 9 issues; all fixed in-place across this
contract, the E plan, and the F plan. Summary of what changed and why:

1. **ENUM vocabulary (blocker).** The bracket solver emits `window_offset_side ∈
   {north, south}` and `flip_direction ∈ {north, south} | null` (null at a 0° wedge).
   Contract §4.2/§4.3.1 updated from the stale `left/right` and `up/down/left/right` to
   the canonical `{north, south}` / `{north, south, null}`; the validator is made
   NULL-TOLERANT (enum-check only when non-null). The E plan's conflicting
   `SIDE_VALUES=['left','right']`/`FLIP_VALUES=['up','down','left','right']` validator
   was removed (E no longer owns that file). F's `parseBracket` (north/south/null,
   null-tolerant, finiteness checks) is the single canonical validator.
2. **File ownership (blocker + high).** New §0 names F as sole owner of all cloud-side
   bracket persistence (migration, `cameraRegistration.ts`, `pre-register`, the
   `register`/`heartbeat` SELECT+emit blocks). Duplicate cloud authoring tasks were
   removed from the E plan and replaced with a verify-and-consume dependency note.
3. **Device HTTP client (blocker).** The E plan was missing the device half of the
   rendezvous; added firmware tasks for a register client, a bounded heartbeat-poll
   loop, and a placement consumer that drives sun self-refine, wired into the boot path
   so SETUP→ONLINE→register→IDLE→heartbeat→ACTIVE is real code.
4. **azimuth_source invariant (high).** New PR-2: if `bracket` is present, pre-register
   requires `azimuth_source==='bracket' && coarse===true` (else 400) or defaults them;
   reflected here and given a test in the F plan.
5. **Migration-before-deploy ordering (high).** §4.3 item 4 + §0 now state the
   forward-only/idempotent migration must be applied BEFORE shipping route code that
   SELECTs the new columns, else `register`/`heartbeat` 500 for ALL cameras.
6. **Abandoned-flow / stranded IDLE (high).** IDLE now uses bounded backoff (LC-4); the
   wizard supports a resumable `claim_code` URL and a "registered-but-not-submitted"
   re-entry state; setup-status `404`/`410` surfaced at Submit too, not only Connect
   (LC-5).
7. **Pre-register on a consumed code (medium).** New PR-3: pre-register MUST accept a
   consumed-but-unexpired code (the normal register-first state); F plan gains a test
   mocking `getClaimCode` with `consumed_at`/`consumed_by_camera_id`.
8. **phase 'both' (medium).** §3.3 register-first INSERT now defaults
   `phase_preference` to `NULL` (not `'both'`), forcing the wizard to set
   `sunrise|sunset`; ACTIVE must never be reached with `phase='both'` for a bracket
   install (D-8 updated; reflected in E/F plans).
9. **Minor.** `'unknown'` documented as an F-client-only sentinel never produced by
   setup-status; `material_thickness_mm` annotated as the fixed v1 part-spec thickness;
   pre-register success locked to 202 (the "align to 200" alternative removed from D-7).
