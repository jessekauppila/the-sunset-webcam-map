# Device Protocol — Custom Camera Edge Devices

Status: Draft v0.1 — 2026-05-03
Owner: Jesse Kauppila
Scope: Wire protocol between custom edge cameras (Pi Zero 2 W, ESP32-S3) and the parent app at `sunrisesunset.studio`. Covers registration, authentication, snapshot upload, heartbeat, capability negotiation, and a reserved streaming-upgrade path. Implementation of either side is out of scope; this doc defines the contract.

---

## 1. Goals

1. Let custom field cameras feed into the existing snapshot/AI/mosaic pipeline alongside Windy webcams, with no frontend rewrite required.
2. Be portable across hardware classes — Pi Zero 2 W as the reference target, ESP32-S3 as the cheap-deployment target. Same wire protocol for both.
3. Push intelligence to the edge where it saves bandwidth (a small on-device quality scorer drops obvious garbage), but keep the authoritative scoring server-side so models can improve over time without losing data.
4. Default to autonomy: devices compute their own active windows, sleep aggressively, and operate offline-tolerant. Server is a passive receiver with a slow-loop control plane on heartbeat responses.
5. Reserve a path for live MJPEG streaming during peak windows without forcing every device or this v1 to support it.

## 2. Non-Goals

- Live video streaming for v1. Reserved as Phase 2; protocol declares the capability + override fields, implementation is a separate doc.
- Real-time control plane (MQTT, WebSocket-for-control). Heartbeat is the only feedback channel; up to 30 min override latency is acceptable.
- Captive-portal Wi-Fi onboarding. Out of scope for the protocol; the protocol just consumes a claim code, regardless of how that code arrived on the device.
- OTA firmware updates. Mechanism reserved (`edge_model_update` field on heartbeat response) but not specified here.
- Direct-to-storage uploads (signed URLs to Firebase/S3). All image bytes go through the parent app's API in v1.
- Per-device exposure tuning UI, fleet management, manual remote-trigger.

## 3. Architecture Summary

```
┌─────────────┐     HTTPS / JSON      ┌──────────────────┐
│   Camera    │ ────────────────────▶ │  Parent App API  │
│ (Pi Zero 2W │                       │ (Next.js / Neon) │
│  or ESP32)  │  ◀── heartbeat resp ──│                  │
└──────┬──────┘                       └────────┬─────────┘
       │                                       │
       │                                       ├── Firebase Storage (image bytes)
       │                                       ├── Postgres: cameras, webcams, webcam_snapshots
       │                                       └── Existing AI scoring pipeline
       │
       └── Edge ML scorer (quantized ONNX / TFLite-Micro)
           drops obvious garbage before upload
```

Devices are autonomous. They authenticate with a per-device token obtained at registration via a one-time claim code, compute their own sunrise/sunset windows from their lat/lng, score every captured frame on-device with a small quality model, and upload only frames that clear an `edge_score_threshold`. The server runs the production-grade AI scorer over uploaded frames, picks a per-window winner, and surfaces winners to the existing kiosk/mosaic frontend through the existing `webcam_snapshots` query path.

## 4. Hardware Targets

| Target | Role | Notes |
|---|---|---|
| Raspberry Pi Zero 2 W + Camera Module 3 Wide | Reference implementation | Better sensor, easier dev loop, supports MJPEG capability |
| ESP32-S3 (8MB PSRAM) + OV5640 | Cheap deployment target | Stills-only, deep-sleep optimized, TFLite-Micro for edge scoring |
| ESP32 (no PSRAM) | Out of scope | Insufficient RAM for image scoring |

The protocol is designed so the Pi reference and ESP32 port speak the same wire format. All hardware-specific concerns (camera drivers, OS, update mechanism) live in firmware repos, not in this protocol.

## 4.5 Setup Flows

The protocol supports two operator-facing setup flows, both producing the same end state.

### 4.5.1 Manual config (the simplest path)

The operator (you) flashes the SD card / firmware with `config.json` containing claim_code + lat/lng + a typed `placement` block. Plugs in the device. Device POSTs `register`, gets `device_token`, starts working. Used for v1 self-deployment.

### 4.5.2 AR portal setup (the operator-facing path)

The operator opens the AR placement portal URL on their phone (no app install). The portal:

1. Reads `lat/lng/elevation_m` from Geolocation API.
2. Reads `azimuth_deg/tilt_deg` from DeviceOrientation API in real time.
3. Overlays the sun's annual trajectory on the live phone camera view (solstice arcs + equinox).
4. Asks the operator to sweep the phone across the horizon, recording `horizon_profile` along the way.
5. Asks the operator to aim at the desired mounting position and tap "Mount Here," capturing final azimuth + tilt.
6. Asks the operator to choose `phase_preference` (sunrise/sunset/both) and enter delivery preferences (email/phone/none).
7. Submits everything to `/api/cameras/pre-register` with the claim code.

The operator then plugs in the device (which has only the claim code on its config), the device claims itself with `register`, and inherits all the portal-supplied placement and preferences. The operator never types coordinates, never edits a config file, never measures an angle.

See `docs/ar-placement-portal.md` for the portal design.

## 5. Authentication Model

### 5.1 Two-secret design

| Secret | Lifetime | Visibility | Purpose |
|---|---|---|---|
| **Claim code** | Single use | Human-readable, sticker-friendly (`SUNSET-7K3M-9XQ2`) | Bootstrap a device into the system |
| **Device token** | Long-lived (revocable) | Machine-only, never displayed | Authenticate every API call after registration |

The claim code is the only thing a human ever needs to handle. The device token is generated server-side, transmitted once over TLS at registration, and stored on the device thereafter.

### 5.2 Generating a claim code

Admin endpoint (gated by the existing `CRON_SECRET` mechanism):

```
POST /api/admin/claim-codes
Authorization: Bearer <CRON_SECRET>
{ "label": "rooftop-test-1" }     // optional, for human reference

→ 200 OK
{ "code": "SUNSET-7K3M-9XQ2", "expires_at": "2026-06-03T00:00:00Z" }
```

Codes default to a 30-day expiration. Once consumed, the row is retained for audit but cannot be reused.

### 5.3 Token storage

- The device stores the token in plaintext on its filesystem (`/etc/sunset-cam/config.json` on Pi, NVS on ESP32). Theft of the device implies theft of the token; revocation is the mitigation.
- The server stores `device_token_hash` (SHA-256), never the plaintext. Tokens are returned exactly once, at registration.

