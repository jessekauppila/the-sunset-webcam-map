# Pi Deployment Integration — Auto-Running v0.4 Aiming in the Setup Flow

Status: Draft v0.1 — 2026-06-07
Owner: Jesse Kauppila
The glue between sub-project **E** (WiFi onboarding + provisioning, `2026-05-15-wifi-onboarding-and-provisioning-design.md`) and the now-built **v0.4 sun-tap aiming** (`2026-06-07-pi-alignment-v0.4-sun-tap-aiming-design.md`, which fulfills and exceeds sub-project **C**). Amends E.

---

## 1. Problem

E was written 2026-05-15, before v0.3/v0.4 existed. Three concrete gaps now block the end-to-end deploy:

1. **No AIMING state.** E's state machine goes BOOT → SETUP → ONLINE → IDLE → ACTIVE. It assumes *placement is delivered down from the cloud* (operator pre-register or wizard). But v0.4 *produces* the aim **on the device** when the recipient taps the sun. There is no state where the v0.4 aiming tool runs, and no "auto-launch it" path — so the recipient would still need a typed command, which defeats the goal.
2. **E §5.5's alignment integration is stale.** It wires the old v0.2 routes (`render_align_page`/`stream_mjpeg`/`render_orientation_json`) as three separate registrations and contradicts itself: it says the setup service *exits* after WiFi joins, yet that same service hosts the aiming page, which is used *after* WiFi joins. It knows nothing of the built `setup_server.py`, `/setup/tap`, `HeadingState`, or `fov_fit`.
3. **The location↔aim chicken-and-egg.** The v0.4 overlay needs **lat/lng** to draw the sun — but aiming is what *produces* the placement. The order and data-flow were never pinned down.

## 2. Goals

1. The v0.4 aiming tool **launches automatically** at the right moment in the deploy — no typed command for the recipient (or the operator).
2. Pin the **location↔aim split**: location comes *down* from the cloud wizard; the *aim* (azimuth/tilt) is produced *up* by on-device sun-tap. Placement = location + aim.
3. The recipient can **commit the aim** from the aiming page, and the device then transitions itself to capturing.
4. A unit can be **relocated** (re-aimed at a new spot) without re-flashing.
5. Supersede E §5.5 with the real v0.4 `setup_server` wiring.

## 3. Non-goals (covered elsewhere / deferred)

- **The captive portal / AP-mode / WiFi-credential intake / SD provisioning** — E owns these unchanged.
- **The cloud wizard's internal screens** (collecting lat/lng, delivery prefs) — sub-project F.
- **First-image verification UX** — sub-project G.
- **AI placement-quality checks** — sub-project D.
- **v0.3 auto-calibration** (the precise self-healing fallback) — separate, later.
- **New-WiFi reprovision implementation** — designed at the seam here (§5.6) but built later; same-WiFi re-aim is in scope.

## 4. Relationship to existing specs

- **E** (`2026-05-15-wifi-onboarding...`): this spec amends E's §5.3 state machine (adds AIMING) and replaces E's §5.5 alignment integration. Everything else in E stands.
- **v0.4** (`2026-06-07-pi-alignment-v0.4-sun-tap...`): built and on firmware branch `feat/v0.4-sun-tap-aiming`. This spec adds **one endpoint** (`POST /setup/confirm`) and makes the launcher **config-driven** instead of CLI-flag-driven.
- **C**: considered fulfilled by v0.4 (which exceeds the original roll-only orientation scope).
- **F**: consumes the handoff contract defined here (deep-link to the device aiming page; collect location; poll placement status).

## 5. Design

### 5.1 The three-mode architecture + the AIMING state

The device has three mutually-exclusive-where-they-share-the-camera modes, each a systemd unit:

| Mode | Service | Camera | Network | Purpose |
|---|---|---|---|---|
| **SETUP** | `sunset-cam-setup` (E) | no | own AP | collect WiFi creds (captive portal) |
| **AIMING** | `sunset-cam-aiming` (**new**) | **yes** | home WiFi | run `setup_server.py`; recipient sun-taps + confirms |
| **ACTIVE** | `sunset-cam` | **yes** | home WiFi | capture loop |

`sunset-cam-aiming.service` declares `Conflicts=sunset-cam.service` (and vice versa) so the camera is never double-claimed — the deployment-side enforcement of v0.4's camera-arbitration requirement. SETUP needs no camera, so it doesn't conflict on that resource (it already conflicts with ACTIVE in E for process-coordination reasons).

