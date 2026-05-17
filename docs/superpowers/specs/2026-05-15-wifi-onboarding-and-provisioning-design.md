# WiFi Onboarding and SD-Card Provisioning

Status: Draft v0.1 — 2026-05-15
Owner: Jesse Kauppila
Sub-project E of the streamlined-deployment umbrella (`2026-05-15-streamlined-deployment-overview.md`).
Companion: `docs/device-protocol.md`, `docs/ar-placement-portal.md`, `pi-webcam-mvp.md`.

---

## 1. Problem

A pre-built Pi Zero 2 W webcam can be physically shipped to a non-technical recipient, but today there is no way for that recipient to put it online. The Pi has no WiFi credentials baked in, the operator hasn't entered any location data, and the only ways to do either — editing `wpa_supplicant.conf` on the SD card, SSHing in, or hand-flashing per-recipient configs — require a technical operator. `pi-webcam-mvp.md` explicitly punted "captive-portal WiFi setup on first boot" to Phase 2; this spec is that phase.

The cost of leaving this unsolved: the network can never have more cameras than the operator can personally install.

## 2. Goals

1. A non-technical recipient can take a sealed unit from "in the box" to "joined to their home WiFi and registered" using only their phone, in under 5 minutes.
2. The operator's per-unit shipping prep is bounded and reproducible: one SD-card image template + one per-unit claim-code injection step. No per-unit lat/lng, no per-unit network config.
3. The cloud wizard at `sunrisesunset.studio/setup/{claim_code}` is the master UX. The device-local captive-portal page is brief and minimal — WiFi credentials only.
4. The protocol still works for the operator's existing manual-config path (§4.5.1 in `device-protocol.md`). This adds a path; it does not replace one.

## 3. Non-goals

- AR placement view, sun-arc overlay, `placement.azimuth/tilt/horizon_profile` capture — those live in sub-project F.
- Install-time orientation / roll capture — sub-project C.
- Placement-quality AI checks — sub-project D.
- First-image verification UX — sub-project G.
- Bluetooth onboarding. iOS Safari has no Web Bluetooth support; captive portal is the only choice if we want no-app-install on both platforms.
- ESP32 onboarding. ESP32-S3 has its own well-trodden SoftAP+provisioning patterns; this spec is Pi-only and the ESP32 port re-derives equivalents.
- Mesh / multi-hop WiFi, enterprise WPA-Enterprise, captive-portal-behind-captive-portal (hotel WiFi). Recipients on those networks fall back to the operator's manual path.

## 4. Current state

Verified from the repo as of commit `2fb861537`:

- `pi-webcam-mvp.md`: lists captive-portal WiFi setup as out-of-scope for MVP. The Pi firmware repo (`~/GitHub/sunset-cam-firmware`) currently expects `wpa_supplicant.conf` to be pre-configured on the SD card.
- `device-protocol.md` §4.5.1 (manual config): operator hand-fills `config.json` with claim_code + lat/lng + placement. §4.5.2 (AR portal): assumed device is already online when the portal runs — i.e., it assumes someone else solved the WiFi problem.
- `device-protocol.md` §6.2a `pre-register`: designed to be called *before* the device boots. This spec amends that ordering (see §5.4).
- No code exists for AP-mode hosting, captive-portal HTTP, or first-boot WiFi-credential intake.

## 5. Design

### 5.1 The recipient's flow (end-to-end)