### 5.4 Revocation

Setting `cameras.status = 'revoked'` invalidates the token immediately. Subsequent requests get `401`. A new claim code must be issued to re-provision.

## 6. Endpoints

### 6.1 Summary

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/api/admin/claim-codes` | `CRON_SECRET` | Generate a new claim code |
| `POST` | `/api/cameras/pre-register` | Claim code (in body) | Operator-side setup from the AR portal — submits placement + operator preferences before the device exists |
| `POST` | `/api/cameras/register` | Claim code (in body) | First-boot device registration; merges with pre-registration if present |
| `POST` | `/api/cameras/:id/heartbeat` | `device_token` | Liveness + capability + receive overrides |
| `POST` | `/api/cameras/:id/snapshot` | `device_token` | Upload one captured frame (multipart) |
| `POST` | `/api/cameras/:id/snapshot-url` | `device_token` | Request a signed direct-upload URL — Phase 2, reserved |
| `POST` | `/api/cameras/:id/snapshot-finalize` | `device_token` | Confirm a direct upload completed — Phase 2, reserved |
| `POST` | `/api/cameras/:id/stream` | `device_token` | MJPEG ingest — Phase 2, reserved |
| `POST` | `/api/cameras/:id/update-ack` | `device_token` | Acknowledge install of a firmware/model update |
| `GET`  | `/api/cameras/:id/config` | `device_token` | Pull current config (optional, redundant with heartbeat) |

All non-registration calls send `Authorization: Bearer <device_token>`. All endpoints are HTTPS-only; HTTP is rejected.

### 6.2a `POST /api/cameras/pre-register`

Called by the AR placement portal (running on the operator's phone) to submit placement + operator preferences before the device has booted. The phone has access to sensors and UI the device does not — Geolocation API for `lat/lng/elevation_m`, DeviceOrientation API for `azimuth_deg/tilt_deg`, the AR sweep for `horizon_profile`, simple form inputs for `phase_preference` and `delivery`. Pre-registration unlocks the "operator never types lat/lng or edits a config file" setup flow.

**Request:**
```json
{
  "claim_code": "SUNSET-7K3M-9XQ2",
  "lat": 47.6062,
  "lng": -122.3321,
  "elevation_m": 30,
  "timezone": "America/Los_Angeles",
  "placement": {
    "azimuth_deg": 270,
    "tilt_deg": 5,
    "horizon_altitude_deg": 2.5,
    "horizon_profile": [
      { "azimuth_deg": 0,   "altitude_deg": 1.2 },
      { "azimuth_deg": 10,  "altitude_deg": 1.5 },
      { "azimuth_deg": 20,  "altitude_deg": 8.4 },
      ...
    ]
  },
  "operator_preferences": {
    "phase_preference": "sunset",
    "delivery": {
      "type": "email",
      "target": "operator@example.com",
      "cadence": "daily",
      "image_choice": "window_winner"
    }
  }
}
```

**Response (200):**
```json
{
  "ok": true,
  "claim_code": "SUNSET-7K3M-9XQ2",
  "ready_for_device_registration": true
}
```

The server stores the placement + preferences against the claim code. No `device_token` is issued — that comes when the device itself registers.

**Errors:**
- `400` — invalid payload, malformed coordinates
- `401` — claim code unknown or expired
- `409` — claim code already consumed by a device. Recovery: the operator should request a new claim code or use the camera's existing record.

Pre-registration is **idempotent for the same claim code**. Calling it twice with different data overwrites — useful if the operator wants to walk back to the portal and update the placement.

### 6.2 `POST /api/cameras/register`

First-boot only. Consumes a claim code, returns a device token. If a pre-registration exists for the claim code, the device's `placement` and `operator_preferences` fields are optional — the pre-registration values are authoritative. If no pre-registration exists, the device's values are used as-is (and may be empty).

**Request:**
```json
{
  "claim_code": "SUNSET-7K3M-9XQ2",
  "hardware_id": "pi-zero-2w-1000000abc123",
  "lat": 47.6062,
  "lng": -122.3321,
  "timezone": "America/Los_Angeles",
  "elevation_m": 30,
  "placement": {
    "azimuth_deg": 270,
    "tilt_deg": 5,
    "horizon_altitude_deg": 2.5,
    "horizon_profile": null
  },
  "operator_preferences": {
    "phase_preference": "sunset",
    "delivery": {
      "type": "email",
      "target": "operator@example.com",
      "cadence": "daily",
      "image_choice": "window_winner"
    }
  },
  "capabilities": {
    "device_class": "rpi-zero-2w",
    "firmware_version": "0.1.0",
    "streaming_modes": ["stills", "mjpeg"],
    "max_fps_active": 5,
    "max_resolution": "1920x1080",
    "has_edge_ml": true,
    "edge_ml_model_version": "sunset-quality-v3-int8",
    "battery_powered": false
  }
}
```

Field notes (every one of these is collected by the AR placement portal automatically when that flow is used; see `docs/ar-placement-portal.md`):

- `elevation_m`: meters above sea level. Used for atmospheric refraction correction in sunrise/sunset calculation. Browser Geolocation API returns this; optional; defaults to 0 if absent.
- `placement.azimuth_deg`: compass bearing the camera is pointed at, 0=N, 90=E, 180=S, 270=W. Captured by DeviceOrientation API in the portal at "Mount Here" tap. Required for `phase_preference="sunset"` (camera should face roughly west) or `"sunrise"` (roughly east).
- `placement.tilt_deg`: degrees above horizontal the camera is angled (0 = level, positive = pointed up). Captured by DeviceOrientation API at "Mount Here" tap.
- `placement.horizon_altitude_deg`: the apparent altitude of the visible horizon in the camera's direction. Mountains/buildings raise this above 0. Used to delay/advance the active window so it matches when the sun is actually visible from this site (see §9.5). When the portal captures a `horizon_profile`, this is auto-derived as the value at the camera's azimuth.
- `placement.horizon_profile`: optional array of `{azimuth_deg, altitude_deg}` points describing the visible horizon as a function of compass direction. Captured by the AR placement portal during the horizon sweep gesture. When present, supersedes `horizon_altitude_deg`.
- `operator_preferences.phase_preference`: which terminator phase(s) the device participates in. `"sunrise"` or `"sunset"` saves ~50% device power vs. `"both"`. UI toggle in the portal.
- `operator_preferences.delivery`: optional. Server-side delivery of a daily image to the human who hosts the camera (their "thank you" for plugging it in). UI form in the portal. Implementation is a separate sub-project (see `docs/operator-delivery.md`); the protocol just stores the preference.

When the operator uses the AR portal, all of these fields arrive at the server via `pre-register` (§6.2a) before the device ever boots. The device's own `register` call can omit them; the pre-registration is authoritative.

**Response (201):**
```json
{
  "camera_id": 42,
  "device_token": "7f3a9b8c4e5d6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a",
  "webcam_id": 10042,
  "server_config": {
    "active_window_offset_min_before_sunrise": 45,
    "active_window_offset_min_after_sunrise": 30,
    "active_window_offset_min_before_sunset": 30,
    "active_window_offset_min_after_sunset": 45,
    "edge_score_threshold": 0.3,
    "heartbeat_interval_active_s": 300,
    "heartbeat_interval_idle_s": 1800,
    "max_fps_active": 1
  }
}
```

**Errors:**
- `400` — invalid payload, malformed coordinates
- `401` — claim code unknown, expired, or already consumed
- `409` — `hardware_id` already registered. Recovery is operator-driven; see §11.1.

The server creates two paired rows: a `cameras` row (custom-camera fields) and a `webcams` row (so the camera shows up in the existing query path). They are linked 1:1 via `webcams.custom_camera_id`.

### 6.3 `POST /api/cameras/:id/heartbeat`

Liveness check, capability refresh, control-plane response. Sent every `heartbeat_interval_active_s` while in an active window, every `heartbeat_interval_idle_s` while idle.

**Request:**
```json
{
  "status": "active",
  "uptime_s": 12345,
  "last_frame_at": "2026-05-03T01:32:14Z",
  "current_window": {
    "phase": "sunset",
    "window_id": "2026-05-03-sunset-cam42",
    "started_at": "2026-05-03T01:00:00Z",
    "expected_end_at": "2026-05-03T02:30:00Z"
  },
  "capabilities": {
    "device_class": "rpi-zero-2w",
    "firmware_version": "0.1.0",
    "streaming_modes": ["stills", "mjpeg"],
    "max_fps_active": 5,
    "max_resolution": "1920x1080",
    "has_edge_ml": true,
    "edge_ml_model_version": "sunset-quality-v3-int8",
    "battery_powered": false
  },
  "telemetry": {
    "battery_pct": null,
    "signal_dbm": -55,
    "free_storage_mb": 18432,
    "cpu_temp_c": 48
  }
}
```

`status` ∈ `"active" | "idle" | "error"`. `current_window` may be `null` when idle. `capabilities` and `telemetry` fields are optional but recommended.

**Response (200):**
```json
{
  "ack": true,
  "server_time": "2026-05-03T01:32:18Z",
  "config_overrides": {
    "edge_score_threshold": 0.4,
    "heartbeat_interval_active_s": 300,
    "max_fps_active": 2,
    "stream_mode": "stills"
  },
  "stream_request": null,
  "edge_model_update": null,
  "next_heartbeat_in_s": 300
}
```

`config_overrides` is a partial set; the device merges over its current config. `stream_request` is the MJPEG-upgrade hook (see §8). `edge_model_update` is reserved for OTA model updates (mechanism out of scope).

The device should sync its clock against `server_time` if drift exceeds a threshold (e.g., 30s). NTP is the primary clock source; this is a fallback.

### 6.4 `POST /api/cameras/:id/snapshot`

Upload a single captured frame. The hot path.

**Request (multipart/form-data):**

| Field | Type | Description |
|---|---|---|
| `image` | file (image/jpeg) | The captured frame. JPEG, max 5MB. |
| `captured_at` | ISO8601 UTC | Capture timestamp (device clock) |
| `phase` | `"sunrise" \| "sunset"` | Which terminator phase |
| `window_id` | string | Opaque ID grouping frames in one active window. Same value across all frames captured in this window. |
| `edge_score` | float `0.0–1.0` | Device's quality estimate |
| `edge_model_ver` | string | Version of the on-device scorer that produced `edge_score` |
| `exposure` | JSON string (optional) | `{ iso, shutter_us, wb_kelvin, lux_estimate }` |
| `frame_seq` | int (optional) | Monotonic counter within the window, for ordering |

**Response (202 Accepted):**
```json
{
  "snapshot_id": 78901,
  "accepted_at": "2026-05-03T01:32:14Z"
}
```

The server's commitments at acceptance time:
1. The image is in Firebase Storage at a server-determined path.
2. A `webcam_snapshots` row exists with `edge_score`, `edge_model_version`, `window_id`, and the existing fields populated.
3. AI scoring (binary + regression via the existing `snapshot_ai_inferences` pipeline) is queued for async execution.
4. Window-winner selection happens after the window closes (see §9.4).

**Errors:**
- `400` — malformed payload, missing required field, image too large
- `401` — invalid token
- `403` — camera revoked
- `413` — image exceeds 5MB
- `429` — rate limit (per-camera cap; default ~12 req/min, override-able server-side)

### 6.4a Direct-upload upgrade path (Phase 2, reserved)

To keep v1 → v2 non-breaking when image bytes outgrow Vercel, the protocol reserves a two-call direct-upload flow that the device opts into when capabilities allow it.

**Capability negotiation.** A device declares which upload modes its firmware supports:

```json
"capabilities": {
  ...,
  "upload_modes": ["api"]                  // v1-only firmware
  // or
  "upload_modes": ["api", "direct"]        // v2-capable firmware
}
```

The server's heartbeat response chooses the active mode for this camera:

```json
"config_overrides": {
  "upload_mode": "api"                     // v1 default
  // or
  "upload_mode": "direct"                  // when server is ready
}
```

If `upload_mode` is unset, devices use `"api"` (the §6.4 multipart path). If set to `"direct"`, devices use the two-call flow:

**Step 1:** `POST /api/cameras/:id/snapshot-url` — small JSON body with the same metadata fields as §6.4 *except* `image`. Server returns:

```json
{
  "snapshot_id": 78901,
  "upload_url": "https://firebasestorage.googleapis.com/...?signature=...",
  "upload_method": "PUT",
  "expires_at": "2026-05-03T01:42:14Z"
}
```

**Step 2:** Device PUTs the JPEG bytes directly to `upload_url`. Cloud storage handles the bytes; our API never sees them.

**Step 3:** `POST /api/cameras/:id/snapshot-finalize` — `{snapshot_id, sha256?}` to confirm the upload. Server verifies the file exists at the expected path, runs the rest of the v1 pipeline (DB row, AI scoring, winner selection).

**Why this is non-breaking now.** v1 firmware just declares `upload_modes: ["api"]` and never sees `upload_mode: "direct"` in heartbeat responses. v2 firmware adds `"direct"` to capabilities; the server can flip individual cameras (or the whole fleet) to direct uploads via a config override. Schema doesn't change — `webcam_snapshots` still gets the same row regardless of upload path. The only "future" work to build is the two endpoints and the signed-URL minting; the device firmware change is one if-statement on the heartbeat response.

**Why two calls instead of one.** The signed URL has to come from somewhere; the device can't know the upload path itself. The two-call shape is the standard pattern for cloud direct upload (S3, GCS, Firebase Storage all use it). The extra round-trip cost is per-snapshot at full bandwidth — fine on Pi, fine on ESP32 since it's two small HTTP requests bracketing one large PUT.

**Why not always direct.** At v1 scale, direct uploads cost more in operational complexity (signed-URL minting, expiry handling, bucket-level access control, monitoring upload failures end-to-end) than they save in bandwidth. Reserved for when API-mediated bandwidth becomes the bottleneck.

### 6.5 `POST /api/cameras/:id/stream` — Phase 2, reserved

Specified at the level of "this endpoint will exist" only. The wire format — MJPEG-over-WebSocket vs. chunked HTTPS POST — is deferred to a follow-up doc. The protocol declares the capability and the server-initiated upgrade flow (§8); the implementation is non-blocking for v1.

### 6.6 `GET /api/cameras/:id/config`

Optional pull alternative to receiving config on heartbeat. Returns the same `server_config` and `config_overrides` shapes. Useful for devices that want to refresh config more often than they heartbeat (e.g., on boot before the first heartbeat fires).

## 7. Capability Declaration

Every device declares its capabilities at registration AND on every heartbeat. The server stores the latest declaration and uses it for routing decisions (e.g., "this camera can stream MJPEG, ask it to upgrade for the next 15 minutes").

```json
{
  "device_class": "rpi-zero-2w" | "esp32-s3" | string,
  "firmware_version": "0.1.0",
  "streaming_modes": ["stills"] | ["stills", "mjpeg"],
  "max_fps_active": 1,
  "max_resolution": "1920x1080",
  "has_edge_ml": true,
  "edge_ml_model_version": "sunset-quality-v3-int8",
  "battery_powered": false
}
```

Sending the full blob on every heartbeat costs ~50 bytes vs. a versioned delta and removes any need for capability-version reconciliation. Firmware updates that change capabilities (e.g., adding MJPEG support) propagate automatically.

`device_class` is a free-form string. The server doesn't gate on it; it's metadata for fleet visibility.

## 8. Streaming Upgrade Flow (Phase 2)

Devices that report `mjpeg` in their `streaming_modes` are eligible for server-initiated stream upgrades during high-value windows. The handshake:

1. Server detects a high-value moment (peak AI score on recent snapshots, manual operator override, or a tunable rule).
2. On the next heartbeat response, the server includes:
   ```json
   "stream_request": {
     "mode": "mjpeg",
     "endpoint": "wss://api.sunrisesunset.studio/api/cameras/42/stream",
     "stream_token": "<short-lived opaque token, server-issued>",
     "until": "2026-05-03T02:00:00Z",
     "max_fps": 5
   }
   ```
3. Device opens the stream connection, authenticates with `stream_token`, pushes frames at `max_fps`.
4. At `until`, device closes the stream and returns to stills mode.
5. Server cancels via the next heartbeat by setting `stream_request.until` to a past time, or by returning `stream_request: null`.

ESP32 devices that don't declare `mjpeg` capability never receive `stream_request`. The protocol degrades gracefully — they keep doing what they were doing.

The MJPEG ingest endpoint, frame format, frontend video player, and storage strategy for live frames are deferred to a Phase 2 doc.

## 9. Active-Window and Snapshot Lifecycle

### 9.1 Window definition

The server's source of truth for active-window offsets lives in `app/lib/masterConfig.ts` and is included in `server_config` at registration. Defaults:

- Sunrise window: 45 min before sunrise → 30 min after sunrise
- Sunset window: 30 min before sunset → 45 min after sunset

### 9.2 Device-side computation

Devices compute the next window from their stored `lat`, `lng`, `timezone`, and the offsets above. Reference: `astral` Python lib (Pi), or a small C port of NOAA's solar position algorithm (ESP32). The parent app uses solar geometry in its terminator-ring cron and `app/lib/simple-sunset.ts`; firmware implementations should agree with `astral` (or equivalent) on sunrise/sunset times within ±60s for any given lat/lng. Exact alignment with the parent app's geometry library is a non-goal — what matters is the device and the server agree on when "now" is inside an active window.

### 9.3 Window IDs

`window_id` is a deterministic string formed at window-start: `<YYYY-MM-DD>-<phase>-cam<id>`. Example: `2026-05-03-sunset-cam42`. Devices generate this; the server doesn't allocate them. Two devices in the same physical location with their own `cameras` rows have distinct `window_id`s — that's intentional.

### 9.4 Winner selection

Winner selection is a **per-source server policy**, not a single global formula. Different webcam sources have different inputs and different cadence, and the protocol's job is only to provide the inputs — not to dictate how they're combined. The protocol's contributions are:

- `edge_score` (custom cameras only — Windy/external snapshots leave this NULL)
- `edge_model_version`
- `window_id` (custom cameras only — external sources don't have explicit windows)
- `is_window_winner` (boolean flag the server sets, regardless of source)

The flag is the cross-source contract: any snapshot with `is_window_winner = true` is the one the kiosk mosaic and frontend gallery surface for its source/phase/period. How the server decides which snapshot earns the flag varies by source.

#### 9.4.1 Custom cameras

Window close trigger: the device reports `status="idle"` on heartbeat AND no new snapshots arrive for that `window_id` for 5 minutes. Selection:

```
score = (edge_score * EDGE_WEIGHT) + (ai_regression_score * AI_WEIGHT)
winner = argmax(score) over all snapshots with the same window_id
```

Per-source weights and thresholds in `masterConfig.ts`:

```ts
WINNER_POLICY_CUSTOM = {
  EDGE_WEIGHT: 0.3,
  AI_WEIGHT: 0.7,
  MIN_SCORE_TO_WIN: 0.4,    // if no snapshot clears this, no winner is set
  WINDOW_CLOSE_GRACE_S: 300,
}
```

Losers retain `is_window_winner = false` and are kept for re-ranking when models improve.

#### 9.4.2 Windy / external sources

These have no `edge_score` and no protocol-defined window. The existing app territory governs how it picks a "current" or "best" snapshot for a Windy webcam — typically a rolling window over the last N minutes of cron-fetched snapshots, scored on `ai_regression_score` alone. Default policy:

```
score = ai_regression_score
winner = argmax(score) over snapshots in the last ROLLING_WINDOW_MIN minutes
                       for this webcam_id
