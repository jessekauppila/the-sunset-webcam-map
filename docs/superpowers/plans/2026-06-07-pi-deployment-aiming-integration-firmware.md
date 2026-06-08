# Deployment-Aiming Integration (Firmware Slices) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the two firmware pieces that make the built v0.4 aiming tool deployable — a `POST /setup/confirm` that commits the sun-tap aim as the device's placement, and a config-driven launcher so the aiming server can run from device config (not just CLI flags).

**Architecture:** Both extend the already-built v0.4 `setup_server.py` / `setup_alignment.py` in the `sunset-cam-firmware` repo. `AimingService` gains a `confirm` path that validates the heading is in the `tapped` state, builds a placement dict, and hands it to an injectable sink (so it's filesystem-free in tests). A pure `resolve_aiming_params` function merges CLI flags over device-config over defaults. All TDD, all hardware-free.

**Tech Stack:** Python 3.11 (Pi) / 3.9 (Mac dev), stdlib only, `pytest`. `from __future__ import annotations` throughout.

---

## Scope

This is **only** the firmware-now subset of `docs/superpowers/specs/2026-06-07-pi-deployment-aiming-integration-design.md` (spec slices 1–2). These live in `sunset-cam-firmware` and are isolated from the parallel labeling-queue work (different repo).

### ⛔ NOT in this plan — separate follow-on plan, gated
Spec slices 3+ (the cloud + device-supervisor side) are a **separate plan**, blocked on TWO things: (a) the labeling-queue **PR #47 merging** (it shares the `app/` + `database/` surface these slices touch), and (b) **sub-project E's device state machine** existing (the supervisor extends it). Do NOT start these here:
- `placement_status` three-state (`awaiting_location`/`awaiting_aim`/`ready`), `lat`/`lng` in register/heartbeat, `POST /api/cameras/:id/placement`, `setup-status` `awaiting_aim` (cloud, `app/` + `database/`)
- the device supervisor that starts/stops `sunset-cam-aiming` vs `sunset-cam` by status
- `sunset-cam-aiming.service` systemd unit (`Conflicts=sunset-cam.service`)
- heartbeat `local_ip` + the `reaim`/`reprovision` relocation directives

## Working location

`sunset-cam-firmware` on branch **`feat/deploy-aiming-firmware`** cut **off `feat/v0.4-sun-tap-aiming`** (these extend the unmerged v0.4 `setup_server`/`setup_alignment`). Use a git worktree. Confirm the branch before each commit.

Setup (controller runs once before Task 1):
```bash
cd ~/GitHub/sunset-cam-firmware && git fetch origin -q
git worktree add ~/GitHub/scf-deploy-aiming -b feat/deploy-aiming-firmware origin/feat/v0.4-sun-tap-aiming
```
Run tests with `python3 -m pytest`. Python 3.9 on the Mac → ignore `tests/test_config.py` and `tests/test_upload.py` in full-suite runs (`--ignore=tests/test_config.py --ignore=tests/test_upload.py`).

## File Structure

| File | Responsibility | New/Modify |
|---|---|---|
| `src/sunset_cam/setup_server.py` | `AimingService`: add `placement_sink` ctor param + `confirm()` + `POST /setup/confirm` route | Modify |
| `src/sunset_cam/aiming_config.py` | `resolve_aiming_params(cli, config, defaults)` pure merge function | Create |
| `scripts/run-setup-server.py` | read device config + merge via `resolve_aiming_params` when flags absent | Modify |
| `tests/test_setup_server.py` | confirm tests | Modify |
| `tests/test_aiming_config.py` | param-merge tests | Create |
| `tests/test_setup_alignment.py` | confirm-button test | Modify |

---

### Task 1: `POST /setup/confirm` — commit the aim as placement

**Files:**
- Modify: `src/sunset_cam/setup_server.py` (`AimingService.__init__` + `handle_post`)
- Test: `tests/test_setup_server.py`

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_setup_server.py  (add)
def test_confirm_in_tapped_state_returns_placement():
    sink = []
    svc = AimingService(
        lat=48.7519, lng=-122.4787, phase="sunset", hfov_deg=120.0, width=1600,
        frame_source=lambda: b"\xff\xd8\xff\xd9", reader=lambda: (0.2, 1.0),
        now_utc_fn=lambda: datetime(2026, 6, 21, 3, 30, tzinfo=timezone.utc),
        placement_sink=sink.append,
    )
    svc.handle_post("/setup/tap", {"pixel_x": 800, "pixel_y": 450})  # -> tapped
    body, status, _ = svc.handle_post("/setup/confirm", {})
    assert status == 200
    data = json.loads(body)
    assert data["status"] == "confirmed"
    assert data["placement"]["azimuth_deg"] == svc.state.heading_deg()
    assert data["placement"]["tilt_deg"] == 1.0          # = the pitch reading
    assert data["placement"]["roll_deg"] == 0.2
    assert "confirmed_at" in data["placement"]
    assert sink == [data["placement"]]                    # persisted via the sink

def test_confirm_without_tap_returns_409():
    svc = AimingService(
        lat=48.0, lng=-122.0, phase="sunset", hfov_deg=120.0, width=1600,
        frame_source=lambda: b"\xff\xd8\xff\xd9", reader=lambda: (0.0, 0.0),
        now_utc_fn=lambda: datetime(2026, 6, 21, 3, 30, tzinfo=timezone.utc),
        placement_sink=lambda p: None,
    )
    body, status, _ = svc.handle_post("/setup/confirm", {})
    assert status == 409                                  # uncalibrated -> cannot confirm
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m pytest tests/test_setup_server.py -v`
Expected: FAIL — `AimingService.__init__` has no `placement_sink` kwarg / `/setup/confirm` returns 404.

- [ ] **Step 3: Implement**

In `src/sunset_cam/setup_server.py`, add a module-level default sink + extend the class:

```python
import json, os   # json already imported; add os
# ... existing imports ...

DEFAULT_PLACEMENT_PATH = "/etc/sunset-cam/placement.json"


def _default_placement_sink(placement: dict) -> None:
    os.makedirs(os.path.dirname(DEFAULT_PLACEMENT_PATH), exist_ok=True)
    with open(DEFAULT_PLACEMENT_PATH, "w") as f:
        json.dump(placement, f)
```

Add `placement_sink` to `__init__` (after `now_utc_fn`):
```python
        now_utc_fn: Callable[[], datetime] = lambda: datetime.now(timezone.utc),
        placement_sink: Callable[[dict], None] = _default_placement_sink,
    ) -> None:
        ...
        self.now_utc_fn = now_utc_fn
        self.placement_sink = placement_sink