1. Recipient unboxes the unit. Sticker on the case shows: claim code (`SUNSET-7K3M-9XQ2`), a URL, and a QR code that encodes the URL `https://sunrisesunset.studio/setup/SUNSET-7K3M-9XQ2`.
2. Recipient plugs in power. The Pi boots; firmware sees there is no usable WiFi configured and enters **setup mode**: it brings up an open WiFi access point named `Sunset-Cam-XXXX` (where `XXXX` is the last 4 hex of its MAC) and starts a local HTTP server.
3. Recipient scans the QR code with their phone camera. The phone's browser opens the cloud wizard at the setup URL (over cellular or whatever home WiFi the phone was on).
4. Cloud wizard page 1 instructs: "Open your phone's WiFi settings. Connect to `Sunset-Cam-XXXX`. Then tap Continue."
5. Recipient connects phone to `Sunset-Cam-XXXX`. The OS detects a captive portal (because the AP's DNS resolves everything to the device's local IP and `/generate_204` etc. return a redirect) and pops a system-level browser sheet for the device-local page.
6. The device-local page is a single form: SSID dropdown (populated by `iwlist` scan) + password field + Submit. Recipient fills it in and submits.
7. Device writes credentials, tears down AP mode, brings up `wpa_supplicant` against the chosen SSID. Local page shows: "Connecting… ✓ joined. Now reconnect your phone to your home WiFi and return to the setup tab in your browser."
8. Recipient reopens the cloud wizard tab (still open on their phone). Wizard polls `/api/cameras/setup-status/{claim_code}` and sees the device has just called `/register` from its new WiFi network.
9. Cloud wizard continues to its next screen (sub-project F: lat/lng, placement, etc.). Out of scope for this spec.

The handoff promise: the recipient touches two WiFi networks (device AP, then home WiFi back) and one URL. They never see a config file, an SSH terminal, or a claim-code field that they have to retype — the QR carries it.

### 5.2 SD-card provisioning (operator-side, per unit)

The operator runs one command per unit before shipping:

```
./scripts/provision-unit.sh <serial-or-label>
```

This script:
1. Calls `POST /api/admin/claim-codes` to mint a new claim code.
2. Copies the canonical SD-image template to a working copy.
3. Mounts the working copy's `/boot` partition and writes `config.json` containing **only** `{ "claim_code": "<minted>" }`. No lat/lng, no WiFi, no placement.
4. Generates a sticker PDF with the claim code, the setup URL, and a QR encoding the URL. (Sticker generation is a separate script invocation; mentioned here for completeness.)
5. Flashes the working copy to a freshly inserted SD card via `dd` / `pi-imager` CLI.
6. Logs `{claim_code, sd_serial, sticker_path, provisioned_at}` to a local CSV for the operator's records.

The SD-image template itself is built once (and rebuilt when firmware changes), not per unit. Build process:

1. Start from Raspberry Pi OS Lite 64-bit.
2. Install firmware repo at `/opt/sunset-cam` (`pip install -e .`).
3. Install systemd units: `sunset-cam.service` (the existing capture loop) and `sunset-cam-setup.service` (new — runs the setup-mode AP + web app when needed).
4. Install `hostapd`, `dnsmasq`, `wpa_supplicant`, and a small Python web app (`flask` or `aiohttp`).
5. Configure first-boot: a oneshot service that, on first boot, generates `device_token` storage paths and ensures permissions, then deletes itself.
6. Snapshot the image with `pi-clone` or `dd`.

The image template lives in version control as a script that *builds* the image, not the raw image (which is 4–8 GB and binary).

### 5.3 Device-side state machine

```
            ┌──────────┐
   power on │  BOOT    │
            └────┬─────┘
                 │
                 ▼
     ┌────────────────────────┐
     │ Has wpa_supplicant.conf │
     │ with at least one SSID? │
     └─────┬───────────┬──────┘
        no │           │ yes
           ▼           ▼
     ┌──────────┐  ┌──────────────────┐
     │ SETUP    │  │ Try to associate │
     │ MODE     │  └────┬──────┬──────┘
     │ (AP on)  │       │      │
     └────┬─────┘       │      │
          │       success      fail (15s)
          │             │      │
          │             ▼      ▼
          │       ┌─────────┐ ┌────────────┐
          │       │ ONLINE  │ │ Mark creds │
          │       └────┬────┘ │ bad → re-  │
          │            │      │ enter SETUP│
          │            │      └────┬───────┘
          │            ▼           │
          │     ┌────────────┐     │
          │     │ /register  │     │
          │     └────┬───────┘     │
          │          │             │
          │          ▼             │
          │   ┌────────────┐       │
          │   │ Placement? │       │
          │   └─┬────────┬─┘       │
          │ yes │        │ no      │
          │     ▼        ▼         │
          │ ┌──────┐  ┌───────────┐│
          │ │ACTIVE│  │IDLE: hb +  │
          │ │ loop │  │poll cfg    ││
          │ └──────┘  └───┬───────┘│
          │               │        │
          │     placement arrives  │
          │       (heartbeat)      │
          │               │        │
          │               ▼        │
          │           [ACTIVE]     │
          └───────────────────────►(SETUP if creds wiped via heartbeat command)
```

