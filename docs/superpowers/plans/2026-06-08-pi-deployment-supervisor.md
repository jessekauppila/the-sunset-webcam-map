# Device Supervisor (AIMING↔ACTIVE auto-run) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A device-side supervisor that auto-runs the right thing with no typed commands — it heartbeats the cloud, and when placement is `awaiting_aim` it launches the v0.4 aiming tool; when `ready` it flips to the capture loop.

**Architecture:** The supervisor is the always-on "brain" (its own systemd unit). Each loop it heartbeats the cloud for `placement_status` and drives the two camera services (`sunset-cam-aiming`, `sunset-cam`) by mode, using a `Conflicts=` directive as a hard OS-level camera-singleton backstop. All logic is split into pure functions + injected IO so it's fully testable with no hardware/network.

**Tech Stack:** Python 3.11 (Pi) / 3.9 (Mac dev), stdlib + `requests` (already a dep), `pytest`. `from __future__ import annotations`.

## Scope

The **AIMING↔ACTIVE supervision** slice of `docs/superpowers/specs/2026-06-07-pi-deployment-aiming-integration-design.md` (§5.1). The WiFi captive portal / SETUP mode (sub-project E) is **separate and out of scope** — cam1 is already online via its WiFi config, so this slice doesn't need it. Relocation (`reaim`) is designed-for (the loop heartbeats in every state) but its directive handling is a follow-on.

## Working location

`sunset-cam-firmware` on branch **`feat/deploy-aiming-supervisor`** cut **off `feat/deploy-aiming-firmware`** (which has the config-driven launcher + confirm this builds on). Use a git worktree. Confirm the branch before each commit. Tests: `python3 -m pytest` (Python 3.9 → ignore `tests/test_config.py`/`tests/test_upload.py` in full-suite runs).

Setup (controller runs once before Task 1):
```bash
cd ~/GitHub/sunset-cam-firmware && git fetch origin -q
git worktree add ~/GitHub/scf-supervisor -b feat/deploy-aiming-supervisor origin/feat/deploy-aiming-firmware
```

## File Structure

| File | Responsibility | New/Modify |
|---|---|---|
| `src/sunset_cam/heartbeat.py` | `parse_placement` (pure) + `post_heartbeat` (IO, injectable poster) | Create |
| `src/sunset_cam/supervisor.py` | `decide_mode` (pure), `run_once` (orchestration), `main` (loop) | Create |
| `src/sunset_cam/service_control.py` | `SystemctlController.set_mode` (injectable runner) + unit constants | Create |
| `src/sunset_cam/device_config.py` | `write_location` (merge lat/lng into config.json) | Create |
| `systemd/sunset-cam-aiming.service` | runs the config-driven aiming server; `Conflicts=sunset-cam.service` | Create |
| `systemd/sunset-cam-supervisor.service` | runs `python -m sunset_cam.supervisor` | Create |
| `tests/test_heartbeat.py`, `tests/test_supervisor.py`, `tests/test_service_control.py`, `tests/test_device_config.py` | tests | Create |

---

### Task 1: `heartbeat.py` — read placement status from the cloud

**Files:** Create `src/sunset_cam/heartbeat.py`; create `tests/test_heartbeat.py`.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_heartbeat.py
from sunset_cam.heartbeat import parse_placement, post_heartbeat

def test_parse_placement_pulls_status_and_coords():
    out = parse_placement({"placement_status": "awaiting_aim", "lat": 48.7, "lng": -122.4, "x": 1})
    assert out == {"placement_status": "awaiting_aim", "lat": 48.7, "lng": -122.4}

def test_parse_placement_defaults_missing_to_none():
    out = parse_placement({"acknowledged_at": "t"})
    assert out == {"placement_status": None, "lat": None, "lng": None}

def test_post_heartbeat_posts_with_auth_and_parses():
    calls = {}
    class FakeResp:
        def raise_for_status(self): pass
        def json(self): return {"placement_status": "ready", "lat": 1.0, "lng": 2.0}
    def fake_poster(url, json, headers, timeout):
        calls["url"] = url; calls["json"] = json; calls["headers"] = headers
        return FakeResp()
    cfg = {"api_base": "https://www.sunrisesunset.studio", "camera_id": 4, "device_token": "tok"}
    out = post_heartbeat(cfg, poster=fake_poster)
    assert calls["url"] == "https://www.sunrisesunset.studio/api/cameras/4/heartbeat"
    assert calls["json"] == {"request_placement": True}
    assert calls["headers"]["Authorization"] == "Bearer tok"
    assert out == {"placement_status": "ready", "lat": 1.0, "lng": 2.0}
