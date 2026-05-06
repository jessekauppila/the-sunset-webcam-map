# Sunrise/Sunset Pi Webcam — MVP Spec

A handoff doc for a Claude Code session. The goal: build the firmware/software for a custom Raspberry Pi Zero 2 W edge camera that joins the Sunrise/Sunset network and streams when a sunrise/sunset is developing.

---

## Project Context

**Parent project:** Sunrise/Sunset — a distributed planetary observatory that locates webcams currently showing sunrises and sunsets, ranks them with an ML model, and displays them.

**Existing repo to reference:** `github.com/jessekauppila/the-sunset-webcam-map` — the web app that queries webcam APIs and uses subsolar-point geometry to locate cameras near the terminator. Look here for:
- Existing camera/webcam data model (the Pi camera should register in a way that's compatible)
- API patterns already in use
- Frontend expectations for what a "camera" looks like

**Why custom Pi cameras:** Commercial webcam APIs (Windy, EarthCam, etc.) surface only a few hundred candidates at any moment, most not facing the sun. Custom cameras give us better sunrise/sunset coverage, can be tuned remotely, and only stream when conditions are good — saving bandwidth and compute on the ML ranker.

---

## Hardware (per unit)

| Component | Choice | Cost |
|---|---|---|
| SBC | **Raspberry Pi Zero 2 W** (WiFi built-in) | $15 |
| Camera | **Camera Module 3 Wide** (12MP, 120° FOV — chosen for landscape) | $35 |
| Storage | 32GB microSD (SanDisk Ultra / Samsung EVO, Class 10/U1) | $7 |
| Power | 5V 2.5A micro USB adapter (CanaKit official) | $8 |
| Enclosure | IP65 weatherproof box w/ clear lid + cable glands | $25 |
| **Total** | | **~$90/unit** |

**Future evaluation:** ESP32-class microcontrollers as a cheaper, lower-power alternative for higher node density.

---

## Software Stack

```
- Raspberry Pi OS Lite (64-bit, headless)
- picamera2 (Python) for camera control
- FFmpeg for encoding/streaming
- systemd services for auto-start + watchdog
- Python 3.11+
```

**Streaming protocol (MVP):** Start with HLS or MJPEG over HTTPS to a simple server endpoint. WebRTC/RTSP can come later.

**On-device intelligence (deferred past MVP):** Local sunrise/sunset quality detection so the camera only streams when something good is happening. For MVP, use a simple time-window heuristic based on the device's known location + computed local sunrise/sunset times (use `astral` or similar Python lib).

---

## MVP Scope — What to Build

The MVP is **one Pi running code that does these five things**:

1. **First-boot registration**
   - Generates a unique device ID from the Pi's serial number
   - POSTs to `api.sunrisesunset.studio/cameras/register` with `{deviceId, macAddress, location (lat/lng), timezone}`
   - Receives back `{cameraId, streamKey, serverConfig}` and stores in `/etc/sunset-cam/config.json`
   - Location for MVP can be hardcoded or set via a config file — captive-portal WiFi setup is Phase 2

2. **Sunrise/sunset window detection**
   - On a 1-minute loop, compute local sunrise/sunset times for the device's lat/lng
   - "Active window" = 45 min before sunrise to 30 min after, and 30 min before sunset to 45 min after
   - Outside the window: idle (camera off, low power)
   - Inside the window: start streaming

3. **Streaming**
   - When active, capture from picamera2 with auto-exposure tuned for golden hour (lower ISO, faster shutter to avoid blowout)
   - Stream MJPEG (MVP) to `api.sunrisesunset.studio/cameras/{cameraId}/stream` using the streamKey for auth
   - Also save a still every 30 seconds locally for an eventual time-lapse feature

4. **Heartbeat + status**
   - Every 5 minutes, POST `{cameraId, status, uptime, lastFrameAt, currentMode}` to `/cameras/{cameraId}/heartbeat`

5. **Update check (basic)**
   - Every 6 hours, GET `/updates/check?device_id=X&current_version=Y`
   - If update available, `git pull` + `systemctl restart sunset-cam`
   - Phase 2 will move to signed updates / Balena / MQTT

---

## Repo Structure (suggested)

```
sunset-cam-firmware/
├── README.md
├── install.sh                  # one-shot install script for fresh Pi
├── systemd/
│   └── sunset-cam.service
├── config/
│   └── config.example.json
├── src/
│   ├── main.py                 # entry point, runs the loop
│   ├── registration.py         # first-boot registration
│   ├── solar.py                # sunrise/sunset window calc (uses astral)
│   ├── camera.py               # picamera2 wrapper
│   ├── streamer.py             # ffmpeg/MJPEG to server
│   ├── heartbeat.py
│   ├── updater.py
│   └── config.py               # load/save device config
├── tests/
│   └── ...
└── pyproject.toml
```

---

## Where to Start (suggested order for Claude Code)

1. **Look at the existing repo first** — `github.com/jessekauppila/the-sunset-webcam-map`. Find the camera data model and any existing API routes. The Pi firmware needs to match what the web app expects. If the registration endpoint doesn't exist yet, note what needs to be added on the server side too.
2. **Scaffold the firmware repo** with the structure above, `pyproject.toml`, basic README, and the systemd unit.
3. **Build `solar.py` first** — pure logic, easy to TDD. Given lat/lng + current UTC, return `{is_active, mode: "sunrise"|"sunset"|"idle", next_event_in_seconds}`.
4. **Build `config.py` + `registration.py`** with the registration endpoint mocked in tests.
5. **Build `camera.py`** — wrap picamera2 with golden-hour-friendly defaults. This needs a real Pi to test, so make sure it's mockable.
6. **Build `streamer.py`** — start with periodic still uploads (POST a JPEG every few seconds) before tackling MJPEG/HLS. A "stream" of stills is a perfectly valid MVP.
7. **Wire it all together in `main.py`** with a clear loop and graceful shutdown.
8. **Add `heartbeat.py` and `updater.py`** last — they're the easy ones.

Develop on a Mac/Linux box with picamera2 mocked, then deploy to a real Pi to test the camera path.

---

## Out of Scope for MVP (note it, don't build it)

- Captive-portal WiFi setup on first boot
- Signed/secure updates
- Tailscale / VPN for remote SSH
- MQTT real-time control
- On-device ML quality scoring
- Time-lapse video generation (just save the stills for now)
- Balena fleet management
- ESP32 variant

---

## Open Questions to Resolve Early

- Does the existing web app already have a `cameras` table / API, or is this the first custom-camera integration? (Check the repo.)
- What's the auth model on the existing API? Pi firmware needs to match it.
- Where will the streaming server actually live? Same backend as the web app, or a separate service?
- Confirm the streaming protocol with whatever the frontend is set up to consume.