```

```ts
WINNER_POLICY_WINDY = {
  AI_WEIGHT: 1.0,           // edge_score is NULL anyway
  MIN_SCORE_TO_WIN: 0.5,
  ROLLING_WINDOW_MIN: 90,   // re-pick every cron tick
}
```

The flag is recomputed on every cron run that fetches new Windy snapshots — not on a window-close trigger, because there's no window. Older `is_window_winner = true` rows for the same webcam are demoted as new ones get promoted.

#### 9.4.3 Why per-source

Without per-source policies, custom-camera deployments would drown out Windy webcams in any mixed pool (custom cameras produce 50–500× more snapshots per phase). Equally, Windy snapshots would always lose on absolute scores because the AI model is currently calibrated against the Windy distribution and custom cameras may produce systematically higher- or lower-scoring images depending on hardware. Decoupling the policies lets the kiosk mosaic and gallery treat the two sources as independent pools that get merged at the display layer with their own quotas, rather than fighting for slots via a single ranking.

#### 9.4.4 Display-layer composition

The frontend mosaic / kiosk should query winners by source and merge with quotas, e.g., "top 30 custom-camera winners + top 60 Windy winners, sorted by latitude." This keeps the mix legible regardless of how many cameras of either type are online. Specific quotas live in `masterConfig.ts`:

```ts
DISPLAY_QUOTA = {
  CUSTOM_MAX: 30,
  WINDY_MAX: 60,
}
```

A future query parameter `?include_losers=true` can expose the full archive (both sources).

### 9.5 Horizon-aware active windows

Standard sunrise/sunset calculation gives the time the sun crosses the **geometric horizon** — a flat sea-level line, no terrain. For a camera in a valley, on a city street, or with mountains in any direction, the *actual visible* sunrise/sunset can differ from the calculated one by 5–60+ minutes. This matters: the device wastes power streaming into a black sky before the real sunrise, and may cut off the streaming before the real sunset behind a ridge.

The protocol supports two correction methods:

**A) Uniform horizon altitude (`placement.horizon_altitude_deg`).** Operator estimates a single "average" elevation of obstructions in the camera's direction, e.g., +10° for moderate mountains, +2° for distant buildings, 0° for a clear sea horizon. Cheap, crude, ESP32-trivial. Solar libs accept this as a parameter (`astral.sun(observer, ..., dawn_dusk_depression=...)` or equivalent on NOAA SPA).

**B) Per-azimuth horizon profile (`placement.horizon_profile`).** A richer model: a list of `{azimuth_deg, altitude_deg}` pairs (typically 36–72 points around the horizon). The active-window calculation uses the altitude at the sun's current azimuth. Generated by the AR placement portal (§14) by sweeping the phone across the horizon and recording the actual horizon line. When present, the device interpolates this profile and uses it instead of the uniform value.

Both methods use the same active-window computation, just with a different "horizon altitude" input. The device computes the next sunrise/sunset as "time when sun's altitude crosses the horizon profile at the sun's current azimuth," then applies the configured offsets.

For v1 the firmware MAY ship with only method A; method B is desirable but optional. Devices that don't support method B simply ignore `horizon_profile` and fall back to `horizon_altitude_deg`.

### 9.6 Phase-preference and idle behavior

The `operator_preferences.phase_preference` value controls which active windows the device participates in:

- `"sunrise"` — device wakes only for the sunrise window each day. Sleeps through sunset entirely.
- `"sunset"` — device wakes only for the sunset window each day.
- `"both"` — device wakes for both windows.

This is a meaningful power-saving choice for ESP32 deployments: `"sunrise"` or `"sunset"` cuts radio + capture time roughly in half. The device computes only the relevant next-event time and deep-sleeps until then. Server-side, the value also informs the daily-delivery feature (§14): the operator gets the phase they asked for.

The server MAY override `phase_preference` via `config_overrides` on heartbeat (e.g., for a special event). Devices that have already deep-slept past the next window won't see an override until they next wake, so overrides intended for the *next* window must arrive before the device sleeps.

## 10. Database Schema

### 10.1 New tables

```sql
-- Single-use bootstrap codes
CREATE TABLE camera_claim_codes (
  code TEXT PRIMARY KEY,
  label TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  consumed_by_camera_id INTEGER
);