```

In `handle_post`, add the confirm branch BEFORE the final `return 404` (keep the existing `/setup/tap` branch):
```python
    def handle_post(self, path: str, body: dict):
        if path == "/setup/tap":
            # ... existing tap logic unchanged ...
        if path == "/setup/confirm":
            roll, pitch = self._orientation()
            self.state.update_orientation(roll, pitch)   # flips to suspect if moved
            if self.state.status() != "tapped":
                return (json.dumps({"status": self.state.status(),
                                    "error": "aim not set — tap the sun first"}),
                        409, "application/json")
            placement = {
                "azimuth_deg": self.state.heading_deg(),
                "tilt_deg": pitch,
                "roll_deg": roll,
                "confirmed_at": self.now_utc_fn().isoformat(),
            }
            self.placement_sink(placement)
            return (json.dumps({"status": "confirmed", "placement": placement}),
                    200, "application/json")
        return json.dumps({"error": "not found"}), 404, "application/json"
```
(Note `tilt_deg` is stored as the raw gyro pitch; its sign/zero convention is pinned during hardware validation — spec §9 Q1. Keep it raw here.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m pytest tests/test_setup_server.py -v` then the runnable full suite (`--ignore=tests/test_config.py --ignore=tests/test_upload.py`). Expected: all pass, no regressions.

- [ ] **Step 5: Commit**

```bash
git branch --show-current   # MUST be feat/deploy-aiming-firmware
git add src/sunset_cam/setup_server.py tests/test_setup_server.py
git commit -m "feat(setup-server): POST /setup/confirm commits the aim as placement"
```

---

### Task 2: "Confirm aim" button in the overlay

**Files:**
- Modify: `src/sunset_cam/setup_alignment.py` (the `_AIM_SCRIPT` constant from the v0.4 work)
- Test: `tests/test_setup_alignment.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_setup_alignment.py  (add)
def test_align_page_has_confirm_button_posting_to_confirm():
    html = render_align_page(48.7519, -122.4787)
    assert "/setup/confirm" in html
    assert "confirm-aim" in html   # the button's id
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest tests/test_setup_alignment.py::test_align_page_has_confirm_button_posting_to_confirm -v`
Expected: FAIL — substrings absent.