```

- [ ] **Step 2: Run, verify fail**

Run: `python3 -m pytest tests/test_heartbeat.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'sunset_cam.heartbeat'`.

- [ ] **Step 3: Implement** `src/sunset_cam/heartbeat.py`

```python
"""Device heartbeat: report liveness and read placement status from the cloud.
Auth mirrors upload.py — Bearer device_token to {api_base}/api/cameras/{camera_id}/heartbeat."""
from __future__ import annotations

from typing import Callable

import requests


def parse_placement(body: dict) -> dict:
    """Extract the supervisor-relevant fields from a heartbeat response."""
    return {
        "placement_status": body.get("placement_status"),
        "lat": body.get("lat"),
        "lng": body.get("lng"),
    }


def post_heartbeat(
    config: dict, poster: Callable = requests.post, timeout_s: float = 10.0
) -> dict:
    url = f"{config['api_base'].rstrip('/')}/api/cameras/{config['camera_id']}/heartbeat"
    headers = {
        "Authorization": f"Bearer {config['device_token']}",
        "Content-Type": "application/json",
    }
    resp = poster(url, json={"request_placement": True}, headers=headers, timeout=timeout_s)
    resp.raise_for_status()
    return parse_placement(resp.json())
```

- [ ] **Step 4: Run, verify pass** — `python3 -m pytest tests/test_heartbeat.py -v` → PASS.

- [ ] **Step 5: Commit**

```bash
git branch --show-current   # MUST be feat/deploy-aiming-supervisor
git add src/sunset_cam/heartbeat.py tests/test_heartbeat.py
git commit -m "feat(heartbeat): post_heartbeat + parse_placement (read placement_status from cloud)"
```

---

### Task 2: `service_control.py` — drive the systemd units by mode

**Files:** Create `src/sunset_cam/service_control.py`; create `tests/test_service_control.py`.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_service_control.py
from sunset_cam.service_control import SystemctlController, AIMING_UNIT, CAPTURE_UNIT

def _controller():
    calls = []
    c = SystemctlController(runner=lambda args: calls.append(args))
    return c, calls

def test_aiming_mode_stops_capture_starts_aiming():
    c, calls = _controller()
    c.set_mode("aiming")
    assert ["stop", CAPTURE_UNIT] in calls
    assert ["start", AIMING_UNIT] in calls

def test_capture_mode_stops_aiming_starts_capture():
    c, calls = _controller()
    c.set_mode("capture")
    assert ["stop", AIMING_UNIT] in calls
    assert ["start", CAPTURE_UNIT] in calls

def test_idle_mode_stops_both():
    c, calls = _controller()
    c.set_mode("idle")
    assert ["stop", AIMING_UNIT] in calls
    assert ["stop", CAPTURE_UNIT] in calls
    assert not any(a[0] == "start" for a in calls)
```

- [ ] **Step 2: Run, verify fail** — `python3 -m pytest tests/test_service_control.py -v` → ModuleNotFoundError.

- [ ] **Step 3: Implement** `src/sunset_cam/service_control.py`

```python
"""Drive the two camera systemd units by mode. Idempotent at the systemd level
(starting a running unit / stopping a stopped unit are no-ops), so set_mode is
safe to call every loop. The runner is injectable for tests."""
from __future__ import annotations

import subprocess
from typing import Callable

AIMING_UNIT = "sunset-cam-aiming.service"
CAPTURE_UNIT = "sunset-cam.service"


def _default_runner(args: list) -> None:
    subprocess.run(["systemctl", *args], check=False)


class SystemctlController:
    def __init__(self, runner: Callable[[list], None] = _default_runner) -> None:
        self._run = runner

    def set_mode(self, mode: str) -> None:
        if mode == "aiming":
            self._run(["stop", CAPTURE_UNIT])
            self._run(["start", AIMING_UNIT])
        elif mode == "capture":
            self._run(["stop", AIMING_UNIT])
            self._run(["start", CAPTURE_UNIT])
        else:  # idle / unknown
            self._run(["stop", AIMING_UNIT])
            self._run(["stop", CAPTURE_UNIT])
```

- [ ] **Step 4: Run, verify pass** → PASS.

- [ ] **Step 5: Commit**

```bash
git branch --show-current
git add src/sunset_cam/service_control.py tests/test_service_control.py
git commit -m "feat(supervisor): SystemctlController drives aiming/capture units by mode"
```

---

### Task 3: `device_config.py` — write lat/lng into the device config

