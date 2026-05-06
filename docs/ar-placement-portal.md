# AR Placement Portal — Design Stub

Status: Stub — 2026-05-03
Owner: Jesse Kauppila
Companion to: `docs/device-protocol.md` §4.5.2 and §14

A browser-based AR tool that runs on the operator's phone. **It is the entire setup flow** — not just the placement decision. The operator opens a URL, taps through ~6 screens, and the device's full registration record (placement, location, operator preferences) is submitted to the server before the device even boots. The operator never types lat/lng, never measures azimuth, never edits a config file, never SSHs into anything.

## What it does

The operator opens a URL on their phone (no app install). After granting camera + location + device-orientation permission, the portal walks through:

1. **Pick the camera you're setting up.** Operator enters or scans the claim code from the camera's sticker.

2. **Pick what you want to capture.** A `phase_preference` toggle: `sunrise` / `sunset` / `both`. This sets which active windows the device participates in.

3. **Pick where you want your daily photo sent.** Operator enters delivery preferences: email address (default), SMS number, or "personal gallery URL only — don't send anything." Cadence: daily / per-event / quality-gated. This becomes `operator_preferences.delivery`.

4. **AR placement view.** Live camera feed from the phone, overlaid with three arcs:
   - **Northern-solstice arc** — where the sun rises and sets at the most northern point of the year (June 21 in the Northern Hemisphere).
   - **Southern-solstice arc** — most southern point (December 21 in the Northern Hemisphere).
   - **Equinox midpoint arc** — March 21 / September 21, between the two extremes.
   These three arcs together define the **azimuth-altitude envelope** the sun occupies over the year at this location. A fixed crosshair locked to the phone's current bearing + horizon updates in real time as the operator sweeps the phone around. The operator can see at a glance which window/wall captures the most of the sun's annual path.

5. **Horizon sweep.** Prompted gesture: "Slowly turn around in a circle, keeping the phone aimed at the horizon line." As they sweep, the portal records `{azimuth_deg, altitude_deg}` pairs at the actual visible horizon (where the sky meets buildings, mountains, trees). This becomes `placement.horizon_profile` — the data the server uses to compute when the sun is *actually visible* from this site, not just when it crosses the geometric horizon.

6. **Mount here.** Operator aims the phone at the desired mounting direction and taps "Mount Here." Final `azimuth_deg` + `tilt_deg` snapshot from the DeviceOrientation API at tap time.

The portal then submits the assembled blob to `POST /api/cameras/pre-register` with the claim code. Operator plugs in the device, which on first boot POSTs `register` with the same claim code, gets a `device_token`, and inherits all the pre-registered placement + preferences automatically.

## Field provenance

Every field the protocol expects at registration is captured by the portal automatically:

| Protocol field | Source in the portal |
|---|---|
| `lat`, `lng` | Geolocation API |
| `elevation_m` | Geolocation API (`altitude`) |
| `timezone` | `Intl.DateTimeFormat().resolvedOptions().timeZone` |
| `placement.azimuth_deg` | DeviceOrientation API at "Mount Here" tap |
| `placement.tilt_deg` | DeviceOrientation API at "Mount Here" tap |
| `placement.horizon_altitude_deg` | Auto-derived from `horizon_profile` at the camera's azimuth |
| `placement.horizon_profile` | Horizon sweep gesture |
| `operator_preferences.phase_preference` | Toggle, screen 2 |
| `operator_preferences.delivery` | Form, screen 3 |
| `claim_code` | Entered or scanned, screen 1 |
| `capabilities` | Not collected — the device self-reports these on `register` |
| `hardware_id` | Not collected — the device generates this from its serial number |

The portal never asks for the device's hardware ID — that's the device's problem. The claim code is the binding key.

## Why it matters

- **Best placement is non-obvious.** The sun's path is hard to visualize. People put cameras in spots that capture the sun for one month of the year and miss it for nine. AR makes the year-round trajectory legible at install time.
- **Horizon profile is the only way to get accurate active windows in real terrain.** Manually building one is tedious; using a global terrain DB is heavy. Sweeping a phone across the horizon takes 30 seconds and is exactly what the operator is already doing while finding placement.
- **It's a "give-back" feature.** Hosting a sunset camera doesn't currently feel like the operator is doing anything cool. Walking around with an AR sun-path overlay does.
- **It collapses the entire setup flow into one URL.** Without the portal, you're either flashing config files yourself for every operator (the v1 plan) or asking non-technical operators to edit JSON. With the portal, the protocol's "operator never touches a config file" promise becomes real.

## Technology sketch

- Browser-only, no native app. WebXR is overkill; **DeviceOrientation API + a Three.js scene + getUserMedia for the camera feed** is enough.
- Sun trajectory math: `astral` ported to JS, or `suncalc` (npm package, well-known).
- Compass calibration is the painful part — Android/iOS magnetometers drift. Add a "calibrate by pointing at sunrise/known landmark" step.
- iOS Safari requires a user-initiated gesture before granting `DeviceOrientationEvent`; design for that.

## Out of scope for this stub

Everything else. This is a placeholder so `device-protocol.md` §14's reference resolves. Full design when this work starts.
