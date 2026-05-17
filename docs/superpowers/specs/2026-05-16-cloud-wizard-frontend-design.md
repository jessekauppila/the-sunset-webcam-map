# Cloud Wizard Frontend — Design Stub

Status: Stub — content carried over from the prior `docs/ar-placement-portal.md` draft (2026-05-03). Full design to be written when sub-project F's turn arrives, on top of sub-project E (`2026-05-15-wifi-onboarding-and-provisioning-design.md`).
Owner: Jesse Kauppila
Sub-project F of the streamlined-deployment umbrella (`2026-05-15-streamlined-deployment-overview.md`).

---

A browser-based wizard that runs on the operator's phone, picked up after the device has joined WiFi via sub-project E's captive-portal handoff. **It is the entire post-WiFi setup flow** — not just the placement decision. The operator opens `sunrisesunset.studio/setup/{claim_code}`, taps through ~6 screens, and the device's full pre-registration record (placement, location, operator preferences) is submitted to the server. The operator never types lat/lng, never measures azimuth, never edits a config file, never SSHs into anything.

## What it does

After granting camera + location + device-orientation permission, the wizard walks through:

1. **Confirm the camera you're setting up.** The claim code is already in the URL; the wizard polls `/api/cameras/setup-status/{claim_code}` (defined in spec E) until the device has reported in, then advances.

2. **Pick what you want to capture.** A `phase_preference` toggle: `sunrise` / `sunset` / `both`. This sets which active windows the device participates in.

3. **Pick where you want your daily photo sent.** Operator enters delivery preferences: email address (default), SMS number, or "personal gallery URL only — don't send anything." Cadence: daily / per-event / quality-gated. This becomes `operator_preferences.delivery`.

4. **AR placement view.** Live camera feed from the phone, overlaid with three arcs:
   - **Northern-solstice arc** — where the sun rises and sets at the most northern point of the year (June 21 in the Northern Hemisphere).
   - **Southern-solstice arc** — most southern point (December 21 in the Northern Hemisphere).
   - **Equinox midpoint arc** — March 21 / September 21, between the two extremes.
   These three arcs together define the **azimuth-altitude envelope** the sun occupies over the year at this location. A fixed crosshair locked to the phone's current bearing + horizon updates in real time as the operator sweeps the phone around. The operator can see at a glance which window/wall captures the most of the sun's annual path.

5. **Horizon sweep.** Prompted gesture: "Slowly turn around in a circle, keeping the phone aimed at the horizon line." As they sweep, the wizard records `{azimuth_deg, altitude_deg}` pairs at the actual visible horizon (where the sky meets buildings, mountains, trees). This becomes `placement.horizon_profile` — the data the server uses to compute when the sun is *actually visible* from this site, not just when it crosses the geometric horizon.

6. **Mount here.** Operator aims the phone at the desired mounting direction and taps "Mount Here." Final `azimuth_deg` + `tilt_deg` snapshot from the DeviceOrientation API at tap time. Sub-project C will add `roll_deg` here plus a "which way is up" overlay on the housing.

**Screen 4 alignment-tool link (sub-project C, v0.2).** Screen 4 renders a single button "Open the alignment tool" that opens `http://<pi-local-ip>:<setup-port>/setup/align` in a new tab. The Pi's local IP + port are surfaced by the same setup-status polling spec E uses for the WiFi-handoff transition. The button is followed by a "Continue" button that advances the wizard with no protocol-payload state from the alignment tool — the alignment step is a one-way side trip.

The wizard then submits the assembled blob to `POST /api/cameras/pre-register` with the claim code. Per spec E's protocol Amendment A, this works whether the device has registered yet or not.

## Field provenance

Every field the protocol expects at registration is captured by the wizard automatically:

| Protocol field | Source in the wizard |
|---|---|
| `lat`, `lng` | Geolocation API |
| `elevation_m` | Geolocation API (`altitude`) |
| `timezone` | `Intl.DateTimeFormat().resolvedOptions().timeZone` |
| `placement.azimuth_deg` | DeviceOrientation API at "Mount Here" tap |
| `placement.tilt_deg` | DeviceOrientation API at "Mount Here" tap |
| `placement.roll_deg` | DeviceOrientation API at "Mount Here" tap (added by sub-project C) |
| `placement.horizon_altitude_deg` | Auto-derived from `horizon_profile` at the camera's azimuth |
| `placement.horizon_profile` | Horizon sweep gesture |
| `operator_preferences.phase_preference` | Toggle, screen 2 |
| `operator_preferences.delivery` | Form, screen 3 |
| `claim_code` | Present in the URL — never typed |
| `capabilities` | Not collected — the device self-reports these on `register` |
| `hardware_id` | Not collected — the device generates this from its serial number |

The wizard never asks for the device's hardware ID — that's the device's problem. The claim code is the binding key.

## Why it matters

- **Best placement is non-obvious.** The sun's path is hard to visualize. People put cameras in spots that capture the sun for one month of the year and miss it for nine. AR makes the year-round trajectory legible at install time.
- **Horizon profile is the only way to get accurate active windows in real terrain.** Manually building one is tedious; using a global terrain DB is heavy. Sweeping a phone across the horizon takes 30 seconds and is exactly what the operator is already doing while finding placement.
- **It's a "give-back" feature.** Hosting a sunset camera doesn't currently feel like the operator is doing anything cool. Walking around with an AR sun-path overlay does.
- **It collapses the entire post-WiFi setup flow into one URL.** Without the wizard, you're either flashing config files yourself for every operator (the v1 manual path in protocol §4.5.1) or asking non-technical operators to edit JSON. With the wizard, the protocol's "operator never touches a config file" promise becomes real.

## Technology sketch

- Browser-only, no native app. WebXR is overkill; **DeviceOrientation API + a Three.js scene + getUserMedia for the camera feed** is enough.
- Sun trajectory math: `astral` ported to JS, or `suncalc` (npm package, well-known).
- Compass calibration is the painful part — Android/iOS magnetometers drift. Add a "calibrate by pointing at sunrise/known landmark" step.
- iOS Safari requires a user-initiated gesture before granting `DeviceOrientationEvent`; design for that.

## Out of scope for this stub

Everything else. This is a placeholder so `device-protocol.md` §4.5.2 and §14's references resolve, and so the carried-over content survives the deletion of `docs/ar-placement-portal.md`. Full design when sub-project F's turn arrives — after E ships and we have real captive-portal handoff behavior to design against.