**Files:** Create `src/sunset_cam/device_config.py`; create `tests/test_device_config.py`.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_device_config.py
import json
from sunset_cam.device_config import write_location

def test_write_location_merges_into_existing_config(tmp_path):
    p = tmp_path / "config.json"
    p.write_text(json.dumps({"camera_id": 4, "device_token": "t"}))
    write_location(str(p), 48.7519, -122.4787)
    cfg = json.loads(p.read_text())
    assert cfg["lat"] == 48.7519 and cfg["lng"] == -122.4787
    assert cfg["camera_id"] == 4 and cfg["device_token"] == "t"  # preserved

def test_write_location_creates_when_absent(tmp_path):
    p = tmp_path / "config.json"
    write_location(str(p), 1.0, 2.0)
    assert json.loads(p.read_text()) == {"lat": 1.0, "lng": 2.0}
```

- [ ] **Step 2: Run, verify fail** → ModuleNotFoundError.

- [ ] **Step 3: Implement** `src/sunset_cam/device_config.py`

```python
"""Merge the cloud-delivered location into the device config so the aiming
server (run-setup-server.py, config-driven) can read lat/lng."""
from __future__ import annotations

import json
from pathlib import Path


def write_location(config_path: str, lat: float, lng: float) -> None:
    p = Path(config_path)
    cfg = json.loads(p.read_text()) if p.exists() else {}
    cfg["lat"] = lat
    cfg["lng"] = lng
    p.write_text(json.dumps(cfg, indent=2) + "\n")
```

- [ ] **Step 4: Run, verify pass** → PASS.

- [ ] **Step 5: Commit**

```bash
git branch --show-current
git add src/sunset_cam/device_config.py tests/test_device_config.py
git commit -m "feat(supervisor): write_location merges cloud lat/lng into device config"
```

---

### Task 4: `supervisor.py` — the decision + one-loop orchestration

**Files:** Create `src/sunset_cam/supervisor.py`; create `tests/test_supervisor.py`.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_supervisor.py
from sunset_cam.supervisor import decide_mode, run_once

def test_decide_mode_maps_status():
    assert decide_mode("awaiting_aim") == "aiming"
    assert decide_mode("ready") == "capture"
    assert decide_mode("awaiting_location") == "idle"
    assert decide_mode(None) == "idle"

class FakeController:
    def __init__(self): self.mode = None
    def set_mode(self, m): self.mode = m

def test_run_once_aiming_writes_location_and_sets_aiming():
    written = []
    ctrl = FakeController()
    mode = run_once(
        status_source=lambda: {"placement_status": "awaiting_aim", "lat": 48.7, "lng": -122.4},
        controller=ctrl,
        config_writer=lambda lat, lng: written.append((lat, lng)),
    )
    assert mode == "aiming"
    assert written == [(48.7, -122.4)]
    assert ctrl.mode == "aiming"

def test_run_once_ready_sets_capture_without_writing_location():
    written = []
    ctrl = FakeController()
    mode = run_once(
        status_source=lambda: {"placement_status": "ready", "lat": 48.7, "lng": -122.4},
        controller=ctrl,
        config_writer=lambda lat, lng: written.append((lat, lng)),
    )
    assert mode == "capture"
    assert written == []
    assert ctrl.mode == "capture"

def test_run_once_awaiting_location_is_idle():
    ctrl = FakeController()
    mode = run_once(
        status_source=lambda: {"placement_status": "awaiting_location", "lat": None, "lng": None},
        controller=ctrl, config_writer=lambda lat, lng: None,
    )
    assert mode == "idle" and ctrl.mode == "idle"
```

- [ ] **Step 2: Run, verify fail** → ModuleNotFoundError.

- [ ] **Step 3: Implement** `src/sunset_cam/supervisor.py`

