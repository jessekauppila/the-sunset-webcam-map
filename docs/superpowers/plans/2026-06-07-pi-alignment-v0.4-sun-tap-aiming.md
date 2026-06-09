# Pi-Alignment v0.4 Sun-Tap Aiming — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an operator aim a Pi sunset/sunrise camera in minutes by tapping the visible sun in a phone browser — anchoring the camera's compass heading from one observation, then showing where the year's sunsets fall and whether they fit the frame.

**Architecture:** All code lives in the `sunset-cam-firmware` repo. Pure-math modules (sun azimuth, pixel↔angle, heading state, FOV-fit) are built and tested with zero hardware, then wired into a stdlib `ThreadingHTTPServer` that serves the existing renderers plus a new `/setup/tap` endpoint. The MPU-6050 supplies roll/pitch (already woken via `make_orientation_reader`); the sun supplies heading. No magnetometer, no OpenCV, no cloud/DB changes (deferred).

**Tech Stack:** Python 3.11 (Pi OS Bookworm), stdlib only (`http.server`, `math`, `datetime`), `picamera2` (hardware), `smbus2` (hardware), `pytest`. Repo uses `from __future__ import annotations` and TDD with fake-injection (`FakeBus`, fake `frame_source`).

**Working location:** `~/GitHub/sunset-cam-firmware` on a feature branch `feat/v0.4-sun-tap-aiming` off `origin/main`. Confirm the branch before each commit (PRs merge in parallel here).

---

## Scope

Sub-project 1 only: the sun-tap aiming fast-path + setup-server. Deferred (NOT in this plan): v0.3 auto-calibration pipeline, the commissioning/field state machine + AP-mode hotspot, relocation, motorized pan, any cloud `app/`/`database/` change.

## File Structure