- [ ] **Step 3: Implement**

In `src/sunset_cam/setup_alignment.py`, edit the `_AIM_SCRIPT` constant: add a confirm button element and wire it. The button is shown only while heading status is `tapped` (the same confidence gate). Replace the `<script>` open with a button + the gating in `pollHeadingState`, and add a click handler:

```python
_AIM_SCRIPT = """
<button id="confirm-aim" hidden>Confirm aim</button>
<script>
  const _img = document.querySelector('.preview-wrap img');
  if (_img) _img.addEventListener('pointerdown', async (e) => {
    const r = _img.getBoundingClientRect();
    const px = Math.round((e.clientX - r.left) / r.width * (_img.naturalWidth || 1600));
    const py = Math.round((e.clientY - r.top) / r.height * (_img.naturalHeight || 900));
    const resp = await fetch('/setup/tap', {method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({pixel_x: px, pixel_y: py})});
    window._lastTap = await resp.json();
  });
  const _confirm = document.getElementById('confirm-aim');
  if (_confirm) _confirm.addEventListener('click', async () => {
    const resp = await fetch('/setup/confirm', {method: 'POST',
      headers: {'Content-Type': 'application/json'}, body: '{}'});
    const j = await resp.json();
    if (j.status === 'confirmed') _confirm.textContent = 'Aim confirmed \\u2713';
  });
  async function pollHeadingState() {
    try {
      const s = await (await fetch('/setup/state.json', {cache: 'no-store'})).json();
      document.body.dataset.headingStatus = s.status;
      if (_confirm) _confirm.hidden = (s.status !== 'tapped');
      const b = document.getElementById('heading-badge');
      if (b) b.textContent = (s.status === 'tapped')
        ? ('aimed ' + Math.round(s.heading_deg) + '\\u00b0' + (s.fits ? ' \\u2713' : ' \\u2014 clipped'))
        : (s.status === 'suspect' ? 're-tap' : 'tap the sun');
    } catch (e) {}
  }
  setInterval(pollHeadingState, 400); pollHeadingState();
</script>
"""
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m pytest tests/test_setup_alignment.py -v` then the runnable full suite. Expected: all pass (existing 21 + 1 new), no regressions.

- [ ] **Step 5: Commit**

```bash
git branch --show-current
git add src/sunset_cam/setup_alignment.py tests/test_setup_alignment.py
git commit -m "feat(overlay): Confirm-aim button (shown only in tapped state)"
```

---

### Task 3: Config-driven launcher params

**Files:**
- Create: `src/sunset_cam/aiming_config.py`
- Test: `tests/test_aiming_config.py`
- Modify: `scripts/run-setup-server.py` (use the resolver)

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_aiming_config.py
import pytest
from sunset_cam.aiming_config import resolve_aiming_params

def test_cli_overrides_config_and_defaults():
    out = resolve_aiming_params(
        cli={"lat": 1.0, "lng": 2.0, "phase": None, "hfov": None, "width": None},
        config={"lat": 9.0, "lng": 9.0, "phase": "sunrise", "hfov": 90.0, "width": 1280},
    )
    assert out == {"lat": 1.0, "lng": 2.0, "phase": "sunrise", "hfov": 90.0, "width": 1280}

def test_config_used_when_cli_absent():
    out = resolve_aiming_params(
        cli={"lat": None, "lng": None, "phase": None, "hfov": None, "width": None},
        config={"lat": 48.7519, "lng": -122.4787},
    )
    assert out["lat"] == 48.7519 and out["lng"] == -122.4787
    assert out["phase"] == "sunset" and out["hfov"] == 102.0 and out["width"] == 1920

def test_missing_lat_lng_raises():
    with pytest.raises(ValueError):
        resolve_aiming_params(cli={"lat": None, "lng": None}, config={})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m pytest tests/test_aiming_config.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'sunset_cam.aiming_config'`.

- [ ] **Step 3: Implement**

```python
# src/sunset_cam/aiming_config.py
"""Resolve aiming-server parameters: CLI flags override device config override
defaults. lat/lng are required (the sun overlay needs them); the rest default."""
from __future__ import annotations