```python
"""The always-on device brain. Heartbeats the cloud for placement_status and
drives the camera mode. Pure decision (decide_mode) + injectable IO (run_once)
so the logic is fully testable; main() wires the real heartbeat + systemctl."""
from __future__ import annotations

import logging
import time
from typing import Callable

from sunset_cam.config import load_config
from sunset_cam.heartbeat import post_heartbeat
from sunset_cam.service_control import SystemctlController
from sunset_cam.device_config import write_location

CONFIG_PATH = "/opt/sunset-cam/config/config.json"


def decide_mode(placement_status) -> str:
    if placement_status == "awaiting_aim":
        return "aiming"
    if placement_status == "ready":
        return "capture"
    return "idle"


def run_once(status_source: Callable[[], dict], controller, config_writer) -> str:
    result = status_source()
    mode = decide_mode(result.get("placement_status"))
    if mode == "aiming" and result.get("lat") is not None and result.get("lng") is not None:
        config_writer(result["lat"], result["lng"])
    controller.set_mode(mode)
    return mode


def main(interval_s: float = 30.0) -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s supervisor %(message)s")
    log = logging.getLogger("supervisor")
    config = load_config(CONFIG_PATH)
    controller = SystemctlController()
    log.info("supervisor up; camera_id=%s", config["camera_id"])
    while True:
        try:
            mode = run_once(
                status_source=lambda: post_heartbeat(config),
                controller=controller,
                config_writer=lambda lat, lng: write_location(CONFIG_PATH, lat, lng),
            )
            log.info("mode=%s", mode)
        except Exception as exc:  # noqa: BLE001
            log.error("loop error: %s", exc)
        time.sleep(interval_s)


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run, verify pass** — `python3 -m pytest tests/test_supervisor.py -v` then the runnable full suite (no regressions).

- [ ] **Step 5: Commit**

```bash
git branch --show-current
git add src/sunset_cam/supervisor.py tests/test_supervisor.py
git commit -m "feat(supervisor): decide_mode + run_once orchestration + main loop"
```

---

### Task 5: systemd units (config files — verified by the bench run)

**Files:** Create `systemd/sunset-cam-aiming.service`, `systemd/sunset-cam-supervisor.service`.

- [ ] **Step 1: Create `systemd/sunset-cam-aiming.service`**

```ini
[Unit]
Description=Sunset Cam setup-mode aiming server (v0.4 sun-tap)
After=network-online.target
Wants=network-online.target
Conflicts=sunset-cam.service

[Service]
Type=simple
User=root
WorkingDirectory=/opt/sunset-cam
ExecStart=/opt/sunset-cam/.venv/bin/python /opt/sunset-cam/scripts/run-setup-server.py --port 8080
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
```
(No `--lat/--lng` flags — the launcher reads them from `config/config.json`, which the supervisor writes. `User=root` because picamera2 + binding :8080.)

- [ ] **Step 2: Create `systemd/sunset-cam-supervisor.service`**

```ini
[Unit]
Description=Sunset Cam device supervisor (AIMING<->ACTIVE)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/sunset-cam
ExecStart=/opt/sunset-cam/.venv/bin/python -m sunset_cam.supervisor
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```
(`User=root` so it can `systemctl start/stop` the camera units.)

- [ ] **Step 3: Syntax sanity** (no unit-test for ini files; the bench run is the test)

Run: `python3 -c "import configparser; [configparser.ConfigParser(strict=False).read(f) for f in ['systemd/sunset-cam-aiming.service','systemd/sunset-cam-supervisor.service']]; print('parse OK')"`
Expected: `parse OK`.

- [ ] **Step 4: Commit**

```bash
git branch --show-current
git add systemd/sunset-cam-aiming.service systemd/sunset-cam-supervisor.service
git commit -m "feat(supervisor): systemd units (aiming Conflicts=capture, supervisor brain)"
```

---

## Self-Review

- **Spec coverage:** §5.1 three-mode supervision → Tasks 2/4/5 (decide_mode + SystemctlController + units, with `Conflicts=` as the hard backstop); heartbeat-reads-status → Task 1; lat/lng-to-config (location-down) → Task 3; the always-on brain that enables relocation later → the `main` loop heartbeating in every state (Task 4). WiFi/SETUP mode (E) and `reaim` directive handling are explicitly out of scope.
- **Placeholders:** none — every step has full code. The `.ini` units are config, verified by parse + the bench run.
- **Type consistency:** `run_once(status_source, controller, config_writer)` and the `{placement_status, lat, lng}` dict shape are consistent between `heartbeat.parse_placement` (Task 1), `supervisor.run_once` (Task 4), and the tests; `SystemctlController.set_mode(mode)` with modes `"aiming"|"capture"|"idle"` consistent between Tasks 2 and 4; `write_location(path, lat, lng)` consistent between Tasks 3 and 4.

## Bench end-to-end run (after build — the walking-skeleton moment)
Not a code task. On cam1: deploy this branch to `/opt/sunset-cam`, install + `daemon-reload` the two new units, enable+start `sunset-cam-supervisor`. With the cloud camera in `awaiting_aim` (set lat/lng but no aim via the cloud), confirm the supervisor auto-starts the aiming server; open it on a phone, tap, **Confirm** → `POST /placement` flips the cloud to `ready` → supervisor stops aiming and starts capture. That exercises the whole stack (no real sun needed for the plumbing).