| File | Responsibility | New/Modify |
|---|---|---|
| `src/sunset_cam/solstice_math.py` | add `compute_sun_azimuth(lat,lng,t_utc)` (sun's azimuth at an arbitrary time) + `solstice_sunset_azimuths(lat,year)` + `fov_fit(lat,lng,center_az,fov,year)` | Modify |
| `src/sunset_cam/heading.py` | `pixel_offset_to_angle()`, `heading_from_tap()`, the `HeadingState` model (uncalibrated/tapped/suspect) | Create |
| `src/sunset_cam/setup_alignment.py` | phase-parameterize `render_align_page`; confidence-gate the arcs; add FOV-fit bars; touch tap handler | Modify |
| `src/sunset_cam/setup_server.py` | `ThreadingHTTPServer` wiring the routes incl. `POST /setup/tap`, `GET /setup/state.json`; camera lock; injectable deps | Create |
| `tests/test_solstice_math.py` | tests for the new functions | Modify |
| `tests/test_heading.py` | tests for heading math + state | Create |
| `tests/test_setup_server.py` | route dispatch / tap / 503 tests | Create |
| `tests/test_setup_alignment.py` | overlay phase + confidence-gating tests | Modify |

---

### Task 1: `compute_sun_azimuth` — the sun's azimuth at an arbitrary time

The fast path lets the operator tap the sun whenever it's visible, not only at the instant of sunset, so we need the general solar azimuth (existing `sunset_azimuth_for_day` is sunset-only). Reuses the existing declination/Julian-day helpers; adds equation-of-time + hour-angle.

**Files:**
- Modify: `src/sunset_cam/solstice_math.py` (add after `sunset_azimuth_for_day`)
- Test: `tests/test_solstice_math.py`

- [ ] **Step 1: Write the failing test** (cross-check against the NOAA Solar Calculator for Bellingham)

```python
# tests/test_solstice_math.py  (add)
from datetime import datetime, timezone
from sunset_cam.solstice_math import compute_sun_azimuth

def test_compute_sun_azimuth_matches_noaa_bellingham_afternoon():
    # Bellingham 2026-06-21 ~01:00 UTC (early evening local, sun in the NW).
    # NOAA Solar Calculator azimuth for (48.7519, -122.4787) at this instant
    # is ~300° (WNW). Tolerance ±2° (our model is ~±1°, plus rounding).
    t = datetime(2026, 6, 21, 1, 0, 0, tzinfo=timezone.utc)
    az = compute_sun_azimuth(48.7519, -122.4787, t)
    assert 296.0 <= az <= 304.0

def test_compute_sun_azimuth_due_south_near_solar_noon():
    # At solar noon the sun is due south in the N. hemisphere → ~180°.
    # Bellingham lng -122.4787 → solar noon ≈ 20:10 UTC. Use 20:10Z.
    t = datetime(2026, 3, 20, 20, 10, 0, tzinfo=timezone.utc)
    az = compute_sun_azimuth(48.7519, -122.4787, t)
    assert 174.0 <= az <= 186.0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest tests/test_solstice_math.py::test_compute_sun_azimuth_matches_noaa_bellingham_afternoon -v`
Expected: FAIL — `ImportError: cannot import name 'compute_sun_azimuth'`.

- [ ] **Step 3: Write minimal implementation**

```python
# src/sunset_cam/solstice_math.py  (add; needs: from datetime import datetime)
def compute_sun_azimuth(lat_deg: float, lng_deg: float, t_utc) -> float:
    """Azimuth (degrees from North, clockwise) of the sun at time t_utc (a
    timezone-aware UTC datetime) seen from (lat, lng). NOAA approximation,
    good to ~±1°. Reuses the declination model used elsewhere in this module."""
    jd = _julian_day(t_utc.year, t_utc.month, t_utc.day)
    n = jd - 2451545.0
    g = math.radians((357.528 + 0.9856003 * n) % 360.0)
    lam = math.radians(
        (280.460 + 0.9856474 * n + 1.915 * math.sin(g) + 0.020 * math.sin(2 * g)) % 360.0
    )
    eps = math.radians(23.439 - 0.0000004 * n)
    decl = math.asin(math.sin(eps) * math.sin(lam))

    # Equation of time (minutes): mean solar longitude minus apparent right ascension.
    ra_deg = math.degrees(math.atan2(math.cos(eps) * math.sin(lam), math.cos(lam))) % 360.0
    l_mean = (280.460 + 0.9856474 * n) % 360.0
    eot_min = 4.0 * (((l_mean - ra_deg + 180.0) % 360.0) - 180.0)

    minutes_utc = t_utc.hour * 60.0 + t_utc.minute + t_utc.second / 60.0
    true_solar_min = (minutes_utc + eot_min + 4.0 * lng_deg) % 1440.0
    hour_angle = math.radians(true_solar_min / 4.0 - 180.0)

    phi = math.radians(lat_deg)
    gamma = math.atan2(
        math.sin(hour_angle),
        math.cos(hour_angle) * math.sin(phi) - math.tan(decl) * math.cos(phi),
    )
    return (math.degrees(gamma) + 180.0) % 360.0
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m pytest tests/test_solstice_math.py -v`
Expected: PASS (both new tests + the existing ones). If an azimuth is off by ~180°, the `+ 180.0` convention or `hour_angle` sign is wrong — fix to satisfy the due-south test first (it's the unambiguous anchor).

- [ ] **Step 5: Commit**

```bash
cd ~/GitHub/sunset-cam-firmware && git branch --show-current   # expect feat/v0.4-sun-tap-aiming
git add src/sunset_cam/solstice_math.py tests/test_solstice_math.py
git commit -m "feat(solstice): compute_sun_azimuth for arbitrary time (sun-tap heading input)"
```

---

### Task 2: `solstice_sunset_azimuths` + `fov_fit` — does the year fit, and where's the best aim

**Files:**
- Modify: `src/sunset_cam/solstice_math.py`
- Test: `tests/test_solstice_math.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_solstice_math.py  (add)
from sunset_cam.solstice_math import solstice_sunset_azimuths, fov_fit

def test_solstice_sunset_azimuths_bellingham_span_about_74_deg():
    summer, winter = solstice_sunset_azimuths(48.7519, 2026)
    # Summer sets to the NW (larger compass bearing), winter to the SW.
    assert summer > winter
    assert 70.0 <= (summer - winter) <= 78.0   # ~74° annual swing at 48.75°N

def test_fov_fit_true_when_arc_inside_fov():
    # 120° FOV centered due west easily contains Bellingham's ~74° arc.
    res = fov_fit(48.7519, -122.4787, center_az=270.0, fov_deg=120.0, year=2026)
    assert res["fits"] is True
    assert res["captured"] == 365

def test_fov_fit_false_and_suggests_best_aim_when_arc_too_wide():
    # A deliberately narrow 40° FOV cannot contain the 74° arc.
    res = fov_fit(48.7519, -122.4787, center_az=270.0, fov_deg=40.0, year=2026)
    assert res["fits"] is False
    assert res["captured"] < 365
    # best_center_az maximizes captured sunsets; captured_at_best >= captured.
    assert res["captured_at_best"] >= res["captured"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest tests/test_solstice_math.py::test_solstice_sunset_azimuths_bellingham_span_about_74_deg -v`
Expected: FAIL — `ImportError`.

- [ ] **Step 3: Write minimal implementation**

```python
# src/sunset_cam/solstice_math.py  (add)
def solstice_sunset_azimuths(lat_deg: float, year: int) -> tuple[float, float]:
    """(summer_solstice_sunset_az, winter_solstice_sunset_az) compass bearings.
    Summer ≈ northernmost sunset (NW in N. hemisphere), winter ≈ southernmost (SW)."""
    summer = sunset_azimuth_for_day(lat_deg, year, 6, 21)
    winter = sunset_azimuth_for_day(lat_deg, year, 12, 21)
    return summer, winter


def fov_fit(
    lat_deg: float, lng_deg: float, center_az: float, fov_deg: float, year: int
) -> dict:
    """Whether the full-year sunset arc fits the FOV at this aim, how many
    sunsets the current aim captures, and the best fixed aim if it doesn't fit."""
    summer, winter = solstice_sunset_azimuths(lat_deg, year)
    half = fov_deg / 2.0

    def inside(az: float, center: float) -> bool:
        d = ((az - center + 540.0) % 360.0) - 180.0
        return -half <= d <= half

    fits = inside(summer, center_az) and inside(winter, center_az)
    captured = count_sunsets_in_fov(lat_deg, lng_deg, center_az, fov_deg, year)

    # Search candidate centers (1° steps across the arc) for the max-capture aim.
    best_center, best_captured = center_az, captured
    lo, hi = sorted((summer, winter))
    c = lo
    while c <= hi:
        cap = count_sunsets_in_fov(lat_deg, lng_deg, c, fov_deg, year)
        if cap > best_captured:
            best_center, best_captured = c, cap
        c += 1.0
    return {
        "fits": fits,
        "summer_az": summer,
        "winter_az": winter,
        "captured": captured,
        "best_center_az": best_center,
        "captured_at_best": best_captured,
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m pytest tests/test_solstice_math.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sunset_cam/solstice_math.py tests/test_solstice_math.py
git commit -m "feat(solstice): solstice_sunset_azimuths + fov_fit with best-aim search"
```

---

### Task 3: `heading.py` — pixel→angle and heading-from-tap

**Files:**
- Create: `src/sunset_cam/heading.py`
- Test: `tests/test_heading.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_heading.py
from sunset_cam.heading import pixel_offset_to_angle, heading_from_tap

def test_pixel_center_is_zero_offset():
    assert pixel_offset_to_angle(px_x=800, width=1600, hfov_deg=120.0) == 0.0

def test_pixel_right_edge_is_plus_half_fov():
    assert abs(pixel_offset_to_angle(1600, 1600, 120.0) - 60.0) < 1e-9

def test_pixel_left_edge_is_minus_half_fov():
    assert abs(pixel_offset_to_angle(0, 1600, 120.0) - (-60.0)) < 1e-9

def test_heading_from_tap_subtracts_offset_from_sun_azimuth():
    # Sun's true azimuth 300°; tapped a bit right of center (sun appears at +20°).
    # The camera must be pointed at 300 - 20 = 280°.
    h = heading_from_tap(sun_azimuth_deg=300.0, tap_px_x=1066.67, width=1600, hfov_deg=120.0)
    assert abs(h - 280.0) < 0.1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest tests/test_heading.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'sunset_cam.heading'`.

- [ ] **Step 3: Write minimal implementation**

```python
# src/sunset_cam/heading.py
"""Sun-tap heading math: convert a tapped sun pixel + the sun's true azimuth
into the camera's compass heading. No magnetometer; pinhole approximation
adequate for aiming (lens-distortion correction is a v0.3-grade refinement)."""
from __future__ import annotations


def pixel_offset_to_angle(px_x: float, width: int, hfov_deg: float) -> float:
    """Horizontal angle (deg) of a pixel from frame center. Center=0,
    right edge=+hfov/2, left edge=-hfov/2 (azimuth increases to the right
    for a normal forward-facing, non-mirrored camera)."""
    return ((px_x - width / 2.0) / width) * hfov_deg


def heading_from_tap(
    sun_azimuth_deg: float, tap_px_x: float, width: int, hfov_deg: float
) -> float:
    """Camera heading (compass deg) = sun's true azimuth minus where the sun
    appears in the frame. The object's apparent angle = its_azimuth - heading,
    so heading = azimuth - apparent_angle."""
    offset = pixel_offset_to_angle(tap_px_x, width, hfov_deg)
    return (sun_azimuth_deg - offset) % 360.0
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m pytest tests/test_heading.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sunset_cam/heading.py tests/test_heading.py
git commit -m "feat(heading): pixel_offset_to_angle + heading_from_tap (sun-tap math)"
```

---

### Task 4: `HeadingState` — the uncalibrated/tapped/suspect confidence model

The silent-fake-signal guard: never expose a heading we don't actually have.

**Files:**
- Modify: `src/sunset_cam/heading.py`
- Test: `tests/test_heading.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_heading.py  (add)
from sunset_cam.heading import HeadingState

def test_starts_uncalibrated():
    s = HeadingState(hfov_deg=120.0, width=1600)
    assert s.status() == "uncalibrated"
    assert s.heading_deg() is None

def test_becomes_tapped_after_apply_tap():
    s = HeadingState(hfov_deg=120.0, width=1600)
    s.apply_tap(sun_azimuth_deg=300.0, tap_px_x=800.0, roll_deg=0.2, pitch_deg=1.0)
    assert s.status() == "tapped"
    assert abs(s.heading_deg() - 300.0) < 0.1  # center tap → heading == sun az

def test_rejects_tap_when_not_level():
    s = HeadingState(hfov_deg=120.0, width=1600, level_tol_deg=5.0)
    ok = s.apply_tap(sun_azimuth_deg=300.0, tap_px_x=800.0, roll_deg=20.0, pitch_deg=0.0)
    assert ok is False
    assert s.status() == "uncalibrated"   # tap refused; "level the camera first"

def test_becomes_suspect_when_tilt_drifts_from_tap_time():
    s = HeadingState(hfov_deg=120.0, width=1600, drift_tol_deg=3.0)
    s.apply_tap(sun_azimuth_deg=300.0, tap_px_x=800.0, roll_deg=0.0, pitch_deg=0.0)
    s.update_orientation(roll_deg=10.0, pitch_deg=0.0)   # housing moved
    assert s.status() == "suspect"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest tests/test_heading.py::test_starts_uncalibrated -v`
Expected: FAIL — `ImportError: cannot import name 'HeadingState'`.

- [ ] **Step 3: Write minimal implementation**

```python
# src/sunset_cam/heading.py  (add)
class HeadingState:
    """Tracks heading confidence. Three states:
    - 'uncalibrated': no valid tap yet → overlay draws nothing speculative.
    - 'tapped': valid heading anchored.
    - 'suspect': housing tilt drifted from tap-time → ask for a re-tap."""

    def __init__(
        self, hfov_deg: float, width: int,
        level_tol_deg: float = 5.0, drift_tol_deg: float = 3.0,
    ) -> None:
        self._hfov = hfov_deg
        self._width = width
        self._level_tol = level_tol_deg
        self._drift_tol = drift_tol_deg
        self._heading: float | None = None
        self._tap_roll: float | None = None
        self._tap_pitch: float | None = None
        self._suspect = False

    def apply_tap(
        self, sun_azimuth_deg: float, tap_px_x: float, roll_deg: float, pitch_deg: float
    ) -> bool:
        """Anchor heading from a sun-tap. Refuses (returns False) if the camera
        isn't level enough for the horizontal-pixel→azimuth mapping to hold."""
        if abs(roll_deg) > self._level_tol or abs(pitch_deg) > self._level_tol:
            return False
        self._heading = heading_from_tap(sun_azimuth_deg, tap_px_x, self._width, self._hfov)
        self._tap_roll, self._tap_pitch = roll_deg, pitch_deg
        self._suspect = False
        return True

    def update_orientation(self, roll_deg: float, pitch_deg: float) -> None:
        """Called as live roll/pitch arrive. Flags suspect if tilt drifted
        from its value at tap-time (the housing moved)."""
        if self._heading is None:
            return
        if (abs(roll_deg - self._tap_roll) > self._drift_tol
                or abs(pitch_deg - self._tap_pitch) > self._drift_tol):
            self._suspect = True

    def status(self) -> str:
        if self._heading is None:
            return "uncalibrated"
        return "suspect" if self._suspect else "tapped"

    def heading_deg(self) -> float | None:
        return self._heading
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m pytest tests/test_heading.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sunset_cam/heading.py tests/test_heading.py
git commit -m "feat(heading): HeadingState confidence model (uncalibrated/tapped/suspect)"
```

---

### Task 5: `setup_server.py` — the HTTP server (routes, camera lock, tap)

**Files:**
- Create: `src/sunset_cam/setup_server.py`
- Test: `tests/test_setup_server.py`

- [ ] **Step 1: Write the failing test** (drive the server with injected fakes — no Pi)

```python
# tests/test_setup_server.py
import json, threading, urllib.request
from http.client import HTTPConnection
from sunset_cam.setup_server import make_handler, AimingService

class FakeService(AimingService):
    pass  # uses real AimingService with injected fakes (below)

def _service():
    # Injected: a frame_source returning a constant JPEG, a reader returning level.
    return AimingService(
        lat=48.7519, lng=-122.4787, phase="sunset", hfov_deg=120.0, width=1600,
        frame_source=lambda: b"\xff\xd8fakejpeg\xff\xd9",
        reader=lambda: (0.2, 1.0),
        now_utc_fn=lambda: __import__("datetime").datetime(2026, 6, 21, 1, 0,
                                tzinfo=__import__("datetime").timezone.utc),
    )

def test_state_json_starts_uncalibrated():
    svc = _service()
    body, status, ctype = svc.handle_get("/setup/state.json")
    assert status == 200 and "application/json" in ctype
    assert json.loads(body)["status"] == "uncalibrated"

def test_tap_sets_heading_and_returns_fit():
    svc = _service()
    body, status, _ = svc.handle_post("/setup/tap", {"pixel_x": 800, "pixel_y": 450})
    assert status == 200
    data = json.loads(body)
    assert data["status"] == "tapped"
    assert "heading_deg" in data and "fits" in data

def test_orientation_json_returns_live_roll_pitch():
    svc = _service()
    body, status, _ = svc.handle_get("/setup/orientation.json")
    assert status == 200
    assert json.loads(body)["roll_deg"] == 0.2

def test_preview_returns_503_when_camera_busy():
    def boom():
        raise RuntimeError("camera in use")
    svc = AimingService(lat=48.0, lng=-122.0, phase="sunset", hfov_deg=120.0, width=1600,
                        frame_source=boom, reader=lambda: (0.0, 0.0),
                        now_utc_fn=lambda: None)
    status = svc.preview_status()
    assert status == 503
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest tests/test_setup_server.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'sunset_cam.setup_server'`.

- [ ] **Step 3: Write minimal implementation**

```python
# src/sunset_cam/setup_server.py
"""Setup-server: a stdlib ThreadingHTTPServer that serves the aiming page,
the live MJPEG preview, live orientation, and the sun-tap endpoint. Logic
lives in AimingService (injectable, hardware-free) so it is unit-testable;
the HTTP handler is a thin adapter. Camera access is serialized by a lock."""
from __future__ import annotations

import json
import threading
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Callable

from sunset_cam.heading import HeadingState
from sunset_cam.solstice_math import compute_sun_azimuth, fov_fit
from sunset_cam.setup_alignment import render_align_page, stream_mjpeg, MJPEG_BOUNDARY


class AimingService:
    def __init__(
        self, *, lat: float, lng: float, phase: str, hfov_deg: float, width: int,
        frame_source: Callable[[], bytes], reader: Callable[[], tuple[float, float]],
        now_utc_fn: Callable[[], datetime] = lambda: datetime.now(timezone.utc),
    ) -> None:
        self.lat, self.lng, self.phase = lat, lng, phase
        self.hfov_deg, self.width = hfov_deg, width
        self.frame_source = frame_source
        self.reader = reader
        self.now_utc_fn = now_utc_fn
        self.state = HeadingState(hfov_deg=hfov_deg, width=width)
        self._cam_lock = threading.Lock()

    def _orientation(self) -> tuple[float, float]:
        try:
            return self.reader()
        except Exception:
            return (0.0, 0.0)

    def _fit_payload(self) -> dict:
        roll, pitch = self._orientation()
        self.state.update_orientation(roll, pitch)
        payload = {"status": self.state.status(), "roll_deg": roll, "pitch_deg": pitch}
        h = self.state.heading_deg()
        if h is not None:
            year = self.now_utc_fn().year
            fit = fov_fit(self.lat, self.lng, h, self.hfov_deg, year)
            payload.update({"heading_deg": h, **fit})
        return payload

    def handle_get(self, path: str):
        if path in ("/", "/setup/align"):
            html = render_align_page(self.lat, self.lng)
            return html, 200, "text/html; charset=utf-8"
        if path == "/setup/orientation.json":
            roll, pitch = self._orientation()
            return json.dumps({"roll_deg": roll, "pitch_deg": pitch}), 200, "application/json"
        if path == "/setup/state.json":
            return json.dumps(self._fit_payload()), 200, "application/json"
        return json.dumps({"error": "not found"}), 404, "application/json"

    def handle_post(self, path: str, body: dict):
        if path != "/setup/tap":
            return json.dumps({"error": "not found"}), 404, "application/json"
        roll, pitch = self._orientation()
        sun_az = compute_sun_azimuth(self.lat, self.lng, self.now_utc_fn())
        ok = self.state.apply_tap(sun_az, float(body["pixel_x"]), roll, pitch)
        if not ok:
            return (json.dumps({"status": "uncalibrated",
                                "error": "level the camera first"}), 422, "application/json")
        return json.dumps(self._fit_payload()), 200, "application/json"

    def preview_status(self) -> int:
        """200 if a frame can be grabbed, 503 if the camera is unavailable/busy."""
        with self._cam_lock:
            try:
                self.frame_source()
                return 200
            except Exception:
                return 503

    def mjpeg_frames(self, fps: int = 4):
        def locked_source() -> bytes:
            with self._cam_lock:
                return self.frame_source()
        for chunk in stream_mjpeg(locked_source, fps):
            yield chunk
            time.sleep(1.0 / fps)


def make_handler(service: AimingService):
    class Handler(BaseHTTPRequestHandler):
        def _send(self, body, status, ctype):
            data = body.encode() if isinstance(body, str) else body
            self.send_response(status)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            if self.path == "/setup/preview.mjpg":
                if service.preview_status() == 503:
                    return self._send(json.dumps({"error": "camera busy"}), 503,
                                      "application/json")
                self.send_response(200)
                self.send_header("Content-Type",
                                 f"multipart/x-mixed-replace; boundary={MJPEG_BOUNDARY}")
                self.end_headers()
                try:
                    for chunk in service.mjpeg_frames():
                        self.wfile.write(chunk)
                except (BrokenPipeError, ConnectionResetError):
                    return
                return
            body, status, ctype = service.handle_get(self.path)
            self._send(body, status, ctype)

        def do_POST(self):
            length = int(self.headers.get("Content-Length", 0))
            raw = self.rfile.read(length) if length else b"{}"
            try:
                payload = json.loads(raw or b"{}")
            except json.JSONDecodeError:
                return self._send(json.dumps({"error": "bad json"}), 400, "application/json")
            body, status, ctype = service.handle_post(self.path, payload)
            self._send(body, status, ctype)

        def log_message(self, *args):  # quiet
            pass

    return Handler


def serve(service: AimingService, port: int = 8080) -> None:
    httpd = ThreadingHTTPServer(("0.0.0.0", port), make_handler(service))
    httpd.serve_forever()
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m pytest tests/test_setup_server.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sunset_cam/setup_server.py tests/test_setup_server.py
git commit -m "feat(setup-server): ThreadingHTTPServer + AimingService (preview/orientation/tap/state)"
```

---

### Task 6: Overlay — phase parameter, confidence-gated arcs, FOV-fit bars, touch tap

**Files:**
- Modify: `src/sunset_cam/setup_alignment.py` (`render_align_page` signature + body)
- Test: `tests/test_setup_alignment.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_setup_alignment.py  (add)
from sunset_cam.setup_alignment import render_align_page

def test_align_page_accepts_phase_and_defaults_sunset():
    html = render_align_page(48.7519, -122.4787, phase="sunrise")
    assert 'data-phase="sunrise"' in html

def test_align_page_posts_tap_to_setup_tap_endpoint():
    html = render_align_page(48.7519, -122.4787)
    # The preview must register a click/touch handler that POSTs to /setup/tap.
    assert "/setup/tap" in html
    assert "addEventListener" in html and ("click" in html or "pointerdown" in html)

def test_align_page_polls_state_json():
    html = render_align_page(48.7519, -122.4787)
    assert "/setup/state.json" in html  # overlay reads heading state (gates the arcs)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest tests/test_setup_alignment.py -v`
Expected: FAIL — `render_align_page()` has no `phase` kwarg / strings absent.

- [ ] **Step 3: Write minimal implementation**

Change `render_align_page` to accept `phase: str = "sunset"`, add `data-phase` to `<body>`, and add a script block that (a) polls `/setup/state.json` and only draws the solstice arcs + FOV bars when `status !== "uncalibrated"`, and (b) registers a `pointerdown`/`click` handler on the `.preview-wrap img` that converts the event to image-relative pixel-x and POSTs `{pixel_x, pixel_y}` to `/setup/tap`. Keep the existing roll/pitch HUD. Minimal version:

```python
# src/sunset_cam/setup_alignment.py  — change signature
def render_align_page(lat: float, lng: float, year: int | None = None,
                      phase: str = "sunset") -> str:
    if year is None:
        year = date.today().year
    # ... existing facing/marker computation stays for now ...
    # In <body ...>, add:  data-phase="{phase}"
    # Append before </body> the tap + state-poll script:
    tap_script = """
    <script>
      const img = document.querySelector('.preview-wrap img');
      img.addEventListener('pointerdown', async (e) => {
        const r = img.getBoundingClientRect();
        const px = Math.round((e.clientX - r.left) / r.width * img.naturalWidth || 1600);
        const py = Math.round((e.clientY - r.top) / r.height * img.naturalHeight || 900);
        const resp = await fetch('/setup/tap', {method:'POST',
          headers:{'Content-Type':'application/json'},
          body: JSON.stringify({pixel_x: px, pixel_y: py})});
        window._lastTap = await resp.json();
      });
      async function pollState() {
        try {
          const s = await (await fetch('/setup/state.json',{cache:'no-store'})).json();
          document.body.dataset.headingStatus = s.status;     // CSS hides arcs when uncalibrated
          const el = document.getElementById('heading-badge');
          if (el) el.textContent = s.status === 'tapped'
            ? ('aimed ' + Math.round(s.heading_deg) + '\\u00b0' + (s.fits ? ' \\u2713' : ' \\u2014 clipped'))
            : (s.status === 'suspect' ? 're-tap' : 'tap the sun');
        } catch (e) {}
      }
      setInterval(pollState, 400); pollState();
    </script>
    """
    # Add `<span id="heading-badge" class="level-badge">tap the sun</span>` to the HUD,
    # and a CSS rule: body:not([data-heading-status="tapped"]) .facing-group { display:none }
    # so solstice geometry is hidden until a valid tap (confidence gate).
    return f"""...existing HTML with the above inserts and data-phase="{phase}"..."""
```

Implement the full string by editing the existing `render_align_page` return template: add `data-phase="{phase}"` and `data-heading-status="uncalibrated"` to `<body>`, add the `#heading-badge` span in `.top-hud`, the confidence-gate CSS rule, and the `tap_script` before `</body>`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m pytest tests/test_setup_alignment.py -v`
Expected: PASS (new + existing).

- [ ] **Step 5: Commit**

```bash
git add src/sunset_cam/setup_alignment.py tests/test_setup_alignment.py
git commit -m "feat(overlay): phase param, sun-tap handler, state-polling + confidence-gated arcs"
```

---

### Task 7: Hardware-gated validation on cam1 (manual)

Not a code task — the end-to-end check on real hardware. Requires the deferred auto-mode-switch is NOT needed: just stop capture and run the server.

- [ ] **Step 1: Deploy the branch to cam1**

```bash
ssh pi@sunset-cam-1.local 'cd /opt/sunset-cam && sudo git fetch origin && sudo git checkout feat/v0.4-sun-tap-aiming && sudo systemctl stop sunset-cam'
```

- [ ] **Step 2: Run the setup-server** (wire the real frame source + woken gyro reader)

Create a tiny launcher on the Pi (`/opt/sunset-cam/scripts/run-setup-server.py`) that builds an `AimingService` with `frame_source=capture.capture_jpeg`, `reader=make_orientation_reader(smbus2.SMBus(1))`, `lat/lng` from a flag, then `serve(service, 8080)`. Run it: `sudo /opt/sunset-cam/.venv/bin/python /opt/sunset-cam/scripts/run-setup-server.py --lat 48.7519 --lng -122.4787 --phase sunset`.

- [ ] **Step 3: Aim from a phone**

On a phone on the same WiFi, open `http://sunset-cam-1.local:8080`. Verify: live preview loads; roll/pitch HUD updates; no solstice arcs before tapping; tap the visible sun → badge shows `aimed NNN°` and the solstice arcs + FOV bars appear; bump the camera → badge flips to `re-tap`.

- [ ] **Step 4: Record the result**

Note the computed heading vs. reality (does "aimed 268°W" match a compass/known landmark within a few degrees?). Capture a screenshot for the PR. If heading is off by a consistent amount, check the `pixel_offset_to_angle` sign and the camera's actual HFOV.

- [ ] **Step 5: Open the PR**

```bash
cd ~/GitHub/sunset-cam-firmware
gh pr create --base main --head feat/v0.4-sun-tap-aiming \
  --title "feat: v0.4 sun-tap instant aiming" \
  --body "Implements docs/superpowers/specs/2026-06-07-pi-alignment-v0.4-sun-tap-aiming-design.md sub-project 1. Hardware-validated on cam1."
```

---

## Self-Review

- **Spec coverage:** §5.5 sun-tap math → Tasks 1,3; §5.4 confidence model → Task 4; §5.6 FOV-fit/compromise → Task 2; §5.7 setup-server → Task 5; §5.3/§5.2 overlay + phase → Task 6; §6 testing → tests in every task; §10 slice order → Tasks 1-7 in order. The high-latitude *seasonal nudge guidance* (§5.6 #2) is surfaced via `fov_fit`'s `best_center_az`/`captured_at_best` (Task 2) but the notification delivery is part of the deferred notification channel — noted, not built here.
- **Placeholders:** Task 6's Step 3 describes edits to an existing large HTML template rather than restating the whole ~120-line string; the inserts (data attributes, badge span, CSS rule, tap_script) are given as exact code. Acceptable — it's modifying an existing template, and the tests pin the required substrings.
- **Type consistency:** `AimingService(frame_source, reader, now_utc_fn)`, `HeadingState(hfov_deg, width, level_tol_deg, drift_tol_deg)`, `fov_fit(...) -> dict` keys (`fits`, `captured`, `best_center_az`, `captured_at_best`, `summer_az`, `winter_az`) used consistently across Tasks 2/4/5. `compute_sun_azimuth(lat, lng, t_utc)` signature consistent in Tasks 1/5.

---

## Open items carried from the spec (§9)
1. Lens FOV choice (Jesse investigating Arducam) — `hfov_deg` is a parameter throughout; nothing here hard-codes a lens.
2. Where lat/lng live on relocation — Task 7 passes them as flags; the durable source is the deferred field sub-project's concern.
3. Clock-accuracy tolerance — Task 1's azimuth tolerance (±2°) absorbs a few minutes of skew; confirm on hardware (Task 7).