CREATE INDEX camera_claim_codes_unconsumed_idx
  ON camera_claim_codes (code)
  WHERE consumed_at IS NULL;

-- Custom edge cameras
CREATE TABLE cameras (
  id SERIAL PRIMARY KEY,
  hardware_id TEXT NOT NULL UNIQUE,
  device_token_hash TEXT NOT NULL,
  webcam_id INTEGER REFERENCES webcams(id),
  device_class TEXT NOT NULL,
  firmware_version TEXT,
  capabilities JSONB NOT NULL,

  -- Geographic placement
  lat NUMERIC(9,6) NOT NULL,
  lng NUMERIC(9,6) NOT NULL,
  elevation_m NUMERIC,
  timezone TEXT NOT NULL,
  location_source TEXT,
    -- 'operator-typed' | 'wifi-geolocation' | 'gps' | 'ip-geolocation'

  -- Physical placement (where the camera is pointed)
  azimuth_deg NUMERIC,
  tilt_deg NUMERIC,
  horizon_altitude_deg NUMERIC DEFAULT 0,
  horizon_profile JSONB,    -- nullable; array of {azimuth_deg, altitude_deg}

  -- Operator preferences
  phase_preference TEXT NOT NULL DEFAULT 'both',
    -- 'sunrise' | 'sunset' | 'both'
  delivery_preferences JSONB,
    -- nullable; { type, target, cadence, image_choice }

  status TEXT NOT NULL DEFAULT 'active',
    -- 'active' | 'idle' | 'error' | 'revoked'
  registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_heartbeat_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ
);