State definitions:

- **SETUP**: `hostapd` + `dnsmasq` running, AP `Sunset-Cam-XXXX` visible, Flask app serving the WiFi credential form on `10.42.0.1:80`. The capture loop is paused.
- **ONLINE**: Joined a WiFi network. The capture loop is paused but the device is reachable to the cloud.
- **IDLE**: Registered, no placement yet. Heartbeats every 30 seconds; expects placement to arrive in a heartbeat response.
- **ACTIVE**: Placement received, running the normal capture loop per `device-protocol.md` §9.

Transitions:

- BOOT → SETUP: no usable WiFi credentials at boot.
- BOOT → ONLINE: WiFi credentials exist and association succeeds within 15s.
- SETUP → ONLINE: recipient submitted creds via local web app, association succeeded.
- ONLINE → IDLE: `/register` returned 200 with `placement_status: "pending"`.
- ONLINE → ACTIVE: `/register` returned 200 with `placement_status: "ready"` (the operator pre-registered before the device came online — the legacy ordering still works).
- IDLE → ACTIVE: a heartbeat response delivered placement data.
- Any → SETUP: deferred to a future version. Listed here only to mark the seam — a heartbeat-driven `reprovision: true` flag would let an operator move a camera to a new home WiFi without re-flashing the SD card. Not implemented in v1; see §9.

Halt conditions worth naming:

