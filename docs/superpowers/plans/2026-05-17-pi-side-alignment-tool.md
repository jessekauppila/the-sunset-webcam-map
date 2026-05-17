# Pi-Side Alignment Tool — Implementation Plan (v0.2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the framework-agnostic Pi-side alignment-tool logic — HTML rendering, MJPEG streaming, MPU6050 IMU driver, orientation sampler thread, and server-side solstice math — with full unit-test coverage in the firmware repo, ready to be wired into spec E's setup web app whenever that lands.

**Architecture:** Three Python modules in the firmware: `setup_alignment.py` (HTML + MJPEG + orientation JSON renderers), `gyro_driver.py` (MPU6050 I2C reads), and `orientation_sampler.py` (background-thread cache of latest smoothed readings). All public functions are framework-agnostic (no Flask, no aiohttp). Solstice marker positions and sunsets-per-year counts are computed server-side and embedded in the HTML; the page itself does only one JS thing (poll the orientation JSON endpoint at 5 Hz and update the readout). The radio-toggle for facing direction (East/West/Both) is pure CSS — no JS state.

**Tech Stack:** Python 3.11+ in `sunset-cam-firmware` repo. pytest for tests. `smbus2` added as a new runtime dependency for I2C. Standard library otherwise.

**Spec:** `docs/superpowers/specs/2026-05-17-pi-side-alignment-tool-design.md` v0.2 (in the web-app repo).

**Working repo for tasks 1–10:** `/Users/jessekauppila/GitHub/sunset-cam-firmware`. Tasks 11–12 live in the web-app repo.

---

## Dependency notes