CREATE INDEX cameras_status_idx ON cameras (status);
CREATE INDEX cameras_last_heartbeat_idx ON cameras (last_heartbeat_at DESC);

-- Add foreign key from claim codes back to cameras now that the table exists
ALTER TABLE camera_claim_codes
  ADD CONSTRAINT camera_claim_codes_camera_fk
  FOREIGN KEY (consumed_by_camera_id) REFERENCES cameras(id);
```

### 10.2 Extensions to existing tables

```sql
-- Distinguish custom cameras from Windy-sourced webcams
ALTER TABLE webcams ADD COLUMN source TEXT NOT NULL DEFAULT 'windy';
  -- Matches the existing TS WebcamSource type: 'windy' | 'custom' | 'openweather'
ALTER TABLE webcams ADD COLUMN custom_camera_id INTEGER REFERENCES cameras(id);

CREATE INDEX webcams_source_idx ON webcams (source);

-- Edge ML scoring + winner selection on snapshots
ALTER TABLE webcam_snapshots ADD COLUMN edge_score NUMERIC;
ALTER TABLE webcam_snapshots ADD COLUMN edge_model_version TEXT;
ALTER TABLE webcam_snapshots ADD COLUMN window_id TEXT;
ALTER TABLE webcam_snapshots ADD COLUMN is_window_winner BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX webcam_snapshots_window_id_idx ON webcam_snapshots (window_id);
CREATE INDEX webcam_snapshots_winners_idx
  ON webcam_snapshots (webcam_id, captured_at DESC)
  WHERE is_window_winner = TRUE;