_DEFAULTS = {"phase": "sunset", "hfov": 102.0, "width": 1920}


def resolve_aiming_params(cli: dict, config: dict) -> dict:
    def pick(key, default=None):
        v = cli.get(key)
        if v is not None:
            return v
        v = config.get(key)
        if v is not None:
            return v
        return default

    lat, lng = pick("lat"), pick("lng")
    if lat is None or lng is None:
        raise ValueError("lat/lng must be provided via CLI flags or device config")
    return {
        "lat": lat, "lng": lng,
        "phase": pick("phase", _DEFAULTS["phase"]),
        "hfov": pick("hfov", _DEFAULTS["hfov"]),
        "width": pick("width", _DEFAULTS["width"]),
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m pytest tests/test_aiming_config.py -v`
Expected: PASS.

- [ ] **Step 5: Wire into the launcher**

Modify `scripts/run-setup-server.py` so flags are optional and fall back to device config. Change the argparse defaults to `None` (so "absent" is detectable), load the device config JSON if present, and resolve:

```python
# scripts/run-setup-server.py  (replace the arg-parsing + service-build section)
import json
from pathlib import Path
from sunset_cam.aiming_config import resolve_aiming_params

CONFIG_PATH = "/opt/sunset-cam/config/config.json"

def main() -> None:
    ap = argparse.ArgumentParser(description="v0.4 sun-tap aiming setup-server")
    ap.add_argument("--lat", type=float, default=None)
    ap.add_argument("--lng", type=float, default=None)
    ap.add_argument("--phase", default=None, choices=["sunset", "sunrise", None])
    ap.add_argument("--hfov", type=float, default=None)
    ap.add_argument("--width", type=int, default=None)
    ap.add_argument("--port", type=int, default=8080)
    ap.add_argument("--config", default=CONFIG_PATH)
    args = ap.parse_args()

    config = {}
    p = Path(args.config)
    if p.exists():
        config = json.loads(p.read_text())
    params = resolve_aiming_params(
        cli={"lat": args.lat, "lng": args.lng, "phase": args.phase,
             "hfov": args.hfov, "width": args.width},
        config=config,
    )

    reader = make_orientation_reader(smbus2.SMBus(1))
    service = AimingService(
        lat=params["lat"], lng=params["lng"], phase=params["phase"],
        hfov_deg=params["hfov"], width=params["width"],
        frame_source=capture_jpeg, reader=reader,
    )
    print(f"setup-server on :{args.port} — open http://<pi>:{args.port}/ from a phone")
    serve(service, args.port)
```
(Keep the existing imports at the top of the file; `--phase` choices include `None` so an absent flag passes argparse.)

- [ ] **Step 6: Commit**

```bash
git branch --show-current
git add src/sunset_cam/aiming_config.py tests/test_aiming_config.py scripts/run-setup-server.py
git commit -m "feat(setup-server): config-driven aiming params (CLI > config > defaults)"
```

---

## Self-Review

- **Spec coverage:** spec slice 1 (`POST /setup/confirm` + Confirm button) → Tasks 1+2; spec slice 2 (config-driven launcher) → Task 3. Spec slices 3+ (cloud, supervisor, systemd, relocation) are explicitly out of scope here (the ⛔ block) and gated. The confidence gate (spec §5.3 "confirm requires tapped, not suspect/uncalibrated") → Task 1's 409 path + Task 2's button-hidden gating. `tilt_deg` sign (spec §9 Q1) → stored raw, noted.
- **Placeholders:** none. Task 1's tap branch is shown as "existing logic unchanged" because it is genuinely unchanged from the v0.4 commit — the new code is the confirm branch, given in full.
- **Type consistency:** `AimingService(..., placement_sink=...)` ctor change is reflected in Task 1's tests (the existing `test_setup_server.py` tests built `AimingService` without `placement_sink`, which still works because it defaults). `resolve_aiming_params(cli, config)` signature and its returned keys (`lat/lng/phase/hfov/width`) are consistent between Task 3's tests, the function, and the launcher wiring.

## Follow-on (do NOT do here)
After PR #47 merges and E's state machine lands, write the **cloud + supervisor plan** for spec slices 3–8. The placement this firmware writes (`/etc/sunset-cam/placement.json` via the sink) is the artifact the supervisor reads to report up and transition AIMING → ACTIVE.