Updated state machine (replaces E §5.3's tail end):

```
... ONLINE --/register--> placement_status?
      "awaiting_location"  -> IDLE  (heartbeat; wait for lat/lng)
      "awaiting_aim"       -> AIMING (auto-launch sunset-cam-aiming)
      "ready"              -> ACTIVE (operator pre-set everything; legacy)

IDLE --lat/lng arrives via heartbeat--> AIMING
AIMING --recipient confirms aim (POST /setup/confirm)--> ACTIVE
ACTIVE --cloud "reaim" command (heartbeat)--> AIMING        (relocation, same WiFi)
ACTIVE --cloud "reprovision" command (heartbeat)--> SETUP   (relocation, new WiFi; §5.6)
```

A small supervisor (extending E's slice-4 state machine) owns these transitions: it starts/stops `sunset-cam-aiming` vs `sunset-cam` based on the placement status it learns from register/heartbeat. **No recipient command** — entering AIMING is automatic once location is known.

### 5.2 The location↔aim split (resolves the chicken-and-egg)

The key reframe E missed: **placement has two halves with opposite data-flow directions.**

- **Location (lat/lng): flows DOWN.** Collected by the cloud wizard (phone GPS or zip), sent via `pre-register`, delivered to the device in the `register`/heartbeat response. Needed *before* aiming so the overlay can compute the sun.
- **Aim (azimuth_deg, tilt_deg): flows UP.** Produced on-device by the recipient's sun-tap (azimuth = the anchored heading; tilt from the gyro pitch). Reported to the cloud on confirm.

`placement_status` gains an explicit progression:
`awaiting_location` (no lat/lng) → `awaiting_aim` (lat/lng known, not yet aimed) → `ready` (aimed). The device maps these to IDLE / AIMING / ACTIVE.

### 5.3 Sun-tap result → placement (the one v0.4 addition)

`setup_server.py` currently *shows* the aim but never *commits* it. Add:

- **`POST /setup/confirm`** on the `AimingService`: requires the current state is `tapped` (not uncalibrated/suspect — the confidence gate applies here too). It finalizes `{azimuth_deg: heading_deg, tilt_deg: <from pitch>, roll_deg, confirmed_at}`, writes it to the device config, reports it to the cloud (§6), and signals the supervisor to transition AIMING → ACTIVE. Returns `{status: "confirmed", placement: {...}}` or `409` if not in `tapped` state.
- A **"Confirm aim"** button on the aiming page, enabled only while the heading badge shows `tapped` (hidden in uncalibrated/suspect — same silent-fake-signal guard).

### 5.4 The aiming launcher — config-driven

In deployment, lat/lng comes from the device config (delivered by the cloud), not a CLI flag. So `sunset-cam-aiming.service`'s `ExecStart` runs a config-reading entrypoint (evolve `run-setup-server.py` to read `lat`/`lng`/`phase`/`hfov`/`width` from the device config when flags are absent). The CLI flags remain for bench use (cam1 prototype); config is the default in the field.

### 5.5 Reaching the aiming page

After WiFi join the recipient's phone is back on home WiFi; the cloud wizard must deep-link them to the device's *local* aiming page. The device reports its **local IP** (and relies on the mDNS name `sunset-cam-XXXX.local`) in its heartbeat; the cloud wizard links the phone to `http://<local-ip-or-mdns>:8080/`. (mDNS is the friendlier primary; local-IP is the fallback when mDNS is flaky on the recipient's network.)

### 5.6 Relocation

- **Same WiFi, new spot (in scope):** the cloud sends a `reaim` directive (+ new lat/lng) in a heartbeat response; the supervisor transitions ACTIVE → AIMING with the new location; recipient re-aims and confirms → ACTIVE. It is literally re-entering AIMING — no new machinery beyond the directive.
- **New WiFi (seam, build later):** a `reprovision` directive transitions ACTIVE → SETUP (wipes creds, re-enters the captive portal), then the normal flow resumes through AIMING. Designed here; implementation deferred.

### 5.7 Supersede E §5.5

E §5.5's "must register three routes from `sunset_cam.setup_alignment`" is replaced by: **the setup web app for placement is the v0.4 `setup_server.AimingService`**, mounted by `sunset-cam-aiming.service`, which already serves `/`, `/setup/preview.mjpg`, `/setup/orientation.json`, `/setup/state.json`, `POST /setup/tap`, and (new) `POST /setup/confirm`. E's captive-portal Flask app (the WiFi form) is unaffected — it's a different service in a different state.

## 6. Protocol amendments (extends E §5.4 and `device-protocol.md`)

- **`register`/heartbeat response carries `lat`/`lng`** when known, alongside `placement_status` ∈ {`awaiting_location`, `awaiting_aim`, `ready`}.
- **New device→cloud call: `POST /api/cameras/:id/placement`** — body `{azimuth_deg, tilt_deg, roll_deg, confirmed_at}`. Sets the camera's placement and flips its status to `ready`. (Alternatively fold into heartbeat; a dedicated call is clearer for the confirm moment.)
- **Heartbeat response may carry a directive:** `{reaim: {lat, lng}}` or `{reprovision: true}` for relocation.
- **Heartbeat request carries `local_ip`** so the wizard can deep-link the phone to the aiming page.
- `setup-status/:claim_code` (E's wizard-poll endpoint) gains the `awaiting_aim` state.

## 7. Testing

Device-side, mockable on a laptop (the v0.4 modules already inject fakes):
- Supervisor transitions: feed synthetic statuses (`awaiting_location`→IDLE, `awaiting_aim`→starts aiming service, confirm→stops aiming/starts capture, `reaim`→back to aiming). Assert which service it would start/stop (mock systemctl).
- `POST /setup/confirm`: in `tapped` state → returns confirmed placement with `azimuth_deg == heading_deg`; in uncalibrated/suspect → `409`.
- Config-driven launcher: with lat/lng in config and no flags → builds the AimingService with config values.

Cloud-side:
- `register`/heartbeat returns `lat`/`lng` + correct `placement_status` across the three states.
- `POST /api/cameras/:id/placement` sets placement and flips status to `ready`.
- `setup-status` reports `awaiting_aim` when location is set but aim isn't.

Integration (on cam1 / a bench unit): drive the full IDLE→AIMING→confirm→ACTIVE locally with a mock cloud, then the relocation `reaim` round-trip.

## 8. Risks

- **Recipient closes the wizard mid-aim.** The device sits in AIMING (serving the page) indefinitely; heartbeat keeps reporting `awaiting_aim`. The wizard can be reopened via the sticker QR. No data loss.
- **mDNS unreachable on the recipient's network** (AP isolation, some routers). Mitigation: fall back to the reported local IP; the wizard shows both.
- **Camera contention if the supervisor mis-sequences.** The `Conflicts=` systemd directives are the hard backstop — even a supervisor bug can't double-claim the camera.
- **A bad aim confirmed.** v0.4's drift/suspect handling + the cloud's first-image (sub-project G) catch a wrong aim; and `reaim` makes re-doing it cheap.

## 9. Open questions

1. **Tilt from pitch — sign/convention.** `tilt_deg` from gyro pitch needs the same care as the heading sign; pin with a test during implementation.
2. **Does confirm require level?** Probably yes — only allow confirm when roll/pitch are within the level tolerance (reuse `HeadingState`'s `level_tol`). Decide during impl.
3. **Where the device persists placement** — the existing config.json vs a separate `placement.json`. Lean toward a separate file so capture config and placement evolve independently.
4. Carried from v0.4: lens FOV choice (affects `hfov` in config); clock tolerance for sun-tap.

## 10. Implementation slice order

1. v0.4 firmware: `POST /setup/confirm` + the "Confirm aim" button (TDD). Smallest, unblocks the rest.
2. v0.4 firmware: config-driven launcher (lat/lng from config when flags absent).
3. Cloud: `placement_status` three-state + `lat`/`lng` in register/heartbeat + `POST /api/cameras/:id/placement` + `setup-status` `awaiting_aim` (TDD).
4. Firmware: the supervisor/state-machine AIMING branch (start/stop `sunset-cam-aiming` vs `sunset-cam` by status; mock systemctl in tests). Extends E's slice-4 state machine.
5. Systemd: `sunset-cam-aiming.service` with `Conflicts=sunset-cam.service`, config-driven ExecStart.
6. Heartbeat `local_ip` + the `reaim` directive (same-WiFi relocation).
7. Integration smoke on a bench unit (mock cloud): IDLE→AIMING→confirm→ACTIVE, then `reaim`.
8. Update E §5.3/§5.5 inline and `device-protocol.md` with the amendments. Hand the deep-link + status contract to sub-project F.