```

### 10.3 Pairing model

Each `cameras` row is paired 1:1 with a `webcams` row at registration. The `webcams` row gets `source = 'custom'` and `custom_camera_id = cameras.id`. From the frontend's perspective, a custom camera looks like any other webcam — the existing `/api/db-terminator-webcams` query path returns it without changes.

Identity rule: `cameras.id` is the device-facing primary key (used in URL paths). `webcams.id` is the frontend-facing primary key (used in mosaics, gallery, AI scoring). The two are linked but distinct.

## 11. Edge Cases

### 11.1 Duplicate registration

If a device with an existing `hardware_id` re-registers (e.g., factory reset, lost token), the server returns `409 Conflict` with `{ "existing_camera_id": <id> }`. The recovery flow is operator-driven: revoke the old token, issue a new claim code, the device clears its config and registers fresh. No automatic token re-issue from `hardware_id` alone — that would let a stolen device bypass revocation.

### 11.2 Clock drift on the device

Devices SHOULD use NTP. If `server_time` on a heartbeat response differs from local time by more than 60s, the device adjusts its clock. `captured_at` on uploaded snapshots is the device's clock at capture; the server stores it as-is. Server-side correction for known clock drift is out of scope for v1 — operators are expected to ensure their devices have working NTP.

### 11.3 Offline buffering

Devices MAY buffer captured snapshots when the network is unreachable, up to a device-determined cap. On reconnect, they replay the buffer in chronological order. Each buffered snapshot retains its original `captured_at`. The server treats late uploads no differently from real-time uploads, except for window-winner timing: if a buffered snapshot arrives after winner selection ran, the server re-runs winner selection for that `window_id`.

### 11.4 Image size cap

5 MB per snapshot, server-enforced. ESP32-CAM JPEGs at 1920×1080 are typically 200–400KB, Pi Camera 3 Wide JPEGs at 1920×1080 are typically 400–800KB. The 5MB cap is generous and protects the API from accidental BMP/PNG uploads.

### 11.5 Rate limits

Per-camera default: 12 snapshots/minute, 60 heartbeats/hour. These are sized for `max_fps_active = 1` plus headroom; devices declaring `max_fps_active > 1` should request a per-device override at registration (mechanism: server-side allow-list, not exposed in protocol v1).

### 11.6 What if the device's lat/lng is wrong

The device's `lat`/`lng` is provided at registration and stored on both `cameras` and `webcams` rows. If a device is physically relocated, the operator must explicitly update it (admin endpoint, out of scope for v1). Devices SHOULD NOT auto-update their location — a captured GPS jitter could push the active window to the wrong time.

### 11.7 How devices acquire lat/lng

The protocol doesn't care; the device just declares a value at registration. Recommended firmware approaches in order of preference:

1. **Wi-Fi geolocation** — the device is already scanning Wi-Fi to connect; same scan yields a list of nearby BSSIDs that can be POSTed to **Mozilla Location Service** (free, open) or the **Google Geolocation API** (paid, better coverage). Returns `lat/lng` accurate to 10–100m. Works on Pi and ESP32 with no extra hardware. Recommended as the v1 default.
2. **Operator-typed config** — `lat/lng` written into `config.json` at flash time or entered via the captive portal. Always available as a fallback if (1) fails.
3. **GPS module** — physical hardware (e.g., u-blox NEO-6M, ~$10–15). Most accurate, slowest first-fix, requires sky view. Use only if the deployment specifically needs it (mobile cameras, off-grid sites).
4. **IP geolocation** — last resort, often city-level wrong. Useful only as a sanity-check against an obviously-bad typed value.

Firmware SHOULD use (1) when network-connected, fall back to (2) on failure, and set `location_source` accordingly when calling `register`. If (1) and (2) disagree by more than ~1 km, prefer the typed value and log a warning — the operator probably knows what they meant, and a Wi-Fi geolocation outlier (rare but real) shouldn't silently move the camera.

### 11.9 Data retention

The default v1 policy:

- **Winners** (`is_window_winner = true`): retained **forever**. They're the artifact of the project.
- **Losers** (`is_window_winner = false`): retained **30 days**, then hard-deleted (DB row + Firebase image).

Tunable per-source in `masterConfig.ts`:

```ts
RETENTION_POLICY = {
  CUSTOM_WINNERS_DAYS:    null,    // null = forever
  CUSTOM_LOSERS_DAYS:     30,
  WINDY_WINNERS_DAYS:     null,
  WINDY_LOSERS_DAYS:      30,
}
```

A daily cron (`/api/cron/cleanup-snapshots`) deletes expired rows + their Firebase paths in batches. Same job retains ~90 days of `snapshot_ai_inferences` rows for losers (so you can reconstruct "what did the model think 60 days ago" forensics without keeping the actual images).

**Why losers exist at all.** Edge ML pre-filtering already drops obvious garbage on the device, so by the time a snapshot is in the DB it's a survivor — it cleared `edge_score_threshold`. 30 days gives you a window to (a) re-rank losers if a model upgrade lands, (b) do "did the model miss a good one" forensics if a particular sunset on a particular day looks weirdly mediocre on the site. After 30 days, the chance of either is low enough to take the storage win.

**Why winners forever.** The point of the project is the archive. Storage cost on winner-only retention is bounded — at 2 windows/day × 1 winner per camera × 365 days × 10 years = ~7300 images per camera. At ~500KB each that's ~3.6GB per camera per decade. Cheap.

**Operator-initiated scrub.** Out of scope for v1, but the schema supports it: deleting a `cameras` row cascades to its `webcams` row (via FK), and a follow-up cron sweeps any `webcam_snapshots` whose `webcam_id` references a deleted webcam. So `DELETE FROM cameras WHERE id = X` is the operator-scrub primitive when that admin UI lands. The `cameras` row is the canonical "scrub key" for a given operator's data — one operator hosts one camera in v1, so per-camera scrub equals per-operator scrub.

### 11.8 Obstructed-horizon edge cases

A camera pointed at a tall building 50m away will have a very high `horizon_altitude_deg` for that azimuth — possibly enough that the sun never crosses the visible horizon at certain times of year. In that case the device's window calculation will return "no sunrise/sunset visible today" for that phase. The device SHOULD treat this as a normal idle period (no error, no failed heartbeat) and resume on the next day where the geometry works out. The server SHOULD report this state as `status: "idle"`, not `"error"`.

## 11A. Firmware and Edge-Model Update Channel

Two artifact types ride the same channel, declared on every heartbeat response:

```json
"firmware_update": null | {
  "version": "0.4.0",
  "device_class": "rpi-zero-2w",
  "url": "https://updates.sunrisesunset.studio/firmware/rpi-zero-2w/0.4.0.tar.gz",
  "sha256": "f3a9b8c4e5d6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a",
  "signature": "<base64 ed25519 signature over sha256>",
  "min_battery_pct": 50,
  "mandatory": false,
  "rollout_id": "fw-040-canary"
},
"edge_model_update": null | {
  "version": "sunset-quality-v4-int8",
  "device_class": "rpi-zero-2w",
  "url": "https://updates.sunrisesunset.studio/models/rpi-zero-2w/sunset-quality-v4-int8.onnx",
  "sha256": "...",
  "signature": "...",
  "mandatory": false,
  "rollout_id": "model-v4-50pct"
}
```

### 11A.1 Why two channels

Edge models change more often than firmware (every model retraining cycle), are smaller (~1–5MB), and have lower blast radius (a bad model just makes scoring worse — it can't brick the device). Firmware updates are larger (10–50MB on Pi, 1–4MB on ESP32), riskier, and need rollback semantics. Same wire format, different rollout cadence.

### 11A.2 Verification (mandatory)

Devices MUST verify both `sha256` and `signature` before applying an update. Refusal to verify is non-negotiable — applying an unverified update from the network is the supply-chain compromise vector for the whole fleet.

- **Hashing.** SHA-256 over the downloaded artifact bytes, compared to the manifest value.
- **Signing.** Ed25519. The project maintains a signing key offline (not on the server). The public key is baked into the device firmware at flash time. The server only distributes signed manifests; it cannot forge new ones because it never holds the private key.
- **Compromise of the server** lets an attacker stop updates or replay old ones, but not push malicious code. (Mitigation for replay: include `version` in the signed payload so old signatures can't promote a downgrade.)

If verification fails, the device:
1. Discards the artifact.
2. Logs the failure to its next heartbeat (`telemetry.last_update_failure`).
3. Does NOT retry the same `version` until it comes back as a different `rollout_id`.

### 11A.3 Apply semantics

**Edge model.** Atomic file swap. Device writes the new file under a `.tmp` extension, fsyncs, renames over the active path, restarts the scoring subprocess. No reboot needed. Old model is kept as `.previous` for rollback if the new model fails sanity checks (e.g., produces all-zero scores).

**Firmware.** Hardware-specific:

- **Pi**: A/B-style update. Two install slots, swap the active symlink, reboot. If the new slot fails to come up healthy in 5 min, bootloader/initramfs falls back to the previous slot. Reference implementation can use `rauc` or a hand-rolled symlink-flip with a watchdog. v1 may simplify to "untar over current install + systemctl restart" if you accept higher rollback friction.
- **ESP32**: ESP-IDF native OTA APIs. Two flash partitions; `esp_ota_*` functions handle the swap. ESP-IDF rollback-on-failure is built in.

### 11A.4 Acknowledgment

After successful install, the device POSTs:

```
POST /api/cameras/:id/update-ack
{
  "kind": "firmware" | "edge_model",
  "from_version": "0.3.1",
  "to_version": "0.4.0",
  "rollout_id": "fw-040-canary",
  "installed_at": "2026-05-03T03:14:22Z"
}
```

Server uses these to track rollout adoption and surface fleet-wide status. Failures (verification failed, install failed, post-install health check failed) are reported via the same endpoint with a `status: "failed", reason: "..."` field.

### 11A.5 Rollouts

The server's choice to include an update in a heartbeat response is rollout-controlled. Default policy: canary 5% → 50% → 100% over a few days, gated on no `update-ack` failures from earlier cohorts. The protocol just transmits the manifest; rollout policy lives server-side, out of scope here.

### 11A.6 Battery and timing guards

- `min_battery_pct`: device skips applying the update unless battery is at least this level (irrelevant for mains-powered Pi; meaningful for solar/battery ESP32).
- Devices SHOULD NOT apply firmware updates during an active window. Defer until the next idle period, even if the manifest is "mandatory."

### 11A.7 v1 simplification

For first-light deployment (you're flashing every Pi yourself), the firmware update channel can be deferred entirely — `git pull` over SSH is fine for a 1–5 camera fleet. The protocol reserves the manifest shape and `update-ack` endpoint so when you cross "I can't physically touch every camera anymore," the firmware-side OTA work is the only new thing to build. Server-side, the manifest endpoint and signing pipeline come along with it.

## 12. ESP32 Portability — Design Choices

The protocol was specifically shaped to be implementable on ESP32-S3 without compromise.

| Choice | Why it matters for ESP32 |
|---|---|
| HTTPS REST + JSON, no MQTT/gRPC | mbedTLS + `esp_http_client` cover this natively; no extra protocol stack |
| Bearer-token auth, no mTLS | One header to attach; no client cert management |
| Stills-first, MJPEG opt-in | Devices that can't stream simply never advertise the capability |
| Device-computed window | Wake from deep sleep on RTC alarm, no always-on radio |
| Capabilities on every heartbeat | No version reconciliation logic to maintain |
| Quantized INT8 ONNX edge model, optional | TFLite-Micro path; falls back gracefully if `has_edge_ml = false` |
| Server-mediated uploads, no Firebase SDK on device | Firebase SDK is too large for ESP32; the device only knows about our API |
| `server_time` synchronization on heartbeat | Fallback when NTP fails on flaky networks |

Anything Pi-specific (`picamera2`, `systemd`, `git pull`-style updates) lives in firmware-side code, not in the protocol. The Pi reference and the ESP32 port speak identical wire format.

## 13. Open Questions

- **Winner-selection weighting per source.** `WINNER_POLICY_CUSTOM` and `WINNER_POLICY_WINDY` weights/quotas are placeholders. Need a calibration pass once both sources have real distributions.
- **Buffered-replay window.** How far back can a device replay buffered snapshots and still have them count? Suggest: any snapshot with `captured_at` within 7 days of upload is accepted; older are rejected to avoid corrupting historical analysis.
- **Multi-camera-per-host.** v1 assumes one camera per `hardware_id`. A Pi with two cameras would need either two `hardware_id`s or a protocol change.
- **Stream ingest (Phase 2).** WebSocket vs. chunked HTTPS POST. Both work; WebSocket is friendlier for the frontend video player.
- **Resolved 2026-05-03**:
  - ~~Snapshot ingest scaling~~ — addressed by §6.4a (direct-upload upgrade path reserved, capability-driven, non-breaking).
  - ~~Firmware update channel~~ — addressed by §11A (signed manifests, ed25519 verification, A/B install on Pi + ESP-IDF OTA on ESP32, `update-ack` endpoint).

## 14. Out of Scope (Mentioned, Not Specified)

- Captive-portal Wi-Fi onboarding (Tier 2 of claim-code entry).
- MJPEG ingest endpoint internals + frontend video player.
- Real-time wake-up channel (would be MQTT or WebSocket).
- OTA firmware/model updates (`edge_model_update` field reserved but mechanism undefined).
- Direct-to-Firebase upload variant (signed URLs).
- Per-device exposure tuning UI.
- Admin-side fleet-management UI (camera list, status dashboard, manual revoke/relocate).
- Remote SSH / device access for debugging. Recommended approach: Tailscale (free for personal use) — Pi joins the operator's Tailscale net at flash time, you SSH in via the Tailscale IP, no port forwarding required. ESP32 doesn't run Tailscale natively; for ESP32 deployments, debug logging + OTA replaces interactive SSH. Not part of the protocol; lives in firmware-side ops notes.
- Physical "return address" on the camera enclosure. For sold/distributed cameras, a sticker like *"This is part of an art project. If found unattended, please email …"* protects against orphaned hardware after a move/divorce/etc. Packaging concern, not protocol — but worth flagging now so the firmware build doc includes it.

### Sub-projects worth flagging

These are real planned features that consume the protocol's primitives but are themselves out of scope here. Each gets its own design doc.

- **AR placement portal.** A browser-based (WebXR + DeviceOrientation) tool the operator opens on their phone during installation. It overlays the sun's trajectory on the live camera view: northern-solstice arc (extreme summer sunrise/sunset azimuth), southern-solstice arc (extreme winter), equinox midpoint arc, and a fixed crosshair locked to the phone's current bearing + horizon line. The operator moves the phone around their installation site, sees in real time which window or wall captures the most of the sun's annual path, then mounts the camera there. While they're sweeping the phone around, the portal captures the visible horizon altitude at each azimuth — that data becomes the `horizon_profile` posted to the protocol's registration. Two birds: best placement + horizon profile in one motion. **Protocol primitives consumed:** `placement.azimuth_deg`, `placement.tilt_deg`, `placement.horizon_profile`. Companion doc: `docs/ar-placement-portal.md` (to be written).

- **Operator daily delivery ("give-back").** Server-side feature that mails/texts/uploads the operator's daily window-winner snapshot to a target they choose. Encourages people to host cameras: "you give me a sunset stream from your roof, I send you a beautiful sunset photo every evening." Delivery types in v1: `email` (SendGrid/Resend/Postmark, easiest), `personal_gallery_url` (auth-gated public URL listing their camera's winners — zero external dependencies). Delivery types in v2: `google_photos` (OAuth + Library API), `sms` (Twilio, paid). **Protocol primitives consumed:** `operator_preferences.delivery`, `is_window_winner` on snapshots. Companion doc: `docs/operator-delivery.md` (to be written).

- **Admin claim-code generation UI.** A small protected page in the parent app for generating claim codes, viewing camera fleet status, and revoking devices. The protocol already exposes `/api/admin/claim-codes`; this is just a UI on top.

## 15. Glossary

- **Active window** — A continuous time interval during which a device captures and uploads. Defined by sunrise/sunset offsets in `masterConfig.ts`.
- **Claim code** — Single-use, human-readable bootstrap code (e.g., `SUNSET-7K3M-9XQ2`) that a device exchanges for a long-lived token.
- **Device token** — Long-lived, machine-only secret used as a bearer token for all post-registration requests.
- **Edge score** — A 0.0–1.0 quality estimate produced by the device's on-board ML model.
- **Hardware ID** — A stable, unique identifier derived from device hardware (Pi serial number, ESP32 MAC). Used to detect duplicate registrations.
- **Window winner** — The single snapshot per `window_id` with the highest combined `edge_score + ai_regression_score`. Surfaced to the frontend by default.