- WiFi credentials submitted but association fails: device returns to SETUP, the next-attempt local page shows "Couldn't connect to `<SSID>`. Wrong password?" — credentials are not persisted until association succeeds.
- WiFi up but `/register` returns 401/403: device retries with exponential backoff for 1 hour, then sets an LED pattern (TBD) and waits for power cycle. (The protocol already covers this; mentioning it here only to confirm the captive-portal path doesn't open a new failure mode.)

### 5.4 Protocol amendments

Three small changes to `docs/device-protocol.md`.

**Amendment A: `pre-register` works in either order.**

§6.2a currently assumes the operator calls `pre-register` before the device exists. With captive-portal onboarding, the device exists (and may register) first. Behavior:

- If `pre-register` arrives first: server stores the data keyed by `claim_code`. The subsequent `register` call merges and the device receives placement in the register response.
- If `register` arrives first: server creates the camera row with `placement_status='pending'`. A subsequent `pre-register` call with the same `claim_code` matches the existing camera and fills in placement. The device's next heartbeat returns the new placement.

No new endpoints. Just clarification of either-order semantics in §6.2a's body text.

**Amendment B: `register` response includes `placement_status`.**

```
{
  "camera_id": "...",
  "device_token": "...",
  "placement_status": "pending" | "ready",
  "placement": { ... }  // present iff status === "ready"
}
```

Device branches on `placement_status` per §5.3 of this spec.

**Amendment C: heartbeat response can deliver placement.**

The existing heartbeat response (`device-protocol.md` §6.4) already returns a `config` block for overriding capture settings. Add an optional `placement` field with the same shape as `register`'s placement. If present, the device transitions IDLE → ACTIVE.

### 5.5 Captive-portal mechanism (technology)

- **AP host**: `hostapd` configured for an open network (no WPA on the device AP; the credentials it accepts are for the *recipient's* home network, not for itself). SSID format `Sunset-Cam-XXXX` where XXXX is the device's MAC suffix in hex. Channel auto-selected (default 6).
- **DHCP + DNS hijack**: `dnsmasq` in DHCP-server mode on the AP subnet (`10.42.0.0/24`, device at `10.42.0.1`). DNS configured to return `10.42.0.1` for every query — the captive-portal trick. iOS and Android both probe well-known URLs (`captive.apple.com/hotspot-detect.html`, `connectivitycheck.gstatic.com/generate_204`); responding with a 302 to `http://10.42.0.1/` makes them auto-pop the system browser sheet.
- **Local HTTP server**: a small Flask app on port 80, serving:
  - `GET /` — the WiFi credential form (HTML, no JS framework). Populates SSID dropdown via a server-side `iwlist scan` call (cached for 10s).
  - `POST /wifi` — body `{ssid, password}`. Server writes `/etc/wpa_supplicant/wpa_supplicant.conf` (chmod 600), brings down `hostapd`, brings up `wpa_supplicant`, waits up to 15s for association, returns either `{status: "joined", ip}` or `{status: "failed", reason}`. Doesn't persist the new conf if association fails.
  - `GET /status` — polled by the form's JS while waiting for the join attempt.
  - Catch-all 302 to `/` to satisfy the captive-portal probes from iOS/Android.
- **Coordination**: a single systemd unit (`sunset-cam-setup.service`) controls the AP+Flask process. It conflicts with `sunset-cam.service` (the capture loop) so the two can never run together. On successful join, the setup service exits and the capture service starts.

The setup service's footprint should be small enough that it can ship in the same image as the capture firmware and add no boot-time cost on already-provisioned units (it doesn't start unless the boot check finds no WiFi creds).

**Alignment-tool integration (sub-project C, v0.2).** The setup web app must register three routes from `sunset_cam.setup_alignment`:

- `GET /setup/align` → response body = `render_align_page(lat, lng)` with the camera's stored coordinates; `Content-Type: text/html; charset=utf-8`.
- `GET /setup/preview.mjpg` → response body streams from `stream_mjpeg(frame_source=capture.capture_jpeg)`; `Content-Type: multipart/x-mixed-replace; boundary=sunsetcamframe`.
- `GET /setup/orientation.json` → response body = `render_orientation_json(orientation_sampler)` where `orientation_sampler` is a singleton `OrientationSampler(reader=lambda: read_orientation(smbus2.SMBus(1)))` started at service boot. `Content-Type: application/json`.

The MPU6050 / GY-521 IMU is required hardware for v0.2 (BOM addition). Wired via I2C on the Pi (SDA→GPIO 2, SCL→GPIO 3, VCC→3.3V, GND→GND).

### 5.6 Cloud-side endpoints touched

Existing endpoints, used as-is:
- `POST /api/admin/claim-codes` — operator-side, called by `provision-unit.sh`.
- `POST /api/cameras/register` — called by the device after WiFi up.
- `POST /api/cameras/pre-register` — called by the cloud wizard (sub-project F), see Amendment A.
- `POST /api/cameras/:id/heartbeat` — extended per Amendment C.

New endpoint:
- `GET /api/cameras/setup-status/:claim_code` — used by the cloud wizard to poll for device-online status during the WiFi handoff. Returns `{status: "awaiting_wifi" | "registered" | "ready"}`. No auth (the claim_code is the bearer; rate-limit to mitigate enumeration).

That's the entirety of the cloud-side surface for E.

## 6. Testing

### 6.1 Unit (device-side, mockable on a laptop)

- WiFi credential form handler: post valid creds → assert `wpa_supplicant.conf` written with correct shape (mock the actual `wpa_supplicant` binary). Post invalid creds → assert no write.
- State machine transitions: feed synthetic inputs (no-WiFi, WiFi-up, register-200-pending, heartbeat-with-placement) and assert state transitions match §5.3.
- iwlist parse: feed canned `iwlist scan` output, assert SSID list extraction is correct (and dedups duplicate BSSIDs).

### 6.2 Unit (cloud-side)

- `GET /api/cameras/setup-status/:claim_code` returns the correct status across all four lifecycle states.
- `register` handler returns `placement_status: "ready"` iff pre-registration happened for this claim code; otherwise `"pending"`.
- `pre-register` handler, called after `register`, correctly fills placement on the existing camera row and the device's next heartbeat would include it.

### 6.3 Integration

A scripted end-to-end on real hardware:

1. Provision a fresh SD card via `provision-unit.sh`. Flash it. Boot the Pi.
2. From a phone or laptop: scan for `Sunset-Cam-XXXX`, join it, hit `http://10.42.0.1/`. Verify the form loads and lists SSIDs.
3. Submit a known-good SSID + password. Verify the device joins, the page shows success.
4. From a second device on the cloud: hit `/api/cameras/setup-status/{claim_code}` and verify status flips from `awaiting_wifi` to `registered` within 30s.
5. POST `pre-register` with mock placement data. Verify the device's next heartbeat receives the placement and the device transitions IDLE → ACTIVE.

### 6.4 Manual smoke

- Run the above against one Pi in the operator's home WiFi environment before any unit ships.

## 7. Risks and rollback

- **Risk: captive-portal auto-pop is unreliable.** iOS sometimes shows the system sheet, sometimes not; the recipient may have to manually open Safari and type any URL to trigger the redirect. Mitigation: the cloud wizard's step 1 explicitly says "if the page doesn't appear automatically, open your browser and visit any website."
- **Risk: dual-band WiFi names with the same SSID at 2.4GHz and 5GHz.** Pi Zero 2 W is 2.4GHz only. If the recipient's home WiFi advertises both, our `iwlist` scan will show one entry per BSSID; dedup by SSID and accept that we'll join the 2.4GHz band. UI shows only the SSID, not the band.
- **Risk: recipient's network has a captive portal of its own (hotel, café).** Out of scope. Document it; do not attempt to defeat it.
- **Risk: operator forgets which sticker goes on which SD card.** Mitigation: the provisioning script's CSV log is the single source of truth; sticker PDF includes the SD serial as a small footer.
- **Rollback**: `sunset-cam-setup.service` is the only new long-running unit. Disabling it and re-flashing the SD card with a hand-built `wpa_supplicant.conf` is exactly the existing manual path. No DB migration to undo.

## 8. Implementation slice order

1. Cloud-side: implement `placement_status` in `register` response and the `setup-status` endpoint, plus unit tests. The device firmware can branch on this once it exists, and tests for the new cron states from Subproject A still pass.
2. Cloud-side: amend `pre-register` to handle either order. Unit tests for both orderings.
3. Cloud-side: amend `heartbeat` response to optionally carry placement. Unit tests.
4. Firmware-side: state machine refactor — extract the existing capture loop into the ACTIVE branch, add the IDLE/SETUP/ONLINE branches as stubs. Tests via mocked transitions.
5. Firmware-side: the setup web app (Flask + iwlist + wpa_supplicant write). Tests via mocked subprocess calls.
6. Firmware-side: hostapd + dnsmasq config files + the `sunset-cam-setup.service` systemd unit. No real test here besides §6.3 integration.
7. SD-image build: bake hostapd, dnsmasq, the new systemd units, and the firmware repo into the image template. Document the build steps in the firmware repo's README.
8. `provision-unit.sh` and the sticker PDF generator.
9. Update `device-protocol.md` with Amendments A/B/C inline.
10. End-to-end smoke on one Pi at the operator's house. Then write spec F (the cloud wizard) building on this contract.

## 9. Open questions deferred

- LED feedback during SETUP / IDLE / ACTIVE — `pi-webcam-mvp.md` lists a status LED as TBD. Useful for "is my new camera in setup mode?" diagnostics but not blocking. Defer to a follow-up.
- Image-template build automation (Packer? `pi-gen`? hand-rolled `dd`?) — depends on operator tolerance for build-script maintenance. Resolve when slice 7 starts.
- A "reprovision" capability via heartbeat (transition ACTIVE → SETUP on a server command). Useful if a recipient moves the camera to a new WiFi; not in v1.
- Whether to support WPA-Enterprise networks (`eduroam`, corporate). v1: no. Recipients on such networks use the manual path.
- Whether the cloud wizard's "switch your phone back to home WiFi" step can be smoothed by Web App Manifest / Service Worker tricks. Worth experimenting in sub-project F; out of scope here.