- **Spec E's setup web app does not exist yet.** All tasks produce framework-agnostic functions and modules. Wiring into a real web framework is one task in spec E's firmware plan (when it's written), not here.
- **MPU6050 hardware does not exist on the test Pi yet.** The user is acquiring units; soldering needed for non-WH Pi Zero 2 W. Tasks 3–4 are fully unit-testable with mocked I2C — they land before hardware arrives. Field verification (Task 13) gates on hardware.
- **Spec E and F docs both need short integration notes** (Task 11) so the next implementer doesn't lose the thread.

---

## File structure

| Action | Path (in `sunset-cam-firmware`) | Responsibility |
|---|---|---|
| Modify | `pyproject.toml` | add `smbus2>=0.4` runtime dep |
| Create | `src/sunset_cam/gyro_driver.py` | MPU6050 I2C reads + roll/pitch math |
| Create | `src/sunset_cam/orientation_sampler.py` | background-thread sampler + smoothing + cache |
| Create | `src/sunset_cam/solstice_math.py` | sun position + solstice azimuth + sunsets-per-year |
| Create | `src/sunset_cam/setup_alignment.py` | `render_align_page()`, `render_orientation_json()`, `stream_mjpeg()` |
| Create | `tests/test_gyro_driver.py` | unit tests w/ mocked I2C |
| Create | `tests/test_orientation_sampler.py` | unit tests w/ fake clock + injected reader |
| Create | `tests/test_solstice_math.py` | unit tests w/ known coordinates |
| Create | `tests/test_setup_alignment.py` | unit tests for the three renderers |

Each module is small (target ≤ 120 lines) and single-responsibility. No module imports a web framework. `setup_alignment.py` is the consumer of the others; the others know nothing about HTTP.

---

## Task 1: Add `smbus2` dependency

**Files:**
- Modify: `pyproject.toml`

- [ ] **Step 1: Update `pyproject.toml`**

Edit the `[project] dependencies` array to add `smbus2`:

```toml
[project]
name = "sunset-cam"
version = "0.0.1"
description = "Firmware for the sunrise/sunset custom edge cameras (Tier 0)."
requires-python = ">=3.11"
dependencies = [
  "requests>=2.31",
  "smbus2>=0.4",
]
```

- [ ] **Step 2: Install the dependency in the dev environment**

Run: `cd /Users/jessekauppila/GitHub/sunset-cam-firmware && python -m pip install -e ".[dev]"`
Expected: smbus2 installs cleanly.

- [ ] **Step 3: Verify import**

Run: `cd /Users/jessekauppila/GitHub/sunset-cam-firmware && python -c "import smbus2; print(smbus2.__version__)"`
Expected: a version string prints. No error.

- [ ] **Step 4: Commit**

```bash
cd /Users/jessekauppila/GitHub/sunset-cam-firmware
git add pyproject.toml
git commit -m "build(deps): add smbus2 for MPU6050 I2C access"
```

---

## Task 2: Create `gyro_driver.py` with `read_orientation()`

**Files:**
- Create: `src/sunset_cam/gyro_driver.py`
- Create: `tests/test_gyro_driver.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/test_gyro_driver.py`:

```python
"""Tests for the MPU6050 driver — mocked I2C inputs."""
from __future__ import annotations

import math
from sunset_cam.gyro_driver import read_orientation, accel_to_roll_pitch


def test_accel_to_roll_pitch_returns_zero_when_flat():
    # Phone flat: gravity is entirely along Z axis.
    roll, pitch = accel_to_roll_pitch(0.0, 0.0, 1.0)
    assert abs(roll) < 0.1
    assert abs(pitch) < 0.1


def test_accel_to_roll_pitch_returns_90_when_on_right_side():
    # Phone on its right side: gravity along +Y → roll = 90°.
    roll, pitch = accel_to_roll_pitch(0.0, 1.0, 0.0)
    assert abs(roll - 90.0) < 0.5


def test_accel_to_roll_pitch_returns_negative_90_when_on_left_side():
    roll, pitch = accel_to_roll_pitch(0.0, -1.0, 0.0)
    assert abs(roll - (-90.0)) < 0.5


def test_accel_to_roll_pitch_pitch_when_tilted_forward():
    # Phone tilted forward: gravity along +X → pitch ≈ -90°.
    roll, pitch = accel_to_roll_pitch(1.0, 0.0, 0.0)
    assert abs(pitch - (-90.0)) < 0.5


def test_accel_to_roll_pitch_returns_180_or_negative_180_upside_down():
    # Phone upside down: gravity along -Z. Roll wraps to ±180°.
    roll, pitch = accel_to_roll_pitch(0.0, 0.0, -1.0)
    assert abs(abs(roll) - 180.0) < 0.5


def test_read_orientation_calls_smbus_with_correct_address():
    # MPU6050 default address 0x68; accel registers start at 0x3B.
    # The driver should issue an I2C read for 6 bytes starting at 0x3B.
    calls = []

    class FakeBus:
        def read_i2c_block_data(self, addr, reg, length):
            calls.append((addr, reg, length))
            # 6 bytes of raw accel: 0x00 0x00 0x00 0x00 0x40 0x00
            # → x=0, y=0, z=16384 (=1g for ±2g full scale)
            return [0x00, 0x00, 0x00, 0x00, 0x40, 0x00]

    bus = FakeBus()
    roll, pitch = read_orientation(bus)

    assert calls == [(0x68, 0x3B, 6)]
    assert abs(roll) < 0.1
    assert abs(pitch) < 0.1


def test_read_orientation_handles_negative_raw_values():
    # Two's-complement: raw=0xFFFF means -1, raw=0xC000 = -16384 (=-1g).
    class FakeBus:
        def read_i2c_block_data(self, addr, reg, length):
            # x=0, y=0, z=-16384 → upside down
            return [0x00, 0x00, 0x00, 0x00, 0xC0, 0x00]

    bus = FakeBus()
    roll, pitch = read_orientation(bus)
    assert abs(abs(roll) - 180.0) < 0.5
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/jessekauppila/GitHub/sunset-cam-firmware && python -m pytest tests/test_gyro_driver.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'sunset_cam.gyro_driver'`

- [ ] **Step 3: Create the module**

Create `src/sunset_cam/gyro_driver.py`:

```python
"""MPU6050 / GY-521 6-axis IMU driver.

Reads only the accelerometer for v0.2 (roll + pitch from the gravity vector).
The gyro is on the chip but unused — it's reserved for a future sun-tap
calibration spec.

Spec: docs/superpowers/specs/2026-05-17-pi-side-alignment-tool-design.md §5.4

Wiring (Pi Zero 2 W): VCC→3.3V, GND→GND, SDA→GPIO 2, SCL→GPIO 3.
I2C bus 1, address 0x68 (default — AD0 pin tied low).
"""
from __future__ import annotations

import math
from typing import Protocol, Tuple


MPU6050_ADDR = 0x68
ACCEL_XOUT_H = 0x3B  # first byte of 6 accel registers (X H, X L, Y H, Y L, Z H, Z L)
ACCEL_FS_LSB_PER_G = 16384.0  # ±2g full-scale → 16384 LSB / g


class I2CBus(Protocol):
    """Minimal protocol matching smbus2.SMBus.read_i2c_block_data."""

    def read_i2c_block_data(self, addr: int, reg: int, length: int) -> list[int]: ...


def _u8_pair_to_i16(high: int, low: int) -> int:
    """Combine two unsigned bytes into a signed 16-bit integer (two's complement)."""
    raw = (high << 8) | low
    return raw - 0x10000 if raw & 0x8000 else raw


def accel_to_roll_pitch(ax: float, ay: float, az: float) -> Tuple[float, float]:
    """Convert accelerometer reading (in g, any consistent unit) to roll + pitch degrees.

    Pure function — no I/O. Uses the standard atan2-based gravity-vector formulas:
        roll  = atan2(ay, sqrt(ax² + az²))     — rotation around forward axis
        pitch = atan2(-ax, sqrt(ay² + az²))    — rotation around right axis
    Yaw is NOT recoverable from accelerometer alone (no horizontal reference).
    """
    roll_rad = math.atan2(ay, math.sqrt(ax * ax + az * az))
    pitch_rad = math.atan2(-ax, math.sqrt(ay * ay + az * az))
    return math.degrees(roll_rad), math.degrees(pitch_rad)


def read_orientation(bus: I2CBus, addr: int = MPU6050_ADDR) -> Tuple[float, float]:
    """Read accelerometer once over I2C and return (roll_deg, pitch_deg)."""
    raw = bus.read_i2c_block_data(addr, ACCEL_XOUT_H, 6)
    ax_lsb = _u8_pair_to_i16(raw[0], raw[1])
    ay_lsb = _u8_pair_to_i16(raw[2], raw[3])
    az_lsb = _u8_pair_to_i16(raw[4], raw[5])

    ax_g = ax_lsb / ACCEL_FS_LSB_PER_G
    ay_g = ay_lsb / ACCEL_FS_LSB_PER_G
    az_g = az_lsb / ACCEL_FS_LSB_PER_G

    return accel_to_roll_pitch(ax_g, ay_g, az_g)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/jessekauppila/GitHub/sunset-cam-firmware && python -m pytest tests/test_gyro_driver.py -v`
Expected: 7/7 PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/jessekauppila/GitHub/sunset-cam-firmware
git add src/sunset_cam/gyro_driver.py tests/test_gyro_driver.py
git commit -m "feat(gyro): MPU6050 driver with read_orientation()"
```

---

## Task 3: Create `orientation_sampler.py` with a background-thread cache

**Files:**
- Create: `src/sunset_cam/orientation_sampler.py`
- Create: `tests/test_orientation_sampler.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/test_orientation_sampler.py`:

```python
"""Tests for the orientation sampler — uses an injected reader function
plus a fake clock to verify smoothing math without real I2C or real time."""
from __future__ import annotations

import time
from sunset_cam.orientation_sampler import OrientationSampler


def test_initial_sample_is_none():
    sampler = OrientationSampler(reader=lambda: (0.0, 0.0))
    assert sampler.latest() is None


def test_sample_once_caches_the_value():
    sampler = OrientationSampler(reader=lambda: (1.0, 2.0))
    sampler.sample_once()
    latest = sampler.latest()
    assert latest is not None
    assert latest["roll_deg"] == 1.0
    assert latest["pitch_deg"] == 2.0
    assert "sampled_at" in latest


def test_smoothing_with_default_alpha():
    # alpha = 0.3 → first sample is the seed; second is 0.3*new + 0.7*prev
    values = iter([(10.0, 0.0), (20.0, 0.0)])
    sampler = OrientationSampler(reader=lambda: next(values), alpha=0.3)

    sampler.sample_once()
    assert abs(sampler.latest()["roll_deg"] - 10.0) < 0.001

    sampler.sample_once()
    expected = 0.3 * 20.0 + 0.7 * 10.0  # = 13.0
    assert abs(sampler.latest()["roll_deg"] - expected) < 0.001


def test_sample_once_handles_reader_exception():
    # If the reader raises (e.g., I2C glitch), the cache stays at its
    # previous value rather than corrupting to None.
    sampler = OrientationSampler(reader=lambda: (5.0, 6.0))
    sampler.sample_once()
    sampled_before = sampler.latest()

    def broken_reader() -> tuple[float, float]:
        raise OSError("simulated I2C glitch")

    sampler._reader = broken_reader
    sampler.sample_once()  # Should not raise
    assert sampler.latest() == sampled_before


def test_start_stop_runs_sampling_loop():
    # Background thread samples a few times then we stop it.
    count = {"n": 0}

    def counting_reader() -> tuple[float, float]:
        count["n"] += 1
        return (0.0, 0.0)

    sampler = OrientationSampler(reader=counting_reader, hz=50)
    sampler.start()
    time.sleep(0.1)  # ~5 samples at 50 Hz
    sampler.stop()
    assert count["n"] >= 2
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/jessekauppila/GitHub/sunset-cam-firmware && python -m pytest tests/test_orientation_sampler.py -v`
Expected: FAIL with `ModuleNotFoundError`.

- [ ] **Step 3: Create the module**

Create `src/sunset_cam/orientation_sampler.py`:

```python
"""Background-thread orientation sampler.

Polls an injected reader callable at a fixed Hz, applies exponential
smoothing, caches the latest result for synchronous access via ``latest()``.

The reader is injected (not hard-coded to MPU6050) so the sampler can be
unit-tested with a deterministic fake reader and so future hardware ports
(ESP32, different IMU) don't need to fork this module.
"""
from __future__ import annotations

import threading
import time
from datetime import datetime, timezone
from typing import Callable, Optional, Tuple


ReadingTuple = Tuple[float, float]  # (roll_deg, pitch_deg)


class OrientationSampler:
    """Polls a reader callable in a daemon thread; caches latest smoothed reading."""

    def __init__(
        self,
        reader: Callable[[], ReadingTuple],
        alpha: float = 0.3,
        hz: int = 10,
    ) -> None:
        self._reader = reader
        self._alpha = alpha
        self._period_s = 1.0 / hz
        self._smoothed: Optional[ReadingTuple] = None
        self._sampled_at: Optional[str] = None
        self._thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()

    def sample_once(self) -> None:
        """Take one reading and update the cache (synchronous; for tests)."""
        try:
            raw = self._reader()
        except Exception:
            return  # keep previous cache

        if self._smoothed is None:
            self._smoothed = raw
        else:
            r_prev, p_prev = self._smoothed
            r_new, p_new = raw
            self._smoothed = (
                self._alpha * r_new + (1.0 - self._alpha) * r_prev,
                self._alpha * p_new + (1.0 - self._alpha) * p_prev,
            )
        self._sampled_at = datetime.now(timezone.utc).isoformat()

    def latest(self) -> Optional[dict]:
        """Return the latest cached reading as a JSON-serializable dict, or None."""
        if self._smoothed is None:
            return None
        return {
            "roll_deg": self._smoothed[0],
            "pitch_deg": self._smoothed[1],
            "sampled_at": self._sampled_at,
        }

    def start(self) -> None:
        if self._thread is not None and self._thread.is_alive():
            return
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop_event.set()
        if self._thread is not None:
            self._thread.join(timeout=1.0)
            self._thread = None

    def _run(self) -> None:
        while not self._stop_event.is_set():
            self.sample_once()
            self._stop_event.wait(timeout=self._period_s)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/jessekauppila/GitHub/sunset-cam-firmware && python -m pytest tests/test_orientation_sampler.py -v`
Expected: 5/5 PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/jessekauppila/GitHub/sunset-cam-firmware
git add src/sunset_cam/orientation_sampler.py tests/test_orientation_sampler.py
git commit -m "feat(orientation): background sampler with smoothing + cache"
```

---

## Task 4: Create `solstice_math.py` (server-side solstice + sunsets-per-year math)

**Files:**
- Create: `src/sunset_cam/solstice_math.py`
- Create: `tests/test_solstice_math.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/test_solstice_math.py`:

```python
"""Tests for the solstice / sun-azimuth math.

Uses NOAA-tabulated solstice sunset azimuths to validate the formula at a
known latitude (Bellingham, WA: 48.7519°N).
"""
from __future__ import annotations

from sunset_cam.solstice_math import (
    sunset_azimuth_for_day,
    az_to_pixel,
    count_sunsets_in_fov,
)


# Bellingham, WA
BELLINGHAM_LAT = 48.7519
BELLINGHAM_LNG = -122.4787


def test_sunset_azimuth_june_solstice_bellingham_is_northwest():
    # June 21 sunset at 48.75°N is roughly 302° (just N of W).
    az = sunset_azimuth_for_day(BELLINGHAM_LAT, 2026, 6, 21)
    assert 295.0 <= az <= 310.0


def test_sunset_azimuth_december_solstice_bellingham_is_southwest():
    # Dec 21 sunset at 48.75°N is roughly 240° (S of W).
    az = sunset_azimuth_for_day(BELLINGHAM_LAT, 2026, 12, 21)
    assert 235.0 <= az <= 250.0


def test_sunset_azimuth_equinox_bellingham_is_near_due_west():
    # Mar/Sep equinox sunset is always ~270° (within ~1°).
    az_sep = sunset_azimuth_for_day(BELLINGHAM_LAT, 2026, 9, 22)
    assert 268.0 <= az_sep <= 272.0


def test_az_to_pixel_center_when_target_equals_camera_center():
    # If the target azimuth equals the camera's center, it maps to screen center.
    px = az_to_pixel(az_deg=270.0, center_az=270.0, fov_deg=102.0, screen_width=1600)
    assert abs(px - 800.0) < 1.0


def test_az_to_pixel_wraps_signed_delta_correctly():
    # Camera at 350°, target at 10°: signed delta should be +20°, not -340°.
    px = az_to_pixel(az_deg=10.0, center_az=350.0, fov_deg=102.0, screen_width=1600)
    # +20°/102° of full width → 800 + 1600*(20/102) ≈ 1114
    assert 1100 <= px <= 1130


def test_count_sunsets_in_fov_bellingham_west_returns_full_year():
    # West-facing camera with 102° FOV centered on 270° covers
    # roughly 219°–321°. Bellingham's sunset azimuth range over a year
    # is roughly 240°–302°, fully inside the FOV → 365 days.
    count = count_sunsets_in_fov(
        BELLINGHAM_LAT, BELLINGHAM_LNG,
        center_az=270.0, fov_deg=102.0, year=2026,
    )
    assert count == 365


def test_count_sunsets_in_fov_bellingham_north_returns_few():
    # North-facing camera misses every sunset. Expect 0.
    count = count_sunsets_in_fov(
        BELLINGHAM_LAT, BELLINGHAM_LNG,
        center_az=0.0, fov_deg=60.0, year=2026,
    )
    assert count == 0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/jessekauppila/GitHub/sunset-cam-firmware && python -m pytest tests/test_solstice_math.py -v`
Expected: FAIL with `ModuleNotFoundError`.

- [ ] **Step 3: Create the module**

Create `src/sunset_cam/solstice_math.py`:

```python
"""Sun azimuth + sunsets-per-year computation, server-side.

Pure math, no I/O, no external deps beyond stdlib. Uses NOAA's solar
position approximation good to roughly ±0.5° for civil purposes — accurate
enough for placement advice; not survey-grade.

References:
- NOAA Solar Calculator: https://gml.noaa.gov/grad/solcalc/
- Equations (Spencer 1971 / Reda+Andreas refined) for declination + equation of time
"""
from __future__ import annotations

import math
from datetime import date, datetime, timedelta, timezone
from typing import Iterable


def _julian_day(year: int, month: int, day: int) -> float:
    if month <= 2:
        year -= 1
        month += 12
    a = year // 100
    b = 2 - a + a // 4
    return (
        math.floor(365.25 * (year + 4716))
        + math.floor(30.6001 * (month + 1))
        + day + b - 1524.5
    )


def _solar_declination_deg(jd: float) -> float:
    """Approximate solar declination, NOAA Spencer formula."""
    n = jd - 2451545.0  # days since J2000.0
    g_rad = math.radians((357.528 + 0.9856003 * n) % 360.0)
    lam_rad = math.radians(
        (280.460 + 0.9856474 * n + 1.915 * math.sin(g_rad) + 0.020 * math.sin(2 * g_rad))
        % 360.0
    )
    eps_rad = math.radians(23.439 - 0.0000004 * n)
    decl_rad = math.asin(math.sin(eps_rad) * math.sin(lam_rad))
    return math.degrees(decl_rad)


def sunset_azimuth_for_day(lat_deg: float, year: int, month: int, day: int) -> float:
    """Approximate azimuth (degrees from North, clockwise) of the sun at sunset
    on the given date at the given latitude.

    Uses the closed-form solution from Duffie & Beckman (Solar Engineering of
    Thermal Processes), §1.6: at sunset, the hour angle is the sunset hour
    angle ωs satisfying cos(ωs) = -tan(φ)·tan(δ), and the azimuth (south=0
    convention) is given by an arccosine of (sin(δ)·cos(φ) − cos(δ)·sin(φ)·cos(ωs))
    over -1. We then convert to north=0 convention.
    """
    jd = _julian_day(year, month, day) + 0.5  # noon UT
    decl_deg = _solar_declination_deg(jd)
    decl_rad = math.radians(decl_deg)
    lat_rad = math.radians(lat_deg)

    # Sunset hour angle ωs (radians); guard against polar day/night where
    # |tan(φ)·tan(δ)| > 1.
    cos_ws = -math.tan(lat_rad) * math.tan(decl_rad)
    if cos_ws >= 1.0:
        cos_ws = 1.0  # polar night — no sunset; degenerate
    elif cos_ws <= -1.0:
        cos_ws = -1.0  # polar day
    ws_rad = math.acos(cos_ws)

    # Azimuth in south=0 west=positive convention
    cos_az = (
        (math.sin(decl_rad) * math.cos(lat_rad) - math.cos(decl_rad) * math.sin(lat_rad) * math.cos(ws_rad))
        / max(1e-9, math.cos(math.asin(
            math.sin(lat_rad) * math.sin(decl_rad)
            + math.cos(lat_rad) * math.cos(decl_rad) * math.cos(ws_rad)
        )))
    )
    cos_az = max(-1.0, min(1.0, cos_az))
    az_from_south_rad = math.acos(cos_az)
    # Sunset is always toward the west, so south=0 west=positive → az is positive.
    az_from_south_deg = math.degrees(az_from_south_rad)
    # Convert to compass (north=0, clockwise): compass = 180 + az_from_south for west
    return (180.0 + az_from_south_deg) % 360.0


def az_to_pixel(
    az_deg: float, center_az: float, fov_deg: float, screen_width: int
) -> float:
    """Map an azimuth to a horizontal pixel coordinate on the preview frame."""
    # Signed delta in [-180, 180]
    delta = ((az_deg - center_az + 540.0) % 360.0) - 180.0
    return screen_width * (0.5 + delta / fov_deg)


def count_sunsets_in_fov(
    lat_deg: float, lng_deg: float,
    center_az: float, fov_deg: float,
    year: int,
) -> int:
    """Count days in the given year where the sunset azimuth at (lat,lng)
    falls within the camera's horizontal field-of-view centered on center_az."""
    half_fov = fov_deg / 2.0
    count = 0
    d = date(year, 1, 1)
    end = date(year, 12, 31)
    while d <= end:
        az = sunset_azimuth_for_day(lat_deg, d.year, d.month, d.day)
        delta = ((az - center_az + 540.0) % 360.0) - 180.0
        if -half_fov <= delta <= half_fov:
            count += 1
        d += timedelta(days=1)
    return count
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/jessekauppila/GitHub/sunset-cam-firmware && python -m pytest tests/test_solstice_math.py -v`
Expected: 7/7 PASS.

If the Bellingham June/December solstice tests fail by a few degrees, that's a real signal — the closed-form formula above can be off by 2–3° at high latitudes. Acceptable for v1; tighten later if field data demands.

- [ ] **Step 5: Commit**

```bash
cd /Users/jessekauppila/GitHub/sunset-cam-firmware
git add src/sunset_cam/solstice_math.py tests/test_solstice_math.py
git commit -m "feat(solstice): sun azimuth + sunsets-per-year math"
```

---

## Task 5: Create `setup_alignment.py` with `render_align_page()` (basic page, no live data yet)

**Files:**
- Create: `src/sunset_cam/setup_alignment.py`
- Create: `tests/test_setup_alignment.py`

This task lands the static page skeleton. Tasks 6–8 layer on the live readout, facing selector, and counter.

- [ ] **Step 1: Write the failing tests**

Create `tests/test_setup_alignment.py`:

```python
"""Tests for setup_alignment.py — the alignment-page HTML renderer."""
from __future__ import annotations

from sunset_cam.setup_alignment import render_align_page


def test_render_align_page_returns_string():
    html = render_align_page(lat=48.75, lng=-122.48)
    assert isinstance(html, str)
    assert html.startswith("<!doctype html>")


def test_render_align_page_embeds_preview_image_src():
    html = render_align_page(lat=48.75, lng=-122.48)
    assert 'src="/setup/preview.mjpg"' in html


def test_render_align_page_has_horizon_line_at_center():
    html = render_align_page(lat=48.75, lng=-122.48)
    assert '<line' in html
    assert 'y1="450"' in html and 'y2="450"' in html
    assert 'stroke-dasharray' in html


def test_render_align_page_has_up_label():
    html = render_align_page(lat=48.75, lng=-122.48)
    assert "UP" in html
    assert ("↑" in html) or ("&uarr;" in html)


def test_render_align_page_embeds_coordinates_in_data_attrs():
    # lat/lng should be embedded so client-side JS (added in Task 6)
    # can read them. v1: just data-attributes on the root element.
    html = render_align_page(lat=48.75, lng=-122.48)
    assert 'data-lat="48.75"' in html
    assert 'data-lng="-122.48"' in html
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/jessekauppila/GitHub/sunset-cam-firmware && python -m pytest tests/test_setup_alignment.py -v`
Expected: FAIL with `ModuleNotFoundError`.

- [ ] **Step 3: Create the module**

Create `src/sunset_cam/setup_alignment.py`:

```python
"""Pi-side alignment tool: framework-agnostic page + stream renderers.

Public API:
- ``render_align_page(lat, lng)`` → HTML for ``/setup/align``
- ``render_orientation_json(sampler)`` → JSON for ``/setup/orientation.json``
  (added in Task 7)
- ``stream_mjpeg(frame_source, fps)`` → multipart MJPEG bytes for
  ``/setup/preview.mjpg`` (added in Task 9)

Spec: docs/superpowers/specs/2026-05-17-pi-side-alignment-tool-design.md v0.2
"""
from __future__ import annotations


def render_align_page(lat: float, lng: float) -> str:
    """Render the alignment page HTML. Embeds the camera's lat/lng as
    data-attributes for use by client-side scripts (added in Task 6)."""
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Align your camera</title>
  <style>
    body {{ background: #000; color: #fff; font: 14px system-ui, sans-serif; margin: 0; padding: 0; }}
    .preview-wrap {{ position: relative; width: 100%; max-width: 100vw; aspect-ratio: 16/9; margin: 0 auto; }}
    .preview-wrap img {{ width: 100%; display: block; }}
    .overlay {{ position: absolute; inset: 0; pointer-events: none; }}
    .instructions {{ padding: 16px 20px; line-height: 1.55; max-width: 560px; margin: 0 auto; }}
    .instructions ol {{ padding-left: 1.2em; }}
  </style>
</head>
<body data-lat="{lat}" data-lng="{lng}">
  <div class="preview-wrap">
    <img src="/setup/preview.mjpg" alt="camera preview" />
    <svg class="overlay" viewBox="0 0 1600 900" preserveAspectRatio="none">
      <line x1="0" y1="450" x2="1600" y2="450"
            stroke="#ffcc66" stroke-width="2" stroke-dasharray="12 6" opacity="0.85" />
      <text x="800" y="60" fill="#ffcc66" font-size="36" text-anchor="middle"
            font-family="system-ui, sans-serif">&uarr; UP</text>
    </svg>
  </div>
  <div class="instructions">
    <p>Rotate the camera housing until:</p>
    <ol>
      <li>The real horizon lines up with the dashed line.</li>
      <li>The &uarr; on screen points the same direction as the &uarr; drawn on the housing.</li>
    </ol>
    <p>When both match, mount the camera in place. Then close this tab and return to setup.</p>
  </div>
</body>
</html>
"""
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/jessekauppila/GitHub/sunset-cam-firmware && python -m pytest tests/test_setup_alignment.py -v`
Expected: 5/5 PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/jessekauppila/GitHub/sunset-cam-firmware
git add src/sunset_cam/setup_alignment.py tests/test_setup_alignment.py
git commit -m "feat(setup-align): render_align_page() with horizon + UP marker"
```

---

## Task 6: Extend `render_align_page()` with the live roll/pitch readout (polling JS)

**Files:**
- Modify: `src/sunset_cam/setup_alignment.py`
- Modify: `tests/test_setup_alignment.py`

- [ ] **Step 1: Add the failing tests**

Append to `tests/test_setup_alignment.py`:

```python
def test_render_align_page_includes_orientation_readout_element():
    html = render_align_page(lat=48.75, lng=-122.48)
    # A specific element id the polling JS will update with the latest roll.
    assert 'id="roll-readout"' in html
    assert 'id="pitch-readout"' in html


def test_render_align_page_includes_polling_script_targeting_orientation_endpoint():
    html = render_align_page(lat=48.75, lng=-122.48)
    # The script must fetch /setup/orientation.json on an interval.
    assert "/setup/orientation.json" in html
    assert "setInterval" in html


def test_render_align_page_includes_level_badge():
    html = render_align_page(lat=48.75, lng=-122.48)
    # The badge that lights up green when |roll| < 1°.
    assert 'id="level-badge"' in html
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/jessekauppila/GitHub/sunset-cam-firmware && python -m pytest tests/test_setup_alignment.py::test_render_align_page_includes_orientation_readout_element -v`
Expected: FAIL — `'id="roll-readout"' in html` is False.

- [ ] **Step 3: Extend `render_align_page()` in `setup_alignment.py`**

Replace the function body with a version that includes the readout + polling JS:

```python
def render_align_page(lat: float, lng: float) -> str:
    """Render the alignment page HTML."""
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Align your camera</title>
  <style>
    body {{ background: #000; color: #fff; font: 14px system-ui, sans-serif; margin: 0; padding: 0; }}
    .top-hud {{ display: flex; gap: 12px; align-items: center; justify-content: center; padding: 10px 16px; background: #111; }}
    .readout {{ font-variant-numeric: tabular-nums; font-size: 16px; min-width: 80px; }}
    .level-badge {{ padding: 4px 10px; border-radius: 12px; font-size: 11px; background: #444; color: #aaa; }}
    .level-badge.ok {{ background: #265f2c; color: #d8ffd8; }}
    .preview-wrap {{ position: relative; width: 100%; max-width: 100vw; aspect-ratio: 16/9; margin: 0 auto; }}
    .preview-wrap img {{ width: 100%; display: block; }}
    .overlay {{ position: absolute; inset: 0; pointer-events: none; }}
    .instructions {{ padding: 16px 20px; line-height: 1.55; max-width: 560px; margin: 0 auto; }}
    .instructions ol {{ padding-left: 1.2em; }}
  </style>
</head>
<body data-lat="{lat}" data-lng="{lng}">
  <div class="top-hud">
    <span>roll: <span id="roll-readout" class="readout">—</span></span>
    <span>pitch: <span id="pitch-readout" class="readout">—</span></span>
    <span id="level-badge" class="level-badge">checking…</span>
  </div>
  <div class="preview-wrap">
    <img src="/setup/preview.mjpg" alt="camera preview" />
    <svg class="overlay" viewBox="0 0 1600 900" preserveAspectRatio="none">
      <line x1="0" y1="450" x2="1600" y2="450"
            stroke="#ffcc66" stroke-width="2" stroke-dasharray="12 6" opacity="0.85" />
      <text x="800" y="60" fill="#ffcc66" font-size="36" text-anchor="middle"
            font-family="system-ui, sans-serif">&uarr; UP</text>
    </svg>
  </div>
  <div class="instructions">
    <p>Rotate the camera housing until:</p>
    <ol>
      <li>The roll readout above is close to 0° and the badge shows green.</li>
      <li>The &uarr; on screen points the same direction as the &uarr; drawn on the housing.</li>
    </ol>
    <p>When both match, mount the camera in place. Then close this tab and return to setup.</p>
  </div>
  <script>
    async function pollOrientation() {{
      try {{
        const r = await fetch('/setup/orientation.json', {{ cache: 'no-store' }});
        if (!r.ok) return;
        const j = await r.json();
        if (j.roll_deg !== undefined) {{
          document.getElementById('roll-readout').textContent = j.roll_deg.toFixed(1) + '°';
        }}
        if (j.pitch_deg !== undefined) {{
          document.getElementById('pitch-readout').textContent = j.pitch_deg.toFixed(1) + '°';
        }}
        const badge = document.getElementById('level-badge');
        const level = Math.abs(j.roll_deg || 99) < 1.0 && Math.abs(j.pitch_deg || 99) < 1.0;
        badge.textContent = level ? 'level' : 'tilted';
        badge.classList.toggle('ok', level);
      }} catch (e) {{ /* swallow */ }}
    }}
    setInterval(pollOrientation, 200);
    pollOrientation();
  </script>
</body>
</html>
"""
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/jessekauppila/GitHub/sunset-cam-firmware && python -m pytest tests/test_setup_alignment.py -v`
Expected: 8/8 PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/jessekauppila/GitHub/sunset-cam-firmware
git add src/sunset_cam/setup_alignment.py tests/test_setup_alignment.py
git commit -m "feat(setup-align): live roll/pitch readout via polling JS"
```

---

## Task 7: Add `render_orientation_json()`

**Files:**
- Modify: `src/sunset_cam/setup_alignment.py`
- Modify: `tests/test_setup_alignment.py`

- [ ] **Step 1: Add the failing tests**

Append to `tests/test_setup_alignment.py`:

```python
import json
from sunset_cam.orientation_sampler import OrientationSampler
from sunset_cam.setup_alignment import render_orientation_json


def test_render_orientation_json_empty_when_sampler_has_no_reading():
    sampler = OrientationSampler(reader=lambda: (0.0, 0.0))
    body = render_orientation_json(sampler)
    parsed = json.loads(body)
    assert parsed == {}


def test_render_orientation_json_returns_latest_reading():
    sampler = OrientationSampler(reader=lambda: (1.5, 2.5))
    sampler.sample_once()
    body = render_orientation_json(sampler)
    parsed = json.loads(body)
    assert abs(parsed["roll_deg"] - 1.5) < 0.001
    assert abs(parsed["pitch_deg"] - 2.5) < 0.001
    assert "sampled_at" in parsed
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/jessekauppila/GitHub/sunset-cam-firmware && python -m pytest tests/test_setup_alignment.py::test_render_orientation_json_empty_when_sampler_has_no_reading -v`
Expected: FAIL with ImportError on `render_orientation_json`.

- [ ] **Step 3: Add `render_orientation_json()` to `setup_alignment.py`**

Append to `src/sunset_cam/setup_alignment.py`:

```python
import json
from sunset_cam.orientation_sampler import OrientationSampler


def render_orientation_json(sampler: OrientationSampler) -> str:
    """Return the latest cached reading as a JSON string. Empty object when
    the sampler has not yet captured anything (e.g., during the first 200 ms
    after startup)."""
    latest = sampler.latest()
    return json.dumps(latest if latest is not None else {})
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/jessekauppila/GitHub/sunset-cam-firmware && python -m pytest tests/test_setup_alignment.py -v`
Expected: 10/10 PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/jessekauppila/GitHub/sunset-cam-firmware
git add src/sunset_cam/setup_alignment.py tests/test_setup_alignment.py
git commit -m "feat(setup-align): render_orientation_json() exposes sampler cache"
```

---

## Task 8: Add facing selector + solstice markers + sunsets-per-year counter to the HTML

**Files:**
- Modify: `src/sunset_cam/setup_alignment.py`
- Modify: `tests/test_setup_alignment.py`

The markers and the counter are server-rendered (computed once per page-load in Python). The toggle is pure CSS via radio inputs + `:checked ~ ...` selectors — no JS state.

- [ ] **Step 1: Add the failing tests**

Append to `tests/test_setup_alignment.py`:

```python
def test_render_align_page_has_facing_selector_with_three_options():
    html = render_align_page(lat=48.75, lng=-122.48)
    # Radio inputs for east / west / both
    assert 'value="east"' in html
    assert 'value="west"' in html
    assert 'value="both"' in html


def test_render_align_page_embeds_per_facing_solstice_markers_and_counts():
    html = render_align_page(lat=48.75, lng=-122.48)
    # Each facing variant has its own marker x-positions + sunsets/year count
    # rendered into the SVG. We check that the page contains three distinct
    # sunsets-per-year values (one per facing).
    # At Bellingham 48.75°N: west covers the year (365), east covers the year (365),
    # both = 365. So a coarse check: the digit string "365" must appear ≥ 1 time
    # in the body, and the markup must contain three labelled groups.
    assert html.count('data-facing="east"') >= 1
    assert html.count('data-facing="west"') >= 1
    assert html.count('data-facing="both"') >= 1


def test_render_align_page_default_facing_is_west():
    html = render_align_page(lat=48.75, lng=-122.48)
    # West radio input is checked by default
    assert 'value="west" checked' in html or 'value="west"  checked' in html
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/jessekauppila/GitHub/sunset-cam-firmware && python -m pytest tests/test_setup_alignment.py -v -k "facing"`
Expected: 3 FAIL.

- [ ] **Step 3: Extend `render_align_page()` with the facing UI + server-computed markers + counter**

Replace the function body of `render_align_page()` with the version below. This adds:
- Server-side computation of solstice marker positions + sunsets-per-year count for each of three facings (East 90°, West 270°, Both — center at 180° with full FOV widened by adding the two halves).
- Three sets of SVG `<g>` elements, one per facing, with `data-facing` attributes.
- Three counter spans, similarly tagged.
- A `<form>` with three radio inputs that drives CSS-only visibility of the per-facing elements.

```python
from sunset_cam.solstice_math import (
    sunset_azimuth_for_day,
    az_to_pixel,
    count_sunsets_in_fov,
)
from datetime import date


FOV_DEG = 102.0          # Camera Module 3 Wide horizontal FOV
SCREEN_W = 1600          # Match SVG viewBox width
SCREEN_H = 900           # Match SVG viewBox height
HORIZON_Y = 450          # Vertical center


def _facing_data(lat: float, lng: float, year: int) -> dict:
    """Pre-compute marker positions + sunsets/year counts for each facing.

    Returns a dict like:
      {
        "east":  {"jun_x": ..., "dec_x": ..., "count": N},
        "west":  {"jun_x": ..., "dec_x": ..., "count": N},
        "both":  {"jun_x": ..., "dec_x": ..., "count": N},
      }
    """
    jun_az = sunset_azimuth_for_day(lat, year, 6, 21)
    dec_az = sunset_azimuth_for_day(lat, year, 12, 21)
    out: dict[str, dict] = {}
    for facing, center_az in (("east", 90.0), ("west", 270.0)):
        out[facing] = {
            "jun_x": az_to_pixel(jun_az, center_az, FOV_DEG, SCREEN_W),
            "dec_x": az_to_pixel(dec_az, center_az, FOV_DEG, SCREEN_W),
            "count": count_sunsets_in_fov(lat, lng, center_az, FOV_DEG, year),
        }
    # "both" = full panorama; we draw it as the same FOV but conceptually
    # the operator is informed they're covering both phases.
    out["both"] = {
        "jun_x": out["west"]["jun_x"],
        "dec_x": out["east"]["dec_x"],
        "count": min(365, out["east"]["count"] + out["west"]["count"]),
    }
    return out


def _marker_group(facing: str, data: dict) -> str:
    """Render the SVG markers + shaded wedge for one facing."""
    jx, dx = data["jun_x"], data["dec_x"]
    lo, hi = sorted((jx, dx))
    wedge = (
        f'<rect x="{lo}" y="{HORIZON_Y - 30}" '
        f'width="{hi - lo}" height="60" '
        f'fill="#ffcc66" fill-opacity="0.18" />'
    )
    j_line = (
        f'<line x1="{jx}" y1="{HORIZON_Y - 30}" x2="{jx}" y2="{HORIZON_Y + 30}" '
        f'stroke="#ffd088" stroke-width="2" stroke-dasharray="6 4" />'
    )
    d_line = (
        f'<line x1="{dx}" y1="{HORIZON_Y - 30}" x2="{dx}" y2="{HORIZON_Y + 30}" '
        f'stroke="#ffaa55" stroke-width="2" stroke-dasharray="6 4" />'
    )
    return f'<g class="facing-group" data-facing="{facing}">{wedge}{j_line}{d_line}</g>'


def render_align_page(lat: float, lng: float, year: int | None = None) -> str:
    """Render the alignment page HTML. ``year`` defaults to the current year
    for the sunsets-per-year counts."""
    if year is None:
        year = date.today().year
    facing = _facing_data(lat, lng, year)
    marker_groups = "\n".join(
        _marker_group(name, facing[name]) for name in ("east", "west", "both")
    )
    counter_spans = "\n".join(
        f'<span class="counter" data-facing="{name}">{facing[name]["count"]} sunsets/year</span>'
        for name in ("east", "west", "both")
    )

    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Align your camera</title>
  <style>
    body {{ background: #000; color: #fff; font: 14px system-ui, sans-serif; margin: 0; padding: 0; }}
    .top-hud {{ display: flex; gap: 12px; align-items: center; justify-content: center; padding: 10px 16px; background: #111; }}
    .readout {{ font-variant-numeric: tabular-nums; font-size: 16px; min-width: 80px; }}
    .level-badge {{ padding: 4px 10px; border-radius: 12px; font-size: 11px; background: #444; color: #aaa; }}
    .level-badge.ok {{ background: #265f2c; color: #d8ffd8; }}
    .preview-wrap {{ position: relative; width: 100%; max-width: 100vw; aspect-ratio: 16/9; margin: 0 auto; }}
    .preview-wrap img {{ width: 100%; display: block; }}
    .overlay {{ position: absolute; inset: 0; pointer-events: none; }}
    .facing-form {{ display: flex; gap: 12px; justify-content: center; padding: 12px; background: #181818; }}
    .facing-form label {{ padding: 6px 14px; border: 1px solid #444; border-radius: 16px; cursor: pointer; }}
    .facing-form input {{ display: none; }}
    .facing-form input:checked + label {{ background: #2a4a7a; border-color: #4a7acc; }}
    /* CSS-only toggling of per-facing SVG groups and counters: */
    .facing-group, .counter {{ display: none; }}
    body[data-current-facing="east"] .facing-group[data-facing="east"],
    body[data-current-facing="east"] .counter[data-facing="east"],
    body[data-current-facing="west"] .facing-group[data-facing="west"],
    body[data-current-facing="west"] .counter[data-facing="west"],
    body[data-current-facing="both"] .facing-group[data-facing="both"],
    body[data-current-facing="both"] .counter[data-facing="both"] {{ display: inline; }}
    .counter-bar {{ text-align: center; padding: 10px; background: #181818; font-size: 18px; }}
    .counter {{ color: #ffcc66; font-weight: 600; }}
    .instructions {{ padding: 16px 20px; line-height: 1.55; max-width: 560px; margin: 0 auto; }}
    .instructions ol {{ padding-left: 1.2em; }}
  </style>
</head>
<body data-lat="{lat}" data-lng="{lng}" data-current-facing="west">
  <div class="top-hud">
    <span>roll: <span id="roll-readout" class="readout">—</span></span>
    <span>pitch: <span id="pitch-readout" class="readout">—</span></span>
    <span id="level-badge" class="level-badge">checking…</span>
  </div>

  <div class="preview-wrap">
    <img src="/setup/preview.mjpg" alt="camera preview" />
    <svg class="overlay" viewBox="0 0 {SCREEN_W} {SCREEN_H}" preserveAspectRatio="none">
      <line x1="0" y1="{HORIZON_Y}" x2="{SCREEN_W}" y2="{HORIZON_Y}"
            stroke="#ffcc66" stroke-width="2" stroke-dasharray="12 6" opacity="0.85" />
      <text x="{SCREEN_W // 2}" y="60" fill="#ffcc66" font-size="36" text-anchor="middle"
            font-family="system-ui, sans-serif">&uarr; UP</text>
{marker_groups}
    </svg>
  </div>

  <form class="facing-form" id="facing-form">
    <input type="radio" name="facing" id="facing-east" value="east" />
    <label for="facing-east">East (sunrise)</label>
    <input type="radio" name="facing" id="facing-west" value="west" checked />
    <label for="facing-west">West (sunset)</label>
    <input type="radio" name="facing" id="facing-both" value="both" />
    <label for="facing-both">Both</label>
  </form>

  <div class="counter-bar">
{counter_spans}
  </div>

  <div class="instructions">
    <p>Rotate the camera housing until:</p>
    <ol>
      <li>The roll readout is close to 0° and the badge shows green.</li>
      <li>The &uarr; on screen matches the &uarr; on the housing.</li>
      <li>The shaded wedge falls inside the visible preview.</li>
    </ol>
    <p>When all three match, mount the camera. Then close this tab and return to setup.</p>
  </div>

  <script>
    // Orientation polling (Task 6).
    async function pollOrientation() {{
      try {{
        const r = await fetch('/setup/orientation.json', {{ cache: 'no-store' }});
        if (!r.ok) return;
        const j = await r.json();
        if (j.roll_deg !== undefined) {{
          document.getElementById('roll-readout').textContent = j.roll_deg.toFixed(1) + '°';
        }}
        if (j.pitch_deg !== undefined) {{
          document.getElementById('pitch-readout').textContent = j.pitch_deg.toFixed(1) + '°';
        }}
        const badge = document.getElementById('level-badge');
        const level = Math.abs(j.roll_deg || 99) < 1.0 && Math.abs(j.pitch_deg || 99) < 1.0;
        badge.textContent = level ? 'level' : 'tilted';
        badge.classList.toggle('ok', level);
      }} catch (e) {{ /* swallow */ }}
    }}
    setInterval(pollOrientation, 200);
    pollOrientation();

    // Facing selector — drives a body data-attribute that CSS uses to
    // show/hide per-facing markers + counter.
    document.getElementById('facing-form').addEventListener('change', (ev) => {{
      if (ev.target && ev.target.name === 'facing') {{
        document.body.dataset.currentFacing = ev.target.value;
      }}
    }});
  </script>
</body>
</html>
"""
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/jessekauppila/GitHub/sunset-cam-firmware && python -m pytest tests/test_setup_alignment.py -v`
Expected: 13/13 PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/jessekauppila/GitHub/sunset-cam-firmware
git add src/sunset_cam/setup_alignment.py tests/test_setup_alignment.py
git commit -m "feat(setup-align): facing selector + solstice markers + sunsets-per-year"
```

---

## Task 9: Add `stream_mjpeg()` generator + `MJPEG_BOUNDARY` constant

**Files:**
- Modify: `src/sunset_cam/setup_alignment.py`
- Modify: `tests/test_setup_alignment.py`

Same as v0.1 plan's Task 2 — pure multipart-MJPEG generator. Included here for completeness.

- [ ] **Step 1: Add the failing tests**

Append to `tests/test_setup_alignment.py`:

```python
from sunset_cam.setup_alignment import stream_mjpeg, MJPEG_BOUNDARY


def test_mjpeg_boundary_is_exported_and_nontrivial():
    assert isinstance(MJPEG_BOUNDARY, str)
    assert len(MJPEG_BOUNDARY) >= 8


def test_stream_mjpeg_yields_three_frames_from_a_three_call_source():
    frames = [b"AAA", b"BBB", b"CCC"]
    call_index = {"i": 0}

    def source() -> bytes:
        i = call_index["i"]
        call_index["i"] += 1
        if i >= len(frames):
            raise StopIteration
        return frames[i]

    out = b"".join(stream_mjpeg(source))
    assert out.count(f"--{MJPEG_BOUNDARY}".encode()) == 3
    assert out.count(b"Content-Type: image/jpeg") == 3
    for f in frames:
        assert f in out


def test_stream_mjpeg_includes_content_length_per_part():
    def source() -> bytes:
        source.count = getattr(source, "count", 0) + 1
        if source.count > 1:
            raise StopIteration
        return b"X" * 17

    out = b"".join(stream_mjpeg(source))
    assert b"Content-Length: 17" in out


def test_stream_mjpeg_terminates_on_stopiteration():
    def source() -> bytes:
        raise StopIteration
    assert list(stream_mjpeg(source)) == []


def test_stream_mjpeg_swallows_source_exception_and_stops():
    def source() -> bytes:
        raise RuntimeError("glitch")
    assert list(stream_mjpeg(source)) == []
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/jessekauppila/GitHub/sunset-cam-firmware && python -m pytest tests/test_setup_alignment.py -v -k "mjpeg"`
Expected: 5 FAIL (one ImportError, 4 from missing function).

- [ ] **Step 3: Add `stream_mjpeg()` + `MJPEG_BOUNDARY` to `setup_alignment.py`**

At the top of `src/sunset_cam/setup_alignment.py`, near the other imports, add:

```python
from typing import Callable, Iterator
```

Append to the file:

```python
MJPEG_BOUNDARY = "sunsetcamframe"


def stream_mjpeg(
    frame_source: Callable[[], bytes],
    fps: int = 4,
) -> Iterator[bytes]:
    """Yield multipart-encoded MJPEG bytes by polling ``frame_source``.

    Terminates cleanly on StopIteration (EOF) or any other exception
    (transient camera glitch). The caller (web app) is responsible for
    rate-limiting between frames; the ``fps`` parameter is informational.
    """
    boundary = MJPEG_BOUNDARY
    while True:
        try:
            frame = frame_source()
        except StopIteration:
            return
        except Exception:
            return

        header = (
            f"--{boundary}\r\n"
            f"Content-Type: image/jpeg\r\n"
            f"Content-Length: {len(frame)}\r\n"
            f"\r\n"
        ).encode("ascii")
        yield header
        yield frame
        yield b"\r\n"
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/jessekauppila/GitHub/sunset-cam-firmware && python -m pytest tests/test_setup_alignment.py -v`
Expected: 18/18 PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/jessekauppila/GitHub/sunset-cam-firmware
git add src/sunset_cam/setup_alignment.py tests/test_setup_alignment.py
git commit -m "feat(setup-align): stream_mjpeg() + MJPEG_BOUNDARY constant"
```

---

## Task 10: Full firmware test suite green

- [ ] **Step 1: Run the entire firmware test suite**

Run: `cd /Users/jessekauppila/GitHub/sunset-cam-firmware && python -m pytest -v`
Expected: ALL pre-existing tests + 25+ new tests PASS.

If any pre-existing test fails, note it as baseline; do not fix it as part of this plan.

- [ ] **Step 2: No new commit unless something needed fixing**

---

## Task 11: Integration notes in web-app repo

Update spec E and spec F so the next implementer of either knows to plug in C's three endpoints / link.

**Files (in `/Users/jessekauppila/GitHub/the-sunset-webcam-map`):**
- Modify: `docs/superpowers/specs/2026-05-15-wifi-onboarding-and-provisioning-design.md`
- Modify: `docs/superpowers/specs/2026-05-16-cloud-wizard-frontend-design.md`

- [ ] **Step 1: Append the alignment-tool integration note to spec E**

In spec E (`docs/superpowers/specs/2026-05-15-wifi-onboarding-and-provisioning-design.md`), find the section listing the setup web app's routes (search for `iwlist`). Append:

```markdown
**Alignment-tool integration (sub-project C, v0.2).** The setup web app must register three routes from `sunset_cam.setup_alignment`:

- `GET /setup/align` → response body = `render_align_page(lat, lng)` with the camera's stored coordinates; `Content-Type: text/html; charset=utf-8`.
- `GET /setup/preview.mjpg` → response body streams from `stream_mjpeg(frame_source=capture.capture_jpeg)`; `Content-Type: multipart/x-mixed-replace; boundary=sunsetcamframe`.
- `GET /setup/orientation.json` → response body = `render_orientation_json(orientation_sampler)` where `orientation_sampler` is a singleton `OrientationSampler(reader=lambda: read_orientation(smbus2.SMBus(1)))` started at service boot. `Content-Type: application/json`.

The MPU6050 / GY-521 IMU is required hardware for v0.2 (BOM addition). Wired via I2C on the Pi (SDA→GPIO 2, SCL→GPIO 3, VCC→3.3V, GND→GND).
```

- [ ] **Step 2: Append the alignment-tool link note to spec F**

In spec F (`docs/superpowers/specs/2026-05-16-cloud-wizard-frontend-design.md`), append a paragraph at the end of the "What it does" section:

```markdown
**Screen 4 alignment-tool link (sub-project C, v0.2).** Screen 4 renders a single button "Open the alignment tool" that opens `http://<pi-local-ip>:<setup-port>/setup/align` in a new tab. The Pi's local IP + port are surfaced by the same setup-status polling spec E uses for the WiFi-handoff transition. The button is followed by a "Continue" button that advances the wizard with no protocol-payload state from the alignment tool — the alignment step is a one-way side trip.
```

- [ ] **Step 3: Commit both edits**

```bash
cd /Users/jessekauppila/GitHub/the-sunset-webcam-map
git add docs/superpowers/specs/2026-05-15-wifi-onboarding-and-provisioning-design.md \
        docs/superpowers/specs/2026-05-16-cloud-wizard-frontend-design.md
git commit -m "docs(specs): wire alignment-tool integration notes into E + F (v0.2)"
git push
```

---

## Task 12: Hardware tracking stub

**Files (in `/Users/jessekauppila/GitHub/the-sunset-webcam-map`):**
- Create: `docs/hardware/2026-05-17-housing-up-arrow-and-mpu6050.md`

- [ ] **Step 1: Create the hardware stub**

```markdown
# Housing UP-Arrow Marker + MPU6050 BOM Addition — Hardware Stub

Status: Stub — 2026-05-17
Owner: Jesse Kauppila
Triggered by: software spec `docs/superpowers/specs/2026-05-17-pi-side-alignment-tool-design.md` (v0.2)

## What

Two hardware changes tracked here:

1. **UP marker on the housing.** Sharpie ↑ arrow on the case for v1 (acceptable). Future: molded/etched ↑ as part of the STL.
2. **MPU6050 / GY-521 IMU module** wired to the Pi via I2C. New BOM line item.

## Requirements (UP marker)

- Top-center of the front face, ≥3mm above the lens cutout, ≥3mm from the top edge
- Relief or recess, 8–12mm tall, depth/height ≥0.4mm for weather resistance
- v1: Sharpie applied during operator prep (accepts weathering risk; trivial to redo)

## Requirements (MPU6050)

- Part: MPU6050 / GY-521 breakout board ($3–8 single, ~$2/unit in bulk)
- Pi Zero 2 W wiring: SDA→GPIO 2 (pin 3), SCL→GPIO 3 (pin 5), VCC→3.3V (pin 1), GND→GND (pin 9)
- ESP32 wiring: SDA→GPIO 21, SCL→GPIO 22, same 3.3V + GND
- I2C must be enabled in `raspi-config`
- Soldering or hammer-header kit required for Pi Zero 2 W (non-WH variant)
- Physical mount: needs to be rigidly fixed to the camera body so its gravity vector matches the camera's

## Becomes a real spec when

Units acquired, soldered onto a test Pi, software (this plan's output) verified to read live values. At that point the hardware spec graduates from stub to "production assembly procedure."
```

- [ ] **Step 2: Commit + push**

```bash
cd /Users/jessekauppila/GitHub/the-sunset-webcam-map
git add docs/hardware/2026-05-17-housing-up-arrow-and-mpu6050.md
git commit -m "docs(hardware): stub for housing UP-arrow + MPU6050 BOM (C v0.2)"
git push
```

---

## Task 13: Push firmware feature branch + open PR

- [ ] **Step 1: Identify firmware branch state**

```bash
cd /Users/jessekauppila/GitHub/sunset-cam-firmware
git branch --show-current
git log origin/main..HEAD --oneline
```

- [ ] **Step 2: Create a feature branch if on main**

If currently on `main`, create a feature branch:

```bash
cd /Users/jessekauppila/GitHub/sunset-cam-firmware
git checkout -b feat/setup-alignment-mpu6050
```

- [ ] **Step 3: Push**

```bash
cd /Users/jessekauppila/GitHub/sunset-cam-firmware
git push -u origin HEAD
```

- [ ] **Step 4: Open PR (manual)**

Open the PR with:
- Title: `feat(setup-align): alignment tool + MPU6050 (sub-project C v0.2)`
- Body: summarize the four new modules + 25+ unit tests + that field validation gates on MPU6050 acquisition.
- Link to the spec in the web-app repo.

---

## Self-review

Mapping the spec v0.2 to tasks:

| Spec section | Task(s) |
|---|---|
| §1 Problem (level / up / aim) | Goals addressed in Tasks 2 (level), 5 (up), 8 (aim) |
| §2 Goals 1–3 | 2, 5, 8 |
| §3 Non-goals | No tasks (deliberate) |
| §5.1 Architecture (three endpoints) | 5/7/9 |
| §5.2 Alignment page (HUD + facing + counter) | 5, 6, 8 |
| §5.3 Hardware | 12 |
| §5.4 Reading orientation (math) | 2 |
| §5.5 Facing selector + solstice math | 4, 8 |
| §5.6 F integration | 11 |
| §7.1 Unit testing | 2, 3, 4, 5, 6, 7, 8, 9 |
| §7.2 Manual testing | Deferred — gates on MPU6050 hardware |
| §8 Risks | Each task documents its specific risks via comments + tests |
| §10 Open questions / future | Documented in spec, no code tasks |

**Type consistency check:**
- `OrientationSampler.latest()` returns `Optional[dict]` everywhere (Tasks 3, 7).
- `render_orientation_json(sampler)` consumes an `OrientationSampler` (Task 7).
- `read_orientation(bus)` returns `Tuple[float, float]` (Task 2); injected as `reader` into `OrientationSampler` (Task 3).
- `MJPEG_BOUNDARY` referenced consistently in Task 9.

No placeholders, no "TBD." Every code step has full code. Every test step has a runnable command + expected outcome.
