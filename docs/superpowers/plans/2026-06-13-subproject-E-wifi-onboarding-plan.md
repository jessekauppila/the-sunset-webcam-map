# Sub-project E: WiFi Captive-Portal Onboarding + SD Provisioning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a non-technical recipient take a sealed Pi Zero 2 W from "in the box" to "joined to home WiFi and registered" using only their phone, while the operator's per-unit prep is one reproducible command.

**Architecture:** Two repos, two state machines, one shared key. The CLOUD (`the-sunset-webcam-map`, Next.js + vitest) exposes claim-code-bearing endpoints; the device row keyed by `claim_code` is the only shared state. The FIRMWARE (`sunset-cam-firmware`, python3.11 + pytest) runs a `BOOT → SETUP → ONLINE → {IDLE|ACTIVE}` state machine: a captive-portal Flask app gathers home-WiFi creds in SETUP, then a device HTTP client calls `register`/`heartbeat` to drive the device into ACTIVE (the existing capture loop). **Cloud-side bracket persistence (migration + `cameraRegistration` + `pre-register` validation + `register`/`heartbeat` placement emit) is owned by sub-project F, NOT E** (contract §0); this plan only VERIFIES those endpoints (Task 0) and CONSUMES them from the device (Slice 3a). All cross-repo behavior conforms to the **E↔F Integration Contract** (`docs/superpowers/specs/2026-06-13-E-F-integration-contract.md`) — where it disagrees with the E source spec, the contract wins (notably: 4-state `setup-status` enum, identity-only `register`, F-owned cloud bracket files, and the canonical `{north, south, null}` bracket enum vocabulary).

**Tech Stack:** Next.js App Router + vitest (`vi.mock('@/app/lib/db')`, `// @vitest-environment node`) for cloud; python3.11 + pytest + `requests`/`responses` for firmware; Flask for the captive portal; `hostapd` + `dnsmasq` + `wpa_supplicant` for AP/DHCP/DNS; bash + `qrencode` for provisioning.

**CLOUD vs FIRMWARE legend:** Each task is tagged `[CLOUD]` or `[FIRMWARE]`. Tasks tagged `⚠️ HARDWARE-GATED` cannot be unit-tested and must be validated on a real Pi (per spec §6.3/§6.4); they ship config/scripts whose *content* is reviewed in this plan but whose *behavior* is verified manually.

---

## Slice 0 — Pre-flight verification (CLOUD)

The contract (§2.2, D-6) says `setup-status` **already exists** and already returns the authoritative 4-state enum. Verify before touching it.

### Task 0: Verify existing cloud surface

**Files:**
- Read: `app/api/cameras/setup-status/[claim_code]/route.ts`
- Read: `app/api/cameras/setup-status/[claim_code]/route.test.ts`
- Read: `app/api/cameras/register/route.ts`, `app/api/cameras/[id]/heartbeat/route.ts`

- [ ] **Step 1: Run the existing cloud suites to confirm green baseline**

Run: `cd /Users/jessekauppila/GitHub/the-sunset-webcam-map && npx vitest run app/api/cameras/setup-status app/api/cameras/register app/api/cameras/pre-register 'app/api/cameras/[id]/heartbeat'`
Expected: PASS. Confirms `setup-status` returns `awaiting_wifi | registered | awaiting_aim | ready` (Task 1 needs no new endpoint), `register` returns `placement_status`, either-order is wired.

- [ ] **Step 2: Record findings (no code change)**

`setup-status` already conforms to contract §2.2. `register.placement_status` already conforms to §3.2 (`awaiting_location | awaiting_aim | ready`). Either-order (Amendment A) is IMPLEMENTED. Heartbeat placement-delivery (Amendment C) is IMPLEMENTED. **The remaining cloud gap is bracket provenance (contract §4.3, divergence D-3) — but that work is OWNED BY SUB-PROJECT F, not E** (see the dependency note below). E only VERIFIES those endpoints and consumes them.

- [ ] **Step 3: Verify the bracket-provenance shape F will add (read-only)**

Confirm (read-only, no edits) that the F plan's Tasks 4–7 land `azimuth_source`/`coarse`/`bracket` in the migration, `cameraRegistration.ts`, `pre-register`, and the `register`/`heartbeat` placement blocks. E's device-side register client + heartbeat-poll loop (Slice 3a) consume exactly that shape. **E must not author these cloud files.**

---

## Cloud bracket persistence — owned by sub-project F (DEPENDENCY NOTE)

> **Cloud bracket persistence is owned by sub-project F (see F plan Tasks 4–7 and
> integration contract §0 "Cloud file ownership"). E's Task 0 only VERIFIES these
> endpoints exist and consumes them.**
>
> Specifically, F owns and authors all of:
> - `database/migrations/20260613_cameras_bracket_provenance.sql` (F Task 4)
> - `app/lib/cameraRegistration.ts` — `CameraUpsertInput` + `upsertCameraByClaimCode` (F Task 5)
> - `app/api/cameras/pre-register/route.ts` — `parseBracket` validation, the single
>   canonical validator (F Task 6)
> - `app/api/cameras/register/route.ts` + `app/api/cameras/[id]/heartbeat/route.ts` —
>   the `azimuth_source`/`coarse`/`bracket` SELECT + `placement` emit blocks (F Task 7)
>
> The earlier E-plan drafts of these as Slices 1–2 (a duplicate migration, a duplicate
> `pre-register` validator with the now-stale `SIDE_VALUES=['left','right']` /
> `FLIP_VALUES=['up','down','left','right']`, and duplicate `register`/`heartbeat`/
> `cameraRegistration` edits) are **removed** to avoid two plans authoring the same
> files and to drop the stale enum vocabulary. The canonical validator is F's
> null-tolerant `parseBracket` over `{north, south, null}` (contract Fix 1).
>
> **Migration ordering (contract §4.3 / Fix 5):** F applies the forward-only,
> idempotent migration to the DB BEFORE shipping the route code that SELECTs the new
> columns, else `register`/`heartbeat` 500 for every camera. E's hardware smoke
> (Slice 8) assumes F has already deployed migration + routes.
>
> The one cloud edit E keeps is `app/api/admin/claim-codes/route.ts` `ttlDays`
> forwarding (Task 16b) — it is on the provisioning path, not the bracket-persistence
> path.

---

## Slice 3 — Firmware: BOOT state machine + capture loop extraction (FIRMWARE)

Per E-spec §8.4 + §5.3 and contract §2.1. Today `main.py` *is* the ACTIVE capture loop and `supervisor.py` already drives `aiming/capture/idle` from `placement_status`. We add a `boot.py` that decides SETUP vs ONLINE at boot from WiFi-cred presence, and an explicit state enum the supervisor reports. The contract (D-4) says: **non-`ready` ⇒ IDLE/poll** — `decide_mode` already does this. We extend it to recognize SETUP and ACTIVE explicitly without breaking the existing 4 supervisor tests.

### Task 6: WiFi-cred presence check (`has_wifi_credentials`)

**Files:**
- Create: `src/sunset_cam/wifi_creds.py`
- Test: `tests/test_wifi_creds.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_wifi_creds.py`:

```python
from sunset_cam.wifi_creds import has_wifi_credentials


def test_missing_file_means_no_creds(tmp_path):
    assert has_wifi_credentials(tmp_path / "absent.conf") is False


def test_empty_file_means_no_creds(tmp_path):
    p = tmp_path / "wpa.conf"
    p.write_text("ctrl_interface=/var/run/wpa_supplicant\nupdate_config=1\n")
    assert has_wifi_credentials(p) is False


def test_network_block_with_ssid_means_creds(tmp_path):
    p = tmp_path / "wpa.conf"
    p.write_text(
        'ctrl_interface=/var/run/wpa_supplicant\nupdate_config=1\n'
        'network={\n    ssid="HomeWiFi"\n    psk="hunter2"\n}\n'
    )
    assert has_wifi_credentials(p) is True


def test_network_block_without_ssid_is_not_creds(tmp_path):
    p = tmp_path / "wpa.conf"
    p.write_text('network={\n    key_mgmt=NONE\n}\n')
    assert has_wifi_credentials(p) is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/jessekauppila/GitHub/sunset-cam-firmware/.claude/worktrees/bench-supervisor && python -m pytest tests/test_wifi_creds.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'sunset_cam.wifi_creds'`

- [ ] **Step 3: Write minimal implementation**

Create `src/sunset_cam/wifi_creds.py`:

```python
"""Decide at boot whether the device already has usable WiFi credentials.
A 'network={ ... ssid="..." ... }' block in wpa_supplicant.conf counts; the
boilerplate header alone does not. Used by boot.py to pick SETUP vs ONLINE."""
from __future__ import annotations

import re
from pathlib import Path

WPA_SUPPLICANT_PATH = "/etc/wpa_supplicant/wpa_supplicant.conf"

_NETWORK_BLOCK = re.compile(r"network\s*=\s*\{(.*?)\}", re.DOTALL)
_SSID = re.compile(r'\bssid\s*=\s*"[^"]+"')


def has_wifi_credentials(path: str | Path = WPA_SUPPLICANT_PATH) -> bool:
    p = Path(path)
    if not p.exists():
        return False
    text = p.read_text()
    for block in _NETWORK_BLOCK.findall(text):
        if _SSID.search(block):
            return True
    return False
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/jessekauppila/GitHub/sunset-cam-firmware/.claude/worktrees/bench-supervisor && python -m pytest tests/test_wifi_creds.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/sunset_cam/wifi_creds.py tests/test_wifi_creds.py
git commit -m "feat(firmware): detect usable WiFi credentials at boot"
```

### Task 7: Boot decision (`decide_boot_state`) + SETUP service control

**Files:**
- Create: `src/sunset_cam/boot.py`
- Modify: `src/sunset_cam/service_control.py`
- Test: `tests/test_boot.py`, `tests/test_service_control.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/test_boot.py`:

```python
from sunset_cam.boot import decide_boot_state


def test_no_creds_goes_to_setup():
    assert decide_boot_state(has_creds=False) == "setup"


def test_creds_present_goes_to_online():
    assert decide_boot_state(has_creds=True) == "online"


def test_creds_present_but_association_fails_re_enters_setup():
    # Relocation (contract §11a): a camera moved to a NEW network still has the OLD
    # creds on disk, so has_creds=True, but the radio cannot associate. After the
    # bounded try-associate window (~15s) fails, the device must DROP TO SETUP and
    # re-run onboarding — no new trigger, just association failure.
    assert decide_boot_state(has_creds=True, associated=False) == "setup"
    assert decide_boot_state(has_creds=True, associated=True) == "online"
```

Append to `tests/test_service_control.py`:

```python
def test_setup_mode_stops_capture_and_aiming_starts_setup():
    from sunset_cam.service_control import SETUP_UNIT
    c, calls = _controller()
    c.set_mode("setup")
    assert ["stop", CAPTURE_UNIT] in calls
    assert ["stop", AIMING_UNIT] in calls
    assert ["start", SETUP_UNIT] in calls


def test_capture_mode_also_stops_setup():
    from sunset_cam.service_control import SETUP_UNIT
    c, calls = _controller()
    c.set_mode("capture")
    assert ["stop", SETUP_UNIT] in calls
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/jessekauppila/GitHub/sunset-cam-firmware/.claude/worktrees/bench-supervisor && python -m pytest tests/test_boot.py tests/test_service_control.py -v`
Expected: FAIL — no `sunset_cam.boot`; `SETUP_UNIT` not exported; `set_mode("setup")` unhandled.

- [ ] **Step 3: Write minimal implementation**

Create `src/sunset_cam/boot.py`:

```python
"""First decision after power-on (contract §2.1/§11a, E-spec §5.3): with no usable
WiFi credentials the device enters SETUP (captive portal up); otherwise it tries to
associate and, on success, goes ONLINE and lets the supervisor drive IDLE/ACTIVE from
placement_status. RELOCATION: a unit moved to a NEW network still has the OLD creds on
disk (has_creds=True) but cannot associate; after the bounded try-associate window
(~15s) fails (`associated=False`) it falls back to SETUP and re-runs onboarding — no
new trigger, association failure IS the trigger."""
from __future__ import annotations


def decide_boot_state(has_creds: bool, associated: bool = True) -> str:
    # No creds, or creds that no longer associate (moved to a new network) => SETUP.
    if not has_creds or not associated:
        return "setup"
    return "online"
```

In `src/sunset_cam/service_control.py`, add the SETUP unit constant after `CAPTURE_UNIT`:

```python
SETUP_UNIT = "sunset-cam-setup.service"
```

Replace the `set_mode` body to handle `setup` and to stop SETUP in the other modes:

```python
    def set_mode(self, mode: str) -> None:
        if mode == "setup":
            self._run(["stop", CAPTURE_UNIT])
            self._run(["stop", AIMING_UNIT])
            self._run(["start", SETUP_UNIT])
        elif mode == "aiming":
            self._run(["stop", SETUP_UNIT])
            self._run(["stop", CAPTURE_UNIT])
            self._run(["start", AIMING_UNIT])
        elif mode == "capture":
            self._run(["stop", SETUP_UNIT])
            self._run(["stop", AIMING_UNIT])
            self._run(["start", CAPTURE_UNIT])
        else:  # idle / unknown
            self._run(["stop", SETUP_UNIT])
            self._run(["stop", AIMING_UNIT])
            self._run(["stop", CAPTURE_UNIT])
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/jessekauppila/GitHub/sunset-cam-firmware/.claude/worktrees/bench-supervisor && python -m pytest tests/test_boot.py tests/test_service_control.py -v`
Expected: PASS (the original 3 service_control tests still pass — they assert membership, not exact call counts)

- [ ] **Step 5: Commit**

```bash
git add src/sunset_cam/boot.py src/sunset_cam/service_control.py tests/test_boot.py tests/test_service_control.py
git commit -m "feat(firmware): boot SETUP/ONLINE decision and setup-mode service control"
```

### Task 8: Supervisor reports explicit device state (SETUP/ONLINE/IDLE/ACTIVE)

**Files:**
- Modify: `src/sunset_cam/supervisor.py`
- Test: `tests/test_supervisor.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_supervisor.py`:

```python
from sunset_cam.supervisor import device_state


def test_device_state_maps_lifecycle():
    # contract §2.1/§2.3: non-ready => IDLE; ready => ACTIVE
    assert device_state(has_creds=False, placement_status=None) == "SETUP"
    assert device_state(has_creds=True, placement_status=None) == "ONLINE"
    assert device_state(has_creds=True, placement_status="awaiting_location") == "IDLE"
    assert device_state(has_creds=True, placement_status="awaiting_aim") == "IDLE"
    assert device_state(has_creds=True, placement_status="ready") == "ACTIVE"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/jessekauppila/GitHub/sunset-cam-firmware/.claude/worktrees/bench-supervisor && python -m pytest tests/test_supervisor.py::test_device_state_maps_lifecycle -v`
Expected: FAIL — `cannot import name 'device_state'`

- [ ] **Step 3: Write minimal implementation**

In `src/sunset_cam/supervisor.py`, add after `decide_mode`:

```python
def device_state(has_creds: bool, placement_status) -> str:
    """The contract's four device states (§2.1). SETUP when there are no WiFi
    creds; otherwise driven by placement_status — anything other than 'ready'
    means IDLE/poll (contract D-4)."""
    if not has_creds:
        return "SETUP"
    if placement_status == "ready":
        return "ACTIVE"
    if placement_status is None:
        return "ONLINE"
    return "IDLE"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/jessekauppila/GitHub/sunset-cam-firmware/.claude/worktrees/bench-supervisor && python -m pytest tests/test_supervisor.py -v`
Expected: PASS (existing supervisor tests unaffected)

- [ ] **Step 5: Commit**

```bash
git add src/sunset_cam/supervisor.py tests/test_supervisor.py
git commit -m "feat(firmware): supervisor reports explicit SETUP/ONLINE/IDLE/ACTIVE state"
```

> **Note on capture-loop extraction:** the contract (D-2) makes the device half identity-only and the existing `main.py` capture loop *is* the ACTIVE branch, started by `set_mode("capture")` → `sunset-cam.service`. No code move is needed; the ACTIVE branch is already a separate systemd unit. This task only adds the explicit state label the spec asked for.

---

## Slice 3a — Firmware: device HTTP client (register + heartbeat-poll + placement consume) (FIRMWARE)

This is the **device half of the E↔F rendezvous** (contract §3, §5, §6 timeline steps 6, 11, 12). Slice 3 only labels states; this slice makes `SETUP→ONLINE→register→IDLE→heartbeat→ACTIVE` real code that actually calls the cloud, persists the device token, and consumes placement (incl. the bracket signals F emits per Slice 3a's dependency note). All HTTP is mocked in tests via `responses`/injected `requests`-style runners — no live network.

### Task 8a: Register client — POST /api/cameras/register on reaching ONLINE

**Files:**
- Create: `src/sunset_cam/cloud_client.py`
- Test: `tests/test_cloud_client.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_cloud_client.py`:

```python
import json
from sunset_cam.cloud_client import register_device, RegisterResult


def _resp(status, body):
    return type("R", (), {
        "status_code": status,
        "json": lambda self: body,
        "text": json.dumps(body),
    })()


def test_register_persists_token_and_returns_idle_when_awaiting_location(tmp_path):
    posted = {}
    token_path = tmp_path / "device_token"

    def fake_post(url, json=None, headers=None, timeout=None):
        posted["url"] = url
        posted["json"] = json
        return _resp(200, {
            "camera_id": 17, "device_token": "deadbeef" * 8,
            "placement_status": "awaiting_location",
        })

    result = register_device(
        api_base="https://x", claim_code="SUNSET-7K3M-9XQ2",
        hardware_id="pi-zero-2w-abc", firmware_version="0.3.0",
        capabilities={"lens": "wide_120"},
        token_path=token_path, poster=fake_post,
    )
    assert isinstance(result, RegisterResult)
    assert result.camera_id == 17
    assert result.next_state == "IDLE"            # placement_status != ready -> IDLE
    assert result.placement is None
    assert token_path.read_text().strip() == "deadbeef" * 8   # persisted to /etc/sunset-cam
    assert posted["json"]["claim_code"] == "SUNSET-7K3M-9XQ2"
    assert posted["json"]["hardware_id"] == "pi-zero-2w-abc"
    assert posted["json"]["capabilities"] == {"lens": "wide_120"}


def test_register_ready_goes_straight_to_active_with_placement(tmp_path):
    def fake_post(url, json=None, headers=None, timeout=None):
        return _resp(200, {
            "camera_id": 18, "device_token": "f00d" * 16,
            "placement_status": "ready",
            "placement": {"azimuth_deg": 271.4, "azimuth_source": "bracket", "coarse": True},
        })

    result = register_device(
        api_base="https://x", claim_code="SUNSET-AAAA-BBBB",
        hardware_id="pi-2", firmware_version="0.3.0", capabilities={},
        token_path=tmp_path / "device_token", poster=fake_post,
    )
    assert result.next_state == "ACTIVE"
    assert result.placement["azimuth_source"] == "bracket"


def test_register_409_consumed_is_surfaced(tmp_path):
    def fake_post(url, json=None, headers=None, timeout=None):
        return _resp(409, {"error": "code already consumed"})

    result = register_device(
        api_base="https://x", claim_code="SUNSET-DEAD-BEEF",
        hardware_id="pi-3", firmware_version="0.3.0", capabilities={},
        token_path=tmp_path / "device_token", poster=fake_post,
    )
    assert result.next_state == "ERROR"
    assert result.error and "409" in result.error
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/jessekauppila/GitHub/sunset-cam-firmware/.claude/worktrees/bench-supervisor && python -m pytest tests/test_cloud_client.py -v`
Expected: FAIL — `No module named 'sunset_cam.cloud_client'`

- [ ] **Step 3: Write minimal implementation**

Create `src/sunset_cam/cloud_client.py`:

```python
"""Device-side HTTP client for the E<->F rendezvous (contract §3/§5/§6).
On reaching ONLINE the device POSTs /api/cameras/register, persists the returned
device_token to /etc/sunset-cam, and maps placement_status to the next device
state (anything != 'ready' -> IDLE, per contract D-4). In IDLE it polls
/api/cameras/<id>/heartbeat with request_placement:true until placement is ready.
All network calls go through an injectable `poster` so this is fully unit-testable."""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Optional

DEVICE_TOKEN_PATH = "/etc/sunset-cam/device_token"
Poster = Callable[..., Any]


@dataclass
class RegisterResult:
    camera_id: Optional[int]
    device_token: Optional[str]
    placement_status: Optional[str]
    placement: Optional[dict]
    next_state: str            # "IDLE" | "ACTIVE" | "ERROR"
    error: Optional[str] = None


def _next_state(placement_status: Optional[str]) -> str:
    # contract D-4: non-'ready' => IDLE/poll; 'ready' => ACTIVE.
    return "ACTIVE" if placement_status == "ready" else "IDLE"


def register_device(
    *, api_base: str, claim_code: str, hardware_id: str,
    firmware_version: str, capabilities: dict,
    token_path: str | Path = DEVICE_TOKEN_PATH,
    poster: Optional[Poster] = None,
) -> RegisterResult:
    if poster is None:
        import requests
        poster = requests.post

    resp = poster(
        f"{api_base.rstrip('/')}/api/cameras/register",
        json={
            "claim_code": claim_code,
            "hardware_id": hardware_id,
            "firmware_version": firmware_version,
            "capabilities": capabilities,
        },
        headers={"Content-Type": "application/json"},
        timeout=20,
    )
    if resp.status_code not in (200, 201):
        return RegisterResult(None, None, None, None, "ERROR",
                              error=f"register HTTP {resp.status_code}: {getattr(resp, 'text', '')}")
    body = resp.json()
    token = body.get("device_token")
    if token:
        p = Path(token_path)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(token + "\n")
    status = body.get("placement_status")
    return RegisterResult(
        camera_id=body.get("camera_id"),
        device_token=token,
        placement_status=status,
        placement=body.get("placement"),
        next_state=_next_state(status),
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/jessekauppila/GitHub/sunset-cam-firmware/.claude/worktrees/bench-supervisor && python -m pytest tests/test_cloud_client.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/sunset_cam/cloud_client.py tests/test_cloud_client.py
git commit -m "feat(firmware): device register client persists token, maps placement_status"
```

### Task 8b: Heartbeat-poll loop — IDLE polls until placement ready

**Files:**
- Modify: `src/sunset_cam/cloud_client.py`
- Test: `tests/test_cloud_client.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_cloud_client.py`:

```python
from sunset_cam.cloud_client import heartbeat_once, poll_for_placement


def test_heartbeat_once_requests_placement_with_bearer(tmp_path):
    seen = {}

    def fake_post(url, json=None, headers=None, timeout=None):
        seen["url"] = url
        seen["json"] = json
        seen["headers"] = headers
        return type("R", (), {"status_code": 200,
                              "json": lambda self: {"placement_status": "awaiting_location"},
                              "text": ""})()

    hb = heartbeat_once(api_base="https://x", camera_id=17, device_token="tok",
                        poster=fake_post)
    assert "/api/cameras/17/heartbeat" in seen["url"]
    assert seen["json"] == {"request_placement": True}
    assert seen["headers"]["Authorization"] == "Bearer tok"
    assert hb["placement_status"] == "awaiting_location"


def test_poll_for_placement_uses_bounded_backoff_and_returns_when_ready():
    statuses = ["awaiting_location", "awaiting_location", "ready"]
    sleeps = []
    calls = {"n": 0}

    def fake_hb(**kw):
        i = calls["n"]; calls["n"] += 1
        s = statuses[i]
        body = {"placement_status": s}
        if s == "ready":
            body["placement"] = {"azimuth_source": "bracket", "coarse": True, "azimuth_deg": 271.4}
        return body

    result = poll_for_placement(
        api_base="https://x", camera_id=17, device_token="tok",
        heartbeat=fake_hb, sleep=lambda s: sleeps.append(s),
        base_interval_s=30, max_interval_s=300, max_attempts=10,
    )
    assert result["placement_status"] == "ready"
    assert result["placement"]["azimuth_source"] == "bracket"
    assert calls["n"] == 3
    # bounded backoff: monotonic non-decreasing, capped at max_interval_s
    assert sleeps == sorted(sleeps)
    assert all(s <= 300 for s in sleeps)


def test_poll_for_placement_gives_up_after_max_attempts():
    def fake_hb(**kw):
        return {"placement_status": "awaiting_location"}

    result = poll_for_placement(
        api_base="https://x", camera_id=17, device_token="tok",
        heartbeat=fake_hb, sleep=lambda s: None,
        base_interval_s=30, max_interval_s=300, max_attempts=3,
    )
    assert result is None   # abandoned-flow guard (contract LC-4): does not poll forever
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/jessekauppila/GitHub/sunset-cam-firmware/.claude/worktrees/bench-supervisor && python -m pytest tests/test_cloud_client.py -k 'heartbeat or poll' -v`
Expected: FAIL — `heartbeat_once`/`poll_for_placement` not defined.

- [ ] **Step 3: Write minimal implementation**

Append to `src/sunset_cam/cloud_client.py`:

```python
def heartbeat_once(
    *, api_base: str, camera_id: int, device_token: str,
    request_placement: bool = True, poster: Optional[Poster] = None,
) -> dict:
    if poster is None:
        import requests
        poster = requests.post
    resp = poster(
        f"{api_base.rstrip('/')}/api/cameras/{camera_id}/heartbeat",
        json={"request_placement": request_placement},
        headers={"Authorization": f"Bearer {device_token}",
                 "Content-Type": "application/json"},
        timeout=20,
    )
    return resp.json()


def poll_for_placement(
    *, api_base: str, camera_id: int, device_token: str,
    heartbeat: Optional[Callable[..., dict]] = None,
    sleep: Callable[[float], None] | None = None,
    base_interval_s: float = 30.0, max_interval_s: float = 300.0,
    max_attempts: int = 240,
) -> Optional[dict]:
    """IDLE loop: heartbeat with request_placement:true on a BOUNDED backoff
    (contract LC-4 — a device whose recipient abandons the wizard must not poll
    forever). Returns the ready heartbeat body, or None if it gives up."""
    import time as _time
    if heartbeat is None:
        heartbeat = lambda **kw: heartbeat_once(**kw)   # noqa: E731
    if sleep is None:
        sleep = _time.sleep

    interval = base_interval_s
    for _ in range(max_attempts):
        body = heartbeat(api_base=api_base, camera_id=camera_id, device_token=device_token)
        if body.get("placement_status") == "ready":
            return body
        sleep(interval)
        interval = min(interval * 1.5, max_interval_s)   # bounded backoff
    return None
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/jessekauppila/GitHub/sunset-cam-firmware/.claude/worktrees/bench-supervisor && python -m pytest tests/test_cloud_client.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/sunset_cam/cloud_client.py tests/test_cloud_client.py
git commit -m "feat(firmware): IDLE heartbeat-poll loop with bounded backoff"
```

### Task 8c: Placement consumer — choose sun-refine vs legacy precise

**Files:**
- Create: `src/sunset_cam/placement_consume.py`
- Test: `tests/test_placement_consume.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_placement_consume.py`:

```python
from sunset_cam.placement_consume import apply_placement, RefineMode


def test_bracket_coarse_enables_sun_self_refine(tmp_path):
    placement = {"azimuth_deg": 271.4, "tilt_deg": 0,
                 "azimuth_source": "bracket", "coarse": True,
                 "bracket": {"lens": "wide_120", "wedge_angle_deg": 8}}
    decision = apply_placement(placement, placement_path=tmp_path / "placement.json")
    assert decision.mode == RefineMode.SUN_SELF_REFINE
    # placement persisted for the capture/aiming loop
    assert (tmp_path / "placement.json").exists()


def test_non_bracket_uses_legacy_precise(tmp_path):
    placement = {"azimuth_deg": 270.0, "tilt_deg": 5,
                 "azimuth_source": "sun", "coarse": False}
    decision = apply_placement(placement, placement_path=tmp_path / "placement.json")
    assert decision.mode == RefineMode.LEGACY_PRECISE


def test_missing_signals_defaults_to_legacy_precise(tmp_path):
    placement = {"azimuth_deg": 270.0, "tilt_deg": 0}   # no azimuth_source/coarse
    decision = apply_placement(placement, placement_path=tmp_path / "placement.json")
    assert decision.mode == RefineMode.LEGACY_PRECISE
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/jessekauppila/GitHub/sunset-cam-firmware/.claude/worktrees/bench-supervisor && python -m pytest tests/test_placement_consume.py -v`
Expected: FAIL — `No module named 'sunset_cam.placement_consume'`

- [ ] **Step 3: Write minimal implementation**

Create `src/sunset_cam/placement_consume.py`:

```python
"""Consume the placement block delivered by register/heartbeat (contract §4.3.5,
PR-1). When azimuth_source=='bracket' AND coarse is truthy, the realized aim is
COARSE and the Pi must run the on-device sun self-refine; otherwise the aim is
assumed precise (legacy) and refine stays off. Persists the placement for the
capture/aiming loop."""
from __future__ import annotations

import json
from dataclasses import dataclass
from enum import Enum
from pathlib import Path

PLACEMENT_PATH = "/etc/sunset-cam/placement.json"


class RefineMode(str, Enum):
    SUN_SELF_REFINE = "sun_self_refine"
    LEGACY_PRECISE = "legacy_precise"


@dataclass
class PlacementDecision:
    mode: RefineMode
    placement: dict


def apply_placement(placement: dict, placement_path: str | Path = PLACEMENT_PATH) -> PlacementDecision:
    p = Path(placement_path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(placement))

    coarse = bool(placement.get("coarse"))
    is_bracket = placement.get("azimuth_source") == "bracket"
    mode = RefineMode.SUN_SELF_REFINE if (is_bracket and coarse) else RefineMode.LEGACY_PRECISE
    return PlacementDecision(mode=mode, placement=placement)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/jessekauppila/GitHub/sunset-cam-firmware/.claude/worktrees/bench-supervisor && python -m pytest tests/test_placement_consume.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/sunset_cam/placement_consume.py tests/test_placement_consume.py
git commit -m "feat(firmware): placement consumer selects sun-refine vs legacy precise"
```

### Task 8d: Wire register + heartbeat-poll + placement into the boot/supervisor path

**Files:**
- Modify: `src/sunset_cam/supervisor.py`
- Test: `tests/test_supervisor.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_supervisor.py`:

```python
from sunset_cam.supervisor import run_online_rendezvous


def test_online_rendezvous_register_first_then_heartbeat_to_active(tmp_path):
    transitions = []

    def fake_register(**kw):
        from sunset_cam.cloud_client import RegisterResult
        return RegisterResult(camera_id=17, device_token="tok",
                              placement_status="awaiting_location", placement=None,
                              next_state="IDLE")

    def fake_poll(**kw):
        return {"placement_status": "ready",
                "placement": {"azimuth_source": "bracket", "coarse": True, "azimuth_deg": 271.4}}

    final = run_online_rendezvous(
        api_base="https://x", claim_code="SUNSET-7K3M-9XQ2",
        hardware_id="pi-1", firmware_version="0.3.0", capabilities={},
        register=fake_register, poll=fake_poll,
        on_state=lambda s: transitions.append(s),
        placement_path=tmp_path / "placement.json",
        token_path=tmp_path / "device_token",
    )
    # SETUP->ONLINE happened before this call; here: register -> IDLE -> heartbeat -> ACTIVE
    assert transitions == ["IDLE", "ACTIVE"]
    assert final.mode.value == "sun_self_refine"   # bracket+coarse -> refine


def test_online_rendezvous_pre_register_first_skips_idle():
    transitions = []

    def fake_register(**kw):
        from sunset_cam.cloud_client import RegisterResult
        return RegisterResult(camera_id=18, device_token="tok",
                              placement_status="ready",
                              placement={"azimuth_source": "sun", "coarse": False, "azimuth_deg": 270.0},
                              next_state="ACTIVE")

    final = run_online_rendezvous(
        api_base="https://x", claim_code="SUNSET-AAAA-BBBB",
        hardware_id="pi-2", firmware_version="0.3.0", capabilities={},
        register=fake_register, poll=lambda **kw: None,
        on_state=lambda s: transitions.append(s),
    )
    assert transitions == ["ACTIVE"]               # jumped straight to ACTIVE, no IDLE
    assert final.mode.value == "legacy_precise"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/jessekauppila/GitHub/sunset-cam-firmware/.claude/worktrees/bench-supervisor && python -m pytest tests/test_supervisor.py -k rendezvous -v`
Expected: FAIL — `cannot import name 'run_online_rendezvous'`

- [ ] **Step 3: Write minimal implementation**

In `src/sunset_cam/supervisor.py`, add (importing the Slice 3a clients):

```python
def run_online_rendezvous(
    *, api_base, claim_code, hardware_id, firmware_version, capabilities,
    register=None, poll=None, on_state=lambda s: None,
    placement_path=None, token_path=None,
):
    """Drives ONLINE -> register -> {IDLE -> heartbeat-poll} -> ACTIVE for real
    (contract §6 timeline steps 6, 11, 12). register-first lands in IDLE and
    polls heartbeat until placement is ready; pre-register-first returns 'ready'
    immediately and jumps straight to ACTIVE. Returns the PlacementDecision so
    the caller knows whether to run sun self-refine."""
    from sunset_cam.cloud_client import register_device, poll_for_placement
    from sunset_cam.placement_consume import apply_placement, PLACEMENT_PATH

    register = register or (lambda **kw: register_device(**kw))
    poll = poll or (lambda **kw: poll_for_placement(**kw))
    ppath = placement_path or PLACEMENT_PATH

    reg_kwargs = dict(api_base=api_base, claim_code=claim_code,
                      hardware_id=hardware_id, firmware_version=firmware_version,
                      capabilities=capabilities)
    if token_path is not None:
        reg_kwargs["token_path"] = token_path
    result = register(**reg_kwargs)
    if result.next_state == "ERROR":
        raise RuntimeError(result.error or "register failed")

    if result.next_state == "ACTIVE":
        on_state("ACTIVE")
        return apply_placement(result.placement, placement_path=ppath)

    # register-first: go IDLE, poll heartbeat until ready
    on_state("IDLE")
    ready = poll(api_base=api_base, camera_id=result.camera_id,
                 device_token=result.device_token)
    if ready is None:
        return None   # abandoned-flow guard (contract LC-4)
    on_state("ACTIVE")
    return apply_placement(ready["placement"], placement_path=ppath)
```

> Boot wiring: `boot.decide_boot_state` (Task 7) returns `"online"` when creds exist; the supervisor's online path then calls `run_online_rendezvous(...)` and, on an `ACTIVE` PlacementDecision, calls `set_mode("capture")` (Task 7/8). On `SUN_SELF_REFINE` it also enables the on-device sun self-refine loop (v0.3 self-calib path); on `LEGACY_PRECISE` it does not. This makes `SETUP→ONLINE→register→IDLE→heartbeat→ACTIVE` real code, not a label.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/jessekauppila/GitHub/sunset-cam-firmware/.claude/worktrees/bench-supervisor && python -m pytest tests/test_supervisor.py -v`
Expected: PASS (existing supervisor tests unaffected)

- [ ] **Step 5: Commit**

```bash
git add src/sunset_cam/supervisor.py tests/test_supervisor.py
git commit -m "feat(firmware): wire register->IDLE->heartbeat->ACTIVE rendezvous into supervisor"
```

### Task 8e: Honor a heartbeat `reprovision`/`wipe_wifi` directive (device half of decommission)

**Files:**
- Modify: `src/sunset_cam/cloud_client.py` (read the directive off the heartbeat body)
- Create: `src/sunset_cam/wifi_wipe.py` (clear `wpa_supplicant` creds → SETUP)
- Test: `tests/test_wifi_wipe.py`, append to `tests/test_cloud_client.py`

This is the **device half of a cloud-triggered decommission-with-relocation**
(contract §12 PD-1 / §13). When the camera is online and the operator/customer
decommissions-with-relocation (F plan Task 23), the next heartbeat response carries a
`reprovision`/`wipe_wifi` directive. The device clears its `wpa_supplicant` creds and
drops to SETUP (the existing BOOT path then re-onboards the new location). There is
**NO physical reset button** — this directive (plus association-failure, §11a) is how a
unit returns to SETUP.

- [ ] **Step 1: Write the failing tests**

`tests/test_wifi_wipe.py` — `wipe_wifi_credentials(path)` clears the creds with a
mocked filesystem/subprocess: it removes the `network={...}` block (or writes back the
header-only conf), leaving `has_wifi_credentials(path)` False afterward; it does NOT
delete unrelated config; it is idempotent (wiping an already-headerless conf is a
no-op). Inject the conf path and any `wpa_cli reconfigure` subprocess runner so no real
radio/FS is touched.

Append to `tests/test_cloud_client.py` — a heartbeat body carrying
`{"directive": "wipe_wifi"}` (or `{"reprovision": true}`) is recognized by a helper
(e.g. `wants_wifi_wipe(body) is True`) and a plain heartbeat body is not. Assert the
helper returns False for an absent/empty directive.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/jessekauppila/GitHub/sunset-cam-firmware/.claude/worktrees/bench-supervisor && python -m pytest tests/test_wifi_wipe.py tests/test_cloud_client.py -k 'wipe or reprovision or directive' -v`
Expected: FAIL — `wifi_wipe` / `wants_wifi_wipe` not defined.

- [ ] **Step 3: Write minimal implementation**

`src/sunset_cam/wifi_wipe.py` — `wipe_wifi_credentials(path=WPA_SUPPLICANT_PATH, runner=...)`
rewrites the conf to the header-only form (no `network={...}` block) via an injected
writer, then optionally runs `wpa_cli reconfigure` via the injected runner. Add
`wants_wifi_wipe(body: dict) -> bool` to `cloud_client.py` recognizing
`body.get("directive") == "wipe_wifi"` or `body.get("reprovision") is True`. Wire it
into the IDLE/ACTIVE heartbeat handling so that on the directive the device calls
`wipe_wifi_credentials()` and transitions back to SETUP (`set_mode("setup")`). Keep all
FS/subprocess injected so the path is fully unit-tested (no real radio).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/jessekauppila/GitHub/sunset-cam-firmware/.claude/worktrees/bench-supervisor && python -m pytest tests/test_wifi_wipe.py tests/test_cloud_client.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/sunset_cam/wifi_wipe.py src/sunset_cam/cloud_client.py tests/test_wifi_wipe.py tests/test_cloud_client.py
git commit -m "feat(firmware): honor heartbeat wipe_wifi/reprovision directive -> SETUP"
```

---

## Slice 4 — Firmware: captive-portal Flask app (FIRMWARE)

Per E-spec §8.5 + §5.5. Logic lives in a hardware-free `WifiSetupService` (subprocess + file IO injected) so it is fully unit-testable; the Flask layer is a thin adapter mirroring the `setup_server.py` pattern. Add `flask` to deps.

### Task 9: Add Flask dependency

**Files:**
- Modify: `pyproject.toml`, `requirements.txt`

- [ ] **Step 1: Add the dependency**

In `pyproject.toml`, add to `dependencies`:

```toml
  "flask>=3.0",
```

In `requirements.txt`, append `flask>=3.0`.

- [ ] **Step 2: Install and confirm import**

Run: `cd /Users/jessekauppila/GitHub/sunset-cam-firmware/.claude/worktrees/bench-supervisor && pip install -e '.[dev]' && python -c "import flask; print(flask.__version__)"`
Expected: prints a 3.x version

- [ ] **Step 3: Commit**

```bash
git add pyproject.toml requirements.txt
git commit -m "build(firmware): add flask for the captive-portal setup app"
```

### Task 10: `iwlist` scan parser

**Files:**
- Create: `src/sunset_cam/wifi_scan.py`
- Test: `tests/test_wifi_scan.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_wifi_scan.py`:

```python
from sunset_cam.wifi_scan import parse_iwlist

SAMPLE = """wlan0  Scan completed :
          Cell 01 - Address: AA:BB:CC:DD:EE:01
                    Channel:6
                    Signal level=-42 dBm
                    ESSID:"HomeWiFi"
          Cell 02 - Address: AA:BB:CC:DD:EE:02
                    Channel:36
                    Signal level=-70 dBm
                    ESSID:"HomeWiFi"
          Cell 03 - Address: AA:BB:CC:DD:EE:03
                    Channel:1
                    Signal level=-55 dBm
                    ESSID:"Neighbor"
          Cell 04 - Address: AA:BB:CC:DD:EE:04
                    Channel:11
                    Signal level=-80 dBm
                    ESSID:""
"""


def test_parse_dedups_by_ssid_keeping_strongest_and_drops_hidden():
    ssids = parse_iwlist(SAMPLE)
    # dual-band HomeWiFi collapses to one entry; hidden "" dropped; sorted by signal
    assert ssids == ["HomeWiFi", "Neighbor"]


def test_parse_empty_input():
    assert parse_iwlist("") == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/jessekauppila/GitHub/sunset-cam-firmware/.claude/worktrees/bench-supervisor && python -m pytest tests/test_wifi_scan.py -v`
Expected: FAIL — `No module named 'sunset_cam.wifi_scan'`

- [ ] **Step 3: Write minimal implementation**

Create `src/sunset_cam/wifi_scan.py`:

```python
"""Parse `iwlist wlan0 scan` output into a deduped, signal-sorted SSID list.
Pi Zero 2 W is 2.4GHz-only but home routers advertise dual-band under one
ESSID; we dedup by SSID and keep the strongest signal (E-spec §7 dual-band
risk). Hidden networks (empty ESSID) are dropped."""
from __future__ import annotations

import re

_ESSID = re.compile(r'ESSID:"([^"]*)"')
_SIGNAL = re.compile(r"Signal level=(-?\d+)")
_CELL = re.compile(r"Cell \d+ - ")


def parse_iwlist(text: str) -> list[str]:
    best: dict[str, int] = {}
    for chunk in _CELL.split(text)[1:]:
        m = _ESSID.search(chunk)
        if not m or m.group(1) == "":
            continue
        ssid = m.group(1)
        sig_m = _SIGNAL.search(chunk)
        signal = int(sig_m.group(1)) if sig_m else -999
        if ssid not in best or signal > best[ssid]:
            best[ssid] = signal
    return [s for s, _ in sorted(best.items(), key=lambda kv: kv[1], reverse=True)]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/jessekauppila/GitHub/sunset-cam-firmware/.claude/worktrees/bench-supervisor && python -m pytest tests/test_wifi_scan.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/sunset_cam/wifi_scan.py tests/test_wifi_scan.py
git commit -m "feat(firmware): parse iwlist scan into deduped SSID list"
```

### Task 11: `WifiSetupService` — wpa_supplicant write + join (mocked subprocess)

**Files:**
- Create: `src/sunset_cam/wifi_setup.py`
- Test: `tests/test_wifi_setup.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_wifi_setup.py`:

```python
from sunset_cam.wifi_setup import WifiSetupService, wpa_conf_block


def test_wpa_conf_block_escapes_and_shapes():
    block = wpa_conf_block("HomeWiFi", "p@ss")
    assert 'ssid="HomeWiFi"' in block
    assert 'psk="p@ss"' in block
    assert block.strip().startswith("network={")


def test_scan_uses_injected_runner():
    svc = WifiSetupService(
        scan_runner=lambda: 'Cell 01 - Address: X\n    ESSID:"Net"\n    Signal level=-40 dBm\n',
        join_runner=lambda ssid, pw: True,
        conf_writer=lambda text: None,
    )
    assert svc.scan_ssids() == ["Net"]


def test_submit_writes_conf_then_joins_on_success():
    written = []
    joined = []
    svc = WifiSetupService(
        scan_runner=lambda: "",
        join_runner=lambda ssid, pw: joined.append((ssid, pw)) or True,
        conf_writer=lambda text: written.append(text),
    )
    result = svc.submit_credentials("HomeWiFi", "hunter2")
    assert result["status"] == "joined"
    assert joined == [("HomeWiFi", "hunter2")]
    assert 'ssid="HomeWiFi"' in written[0]


def test_submit_does_not_persist_conf_when_join_fails():
    written = []
    svc = WifiSetupService(
        scan_runner=lambda: "",
        join_runner=lambda ssid, pw: False,
        conf_writer=lambda text: written.append(text),
    )
    result = svc.submit_credentials("HomeWiFi", "wrongpass")
    assert result["status"] == "failed"
    assert result["reason"]
    assert written == []  # creds are NOT persisted on failure (E-spec §5.3 halt cond)


def test_submit_rejects_blank_ssid():
    svc = WifiSetupService(scan_runner=lambda: "", join_runner=lambda s, p: True, conf_writer=lambda t: None)
    result = svc.submit_credentials("", "pw")
    assert result["status"] == "failed"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/jessekauppila/GitHub/sunset-cam-firmware/.claude/worktrees/bench-supervisor && python -m pytest tests/test_wifi_setup.py -v`
Expected: FAIL — `No module named 'sunset_cam.wifi_setup'`

- [ ] **Step 3: Write minimal implementation**

Create `src/sunset_cam/wifi_setup.py`:

```python
"""Captive-portal setup logic, hardware-free and injectable so it is fully
unit-testable. The Flask adapter (setup_app.py) wires the real subprocess
runners. On a failed join we deliberately do NOT persist the conf (E-spec §5.3
halt condition): the next form attempt shows "wrong password?"."""
from __future__ import annotations

from typing import Callable

from sunset_cam.wifi_scan import parse_iwlist

WPA_HEADER = "ctrl_interface=DIR=/var/run/wpa_supplicant GROUP=netdev\nupdate_config=1\ncountry=US\n"


def wpa_conf_block(ssid: str, password: str) -> str:
    return f'network={{\n    ssid="{ssid}"\n    psk="{password}"\n}}\n'


class WifiSetupService:
    def __init__(
        self,
        *,
        scan_runner: Callable[[], str],
        join_runner: Callable[[str, str], bool],
        conf_writer: Callable[[str], None],
    ) -> None:
        self._scan = scan_runner
        self._join = join_runner
        self._write_conf = conf_writer

    def scan_ssids(self) -> list[str]:
        return parse_iwlist(self._scan())

    def submit_credentials(self, ssid: str, password: str) -> dict:
        if not ssid:
            return {"status": "failed", "reason": "ssid is required"}
        if not self._join(ssid, password):
            # do NOT write the conf — failed creds must not stick
            return {"status": "failed", "reason": f"could not connect to {ssid}"}
        self._write_conf(WPA_HEADER + wpa_conf_block(ssid, password))
        return {"status": "joined", "ssid": ssid}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/jessekauppila/GitHub/sunset-cam-firmware/.claude/worktrees/bench-supervisor && python -m pytest tests/test_wifi_setup.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/sunset_cam/wifi_setup.py tests/test_wifi_setup.py
git commit -m "feat(firmware): WifiSetupService writes wpa_supplicant conf and joins"
```

### Task 12: Flask app + captive-portal catch-all routes

**Files:**
- Create: `src/sunset_cam/setup_app.py`
- Test: `tests/test_setup_app.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_setup_app.py`:

```python
from sunset_cam.wifi_setup import WifiSetupService
from sunset_cam.setup_app import create_app


def _service(join_ok=True):
    return WifiSetupService(
        scan_runner=lambda: 'Cell 01 - Address: X\n    ESSID:"HomeWiFi"\n    Signal level=-40 dBm\n',
        join_runner=lambda ssid, pw: join_ok,
        conf_writer=lambda text: None,
    )


def _client(svc):
    app = create_app(svc)
    app.testing = True
    return app.test_client()


def test_root_serves_form_with_scanned_ssids():
    c = _client(_service())
    resp = c.get("/")
    assert resp.status_code == 200
    assert b"HomeWiFi" in resp.data
    assert b"<form" in resp.data


def test_post_wifi_joined():
    c = _client(_service(join_ok=True))
    resp = c.post("/wifi", json={"ssid": "HomeWiFi", "password": "pw"})
    assert resp.status_code == 200
    assert resp.get_json()["status"] == "joined"


def test_post_wifi_failed_returns_422():
    c = _client(_service(join_ok=False))
    resp = c.post("/wifi", json={"ssid": "HomeWiFi", "password": "bad"})
    assert resp.status_code == 422
    assert resp.get_json()["status"] == "failed"


def test_captive_probe_redirects_to_root():
    c = _client(_service())
    for probe in ("/generate_204", "/hotspot-detect.html", "/anything-else"):
        resp = c.get(probe)
        assert resp.status_code == 302
        assert resp.headers["Location"].endswith("/")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/jessekauppila/GitHub/sunset-cam-firmware/.claude/worktrees/bench-supervisor && python -m pytest tests/test_setup_app.py -v`
Expected: FAIL — `No module named 'sunset_cam.setup_app'`

- [ ] **Step 3: Write minimal implementation**

Create `src/sunset_cam/setup_app.py`:

```python
"""Flask captive-portal app for SETUP mode (E-spec §5.5). Single WiFi-credential
form at GET /; POST /wifi submits {ssid,password}; every other path 302s to /
so iOS/Android captive-portal probes auto-pop the system browser sheet. Logic
delegates to an injected WifiSetupService so this layer is a thin adapter."""
from __future__ import annotations

from flask import Flask, jsonify, redirect, request

from sunset_cam.wifi_setup import WifiSetupService

_FORM = """<!doctype html><html><head><meta name=viewport content="width=device-width,initial-scale=1">
<title>Sunset Cam setup</title></head><body>
<h1>Connect your camera to WiFi</h1>
<form method="post" action="/wifi" onsubmit="return submitWifi(event)">
<label>Network<select name="ssid" id="ssid">{options}</select></label>
<label>Password<input type="password" name="password" id="password"></label>
<button type="submit">Connect</button></form>
<p id="status"></p>
<script>
async function submitWifi(e){{e.preventDefault();
 const r=await fetch('/wifi',{{method:'POST',headers:{{'Content-Type':'application/json'}},
  body:JSON.stringify({{ssid:document.getElementById('ssid').value,
   password:document.getElementById('password').value}})}});
 const j=await r.json();
 document.getElementById('status').textContent =
  j.status==='joined' ? 'Joined! Reconnect your phone to home WiFi and return to the setup tab.'
   : ('Could not connect. Wrong password?');
 return false;}}
</script></body></html>"""


def create_app(service: WifiSetupService) -> Flask:
    app = Flask(__name__)

    @app.get("/")
    def index():
        options = "".join(f'<option value="{s}">{s}</option>' for s in service.scan_ssids())
        return _FORM.format(options=options), 200, {"Content-Type": "text/html; charset=utf-8"}

    @app.post("/wifi")
    def wifi():
        body = request.get_json(silent=True) or {}
        result = service.submit_credentials(body.get("ssid", ""), body.get("password", ""))
        status_code = 200 if result["status"] == "joined" else 422
        return jsonify(result), status_code

    @app.route("/<path:_unused>")
    def catch_all(_unused):
        return redirect("http://10.42.0.1/", code=302)

    return app
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/jessekauppila/GitHub/sunset-cam-firmware/.claude/worktrees/bench-supervisor && python -m pytest tests/test_setup_app.py -v`
Expected: PASS (the test asserts `Location` ends with `/`, which `http://10.42.0.1/` satisfies)

- [ ] **Step 5: Commit**

```bash
git add src/sunset_cam/setup_app.py tests/test_setup_app.py
git commit -m "feat(firmware): captive-portal Flask app for WiFi onboarding"
```

### Task 13: SETUP entrypoint wiring (`run-setup-app.py`)

**Files:**
- Create: `scripts/run-setup-app.py`
- Test: `tests/test_run_setup_app.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_run_setup_app.py`:

```python
import importlib.util
from pathlib import Path

_SPEC = importlib.util.spec_from_file_location(
    "run_setup_app",
    Path(__file__).resolve().parent.parent / "scripts" / "run-setup-app.py",
)
mod = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(mod)


def test_real_join_runner_invokes_wpa_cli_sequence():
    calls = []
    ok = mod.real_join_runner(
        "HomeWiFi", "pw",
        runner=lambda args, **kw: calls.append(args) or type("R", (), {"returncode": 0})(),
        associated_check=lambda: True,
    )
    assert ok is True
    # tears down hostapd, brings up wpa_supplicant against the chosen SSID
    assert any("hostapd" in " ".join(c) for c in calls)


def test_real_join_runner_returns_false_when_not_associated():
    ok = mod.real_join_runner(
        "HomeWiFi", "pw",
        runner=lambda args, **kw: type("R", (), {"returncode": 0})(),
        associated_check=lambda: False,
    )
    assert ok is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/jessekauppila/GitHub/sunset-cam-firmware/.claude/worktrees/bench-supervisor && python -m pytest tests/test_run_setup_app.py -v`
Expected: FAIL — file not found / `real_join_runner` undefined

- [ ] **Step 3: Write minimal implementation**

Create `scripts/run-setup-app.py`:

```python
#!/usr/bin/env python3
"""Entry point for sunset-cam-setup.service. Wires the real iwlist scan and the
wpa_supplicant join sequence into WifiSetupService and serves the Flask app on
:80. The join sequence (tear down hostapd, write conf, bring up wpa_supplicant,
poll association up to 15s) is factored into real_join_runner so it is testable
with injected runners. ⚠️ The actual radio behavior is HARDWARE-GATED."""
from __future__ import annotations

import subprocess
import time
from typing import Callable

from sunset_cam.wifi_setup import WifiSetupService, WPA_HEADER, wpa_conf_block

WPA_CONF_PATH = "/etc/wpa_supplicant/wpa_supplicant.conf"


def real_scan_runner() -> str:
    return subprocess.run(
        ["iwlist", "wlan0", "scan"], capture_output=True, text=True, timeout=20
    ).stdout


def _is_associated() -> bool:
    out = subprocess.run(["iwgetid", "-r"], capture_output=True, text=True).stdout
    return out.strip() != ""


def real_join_runner(
    ssid: str,
    password: str,
    runner: Callable[..., object] = subprocess.run,
    associated_check: Callable[[], bool] = _is_associated,
    wait_s: float = 15.0,
) -> bool:
    with open(WPA_CONF_PATH, "w") as f:
        f.write(WPA_HEADER + wpa_conf_block(ssid, password))
    runner(["systemctl", "stop", "hostapd"], check=False)
    runner(["systemctl", "stop", "dnsmasq"], check=False)
    runner(["wpa_cli", "-i", "wlan0", "reconfigure"], check=False)
    deadline = time.monotonic() + wait_s
    while time.monotonic() < deadline:
        if associated_check():
            return True
        time.sleep(1.0)
    return associated_check()


def main() -> None:
    from sunset_cam.setup_app import create_app

    service = WifiSetupService(
        scan_runner=real_scan_runner,
        join_runner=lambda ssid, pw: real_join_runner(ssid, pw),
        conf_writer=lambda text: None,  # real_join_runner already wrote the conf
    )
    create_app(service).run(host="0.0.0.0", port=80)


if __name__ == "__main__":
    main()
```

> Note: `real_join_runner` writes the conf itself (it must, before `wpa_cli reconfigure`), so the service's `conf_writer` is a no-op here. The unit-tested `WifiSetupService.submit_credentials` failure-path guarantee (no persist on failure) is preserved on the *radio* side by `real_join_runner` only returning `True` when actually associated; a follow-up could delete the conf on failure (HARDWARE-GATED to verify).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/jessekauppila/GitHub/sunset-cam-firmware/.claude/worktrees/bench-supervisor && python -m pytest tests/test_run_setup_app.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/run-setup-app.py tests/test_run_setup_app.py
git commit -m "feat(firmware): SETUP-mode entrypoint wiring iwlist + wpa join"
```

---

## Slice 5 — Firmware: hostapd + dnsmasq + systemd unit (FIRMWARE, ⚠️ HARDWARE-GATED)

Per E-spec §8.6 + §5.5. These config files cannot be unit-tested (they configure the Pi radio/DHCP/DNS). We validate their *content* by a presence + key-line test, but their *behavior* must be verified on real hardware.

### Task 14: hostapd, dnsmasq configs + sunset-cam-setup.service

**Files:**
- Create: `config/hostapd.conf`
- Create: `config/dnsmasq-setup.conf`
- Create: `systemd/sunset-cam-setup.service`
- Test: `tests/test_setup_assets.py`

- [ ] **Step 1: Write the failing test (content sanity, not behavior)**

Create `tests/test_setup_assets.py`:

```python
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _read(rel):
    return (ROOT / rel).read_text()


def test_hostapd_conf_has_open_ap_and_ssid_template():
    text = _read("config/hostapd.conf")
    assert "interface=wlan0" in text
    assert "ssid=Sunset-Cam-" in text  # XXXX MAC suffix substituted at boot
    assert "wpa" not in text.lower() or "#wpa" in text.lower()  # open network


def test_dnsmasq_conf_hijacks_dns_to_device_ip():
    text = _read("config/dnsmasq-setup.conf")
    assert "interface=wlan0" in text
    assert "dhcp-range=10.42.0.50,10.42.0.150" in text
    assert "address=/#/10.42.0.1" in text  # every query → captive IP


def test_setup_service_conflicts_with_capture_and_runs_app():
    text = _read("systemd/sunset-cam-setup.service")
    assert "Conflicts=sunset-cam.service" in text
    assert "run-setup-app.py" in text
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/jessekauppila/GitHub/sunset-cam-firmware/.claude/worktrees/bench-supervisor && python -m pytest tests/test_setup_assets.py -v`
Expected: FAIL — files do not exist

- [ ] **Step 3: Write the config files**

Create `config/hostapd.conf`:

```
interface=wlan0
driver=nl80211
ssid=Sunset-Cam-XXXX
hw_mode=g
channel=6
auth_algs=1
ignore_broadcast_ssid=0
# Open network: the credentials we collect are for the recipient's home WiFi,
# not for this AP. No wpa= line on purpose. The XXXX in ssid is replaced with
# the MAC suffix at boot by sunset-cam-setup.service (ExecStartPre).
```

Create `config/dnsmasq-setup.conf`:

```
interface=wlan0
bind-interfaces
dhcp-range=10.42.0.50,10.42.0.150,255.255.255.0,12h
dhcp-option=3,10.42.0.1
dhcp-option=6,10.42.0.1
# Captive-portal DNS hijack: resolve every query to the device so iOS/Android
# probes (captive.apple.com, connectivitycheck.gstatic.com) hit our Flask app.
address=/#/10.42.0.1
```

Create `systemd/sunset-cam-setup.service`:

```
[Unit]
Description=Sunset Cam WiFi captive-portal setup (SETUP mode)
After=network.target
Conflicts=sunset-cam.service sunset-cam-aiming.service

[Service]
Type=simple
User=root
WorkingDirectory=/opt/sunset-cam
# Substitute the MAC suffix into the AP SSID, configure the static AP IP,
# then bring up hostapd + dnsmasq before the Flask app.
ExecStartPre=/bin/sh -c 'MAC=$(cat /sys/class/net/wlan0/address | tr -d ":" | tail -c 4); sed "s/Sunset-Cam-XXXX/Sunset-Cam-${MAC}/" /opt/sunset-cam/config/hostapd.conf > /run/hostapd-setup.conf'
ExecStartPre=/sbin/ip addr add 10.42.0.1/24 dev wlan0
ExecStartPre=/usr/sbin/hostapd -B /run/hostapd-setup.conf
ExecStartPre=/usr/sbin/dnsmasq -C /opt/sunset-cam/config/dnsmasq-setup.conf
ExecStart=/opt/sunset-cam/.venv/bin/python /opt/sunset-cam/scripts/run-setup-app.py
ExecStopPost=-/usr/bin/pkill hostapd
ExecStopPost=-/usr/bin/pkill dnsmasq
ExecStopPost=-/sbin/ip addr del 10.42.0.1/24 dev wlan0
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/jessekauppila/GitHub/sunset-cam-firmware/.claude/worktrees/bench-supervisor && python -m pytest tests/test_setup_assets.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add config/hostapd.conf config/dnsmasq-setup.conf systemd/sunset-cam-setup.service tests/test_setup_assets.py
git commit -m "feat(firmware): hostapd/dnsmasq configs + sunset-cam-setup.service"
```

- [ ] **Step 6: ⚠️ HARDWARE-GATED — manual validation on a Pi (NOT a unit test)**

On a real Pi Zero 2 W (E-spec §6.3 steps 2–3): boot with no WiFi creds; from a phone confirm `Sunset-Cam-XXXX` appears, the captive sheet pops, `http://10.42.0.1/` loads the form with scanned SSIDs, and submitting good creds joins within ~15 s. Record pass/fail in the operator log. **This behavior cannot be unit-tested.**

---

## Slice 6 — SD-image build steps (FIRMWARE, ⚠️ HARDWARE-GATED docs)

Per E-spec §8.7. The image is a 4–8 GB binary; version-control the build *script + docs*, not the image. The build itself runs on a real Pi/loopback mount and is HARDWARE-GATED.

### Task 15: First-boot oneshot + image build doc

**Files:**
- Create: `systemd/sunset-cam-firstboot.service`
- Create: `scripts/firstboot.sh`
- Create: `docs/sd-image-build.md`
- Test: `tests/test_firstboot_assets.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_firstboot_assets.py`:

```python
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def test_firstboot_service_is_oneshot_and_self_disables():
    text = (ROOT / "systemd" / "sunset-cam-firstboot.service").read_text()
    assert "Type=oneshot" in text
    assert "firstboot.sh" in text


def test_firstboot_script_creates_token_dir_and_disables_itself():
    text = (ROOT / "scripts" / "firstboot.sh").read_text()
    assert "/etc/sunset-cam" in text
    assert "systemctl disable sunset-cam-firstboot" in text


def test_build_doc_lists_required_packages_and_units():
    text = (ROOT / "docs" / "sd-image-build.md").read_text()
    for needle in ("hostapd", "dnsmasq", "sunset-cam-setup.service", "pip install -e"):
        assert needle in text
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/jessekauppila/GitHub/sunset-cam-firmware/.claude/worktrees/bench-supervisor && python -m pytest tests/test_firstboot_assets.py -v`
Expected: FAIL — files do not exist

- [ ] **Step 3: Write the assets**

Create `scripts/firstboot.sh`:

```bash
#!/usr/bin/env bash
# Runs once on first boot (sunset-cam-firstboot.service), then disables itself.
# Ensures the device-token / placement storage dirs exist with safe perms.
set -euo pipefail

install -d -m 700 /etc/sunset-cam
touch /etc/sunset-cam/placement.json || true
chmod 600 /etc/sunset-cam/placement.json || true

systemctl disable sunset-cam-firstboot.service
```

Create `systemd/sunset-cam-firstboot.service`:

```
[Unit]
Description=Sunset Cam first-boot provisioning (runs once)
After=local-fs.target
ConditionPathExists=/opt/sunset-cam/scripts/firstboot.sh

[Service]
Type=oneshot
ExecStart=/bin/bash /opt/sunset-cam/scripts/firstboot.sh
RemainAfterExit=no

[Install]
WantedBy=multi-user.target
```

Create `docs/sd-image-build.md`:

```markdown
# SD-image template build (sub-project E §5.2)

The image template is built ONCE and rebuilt when firmware changes. It is NOT
stored in git (4–8 GB binary); this doc + the scripts are the source of truth.
⚠️ Every step here runs against real Pi hardware or a loopback-mounted image and
cannot be unit-tested.

## Steps

1. Start from Raspberry Pi OS Lite 64-bit.
2. `sudo apt-get install -y hostapd dnsmasq wpasupplicant python3-venv qrencode`
   then `systemctl disable hostapd dnsmasq` (they are driven on demand by
   `sunset-cam-setup.service`, never at boot on a provisioned unit).
3. Clone the firmware repo to `/opt/sunset-cam`, create a venv, and
   `pip install -e .` inside it.
4. Install the units and enable the always-on ones:
   - `cp systemd/sunset-cam-setup.service systemd/sunset-cam-firstboot.service \
        systemd/sunset-cam-supervisor.service systemd/sunset-cam.service \
        systemd/sunset-cam-aiming.service /etc/systemd/system/`
   - `systemctl enable sunset-cam-firstboot sunset-cam-supervisor`
   - Leave `sunset-cam-setup` DISABLED; the supervisor starts it
     (`set_mode("setup")`) only when boot finds no WiFi creds.
5. Confirm there is NO `wpa_supplicant.conf` with a network block, so the
   template boots into SETUP.
6. Snapshot the image with `dd if=/dev/mmcblk0 of=template.img bs=4M`.

## Re-flash / rollback

Disabling `sunset-cam-setup.service` and hand-writing `wpa_supplicant.conf` is
exactly the legacy manual path (E-spec §7 rollback). No DB migration to undo.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/jessekauppila/GitHub/sunset-cam-firmware/.claude/worktrees/bench-supervisor && python -m pytest tests/test_firstboot_assets.py -v && chmod +x scripts/firstboot.sh`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add systemd/sunset-cam-firstboot.service scripts/firstboot.sh docs/sd-image-build.md tests/test_firstboot_assets.py
git commit -m "feat(firmware): first-boot oneshot + SD-image build doc"
```

- [ ] **Step 6: ⚠️ HARDWARE-GATED — run the build doc end-to-end on a Pi**

Execute `docs/sd-image-build.md` on real hardware, flash, boot, and confirm the unit boots into SETUP. **Cannot be unit-tested.**

---

## Slice 7 — Operator: provision-unit.sh + sticker generation (FIRMWARE)

Per E-spec §8.8 + §5.2 and contract CC-1/CC-3 (one minted code → sticker + config.json + QR; long TTL for shipped units). The pure helpers are unit-testable; the `dd` flash + USB SD detection are HARDWARE-GATED.

### Task 16: claim-code mint client + config.json writer (pure, testable)

**Files:**
- Create: `scripts/provision_lib.py`
- Test: `tests/test_provision_lib.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_provision_lib.py`:

```python
import json
from scripts import provision_lib as pl


def test_setup_url_encodes_the_code():
    assert pl.setup_url("SUNSET-7K3M-9XQ2") == "https://sunrisesunset.studio/setup/SUNSET-7K3M-9XQ2"


def test_mint_claim_code_defaults_to_non_expiring_shipped_ttl_and_bearer():
    captured = {}
    def fake_post(url, json=None, headers=None, timeout=None):
        captured["url"] = url
        captured["json"] = json
        captured["headers"] = headers
        return type("R", (), {
            "status_code": 200,
            "json": lambda self: {"code": "SUNSET-7K3M-9XQ2", "expires_at": "2099-01-01T00:00:00Z"},
            "raise_for_status": lambda self: None,
        })()
    # Default (shipped unit): effectively non-expiring (CC-3) — the code lives on the
    # sticker for the device's life and must stay valid for recommissioning.
    code, expires = pl.mint_claim_code(
        api_base="https://x", cron_secret="s3cret", label="unit-42",
        poster=fake_post,
    )
    assert code == "SUNSET-7K3M-9XQ2"
    assert captured["headers"]["Authorization"] == "Bearer s3cret"
    assert captured["json"]["label"] == "unit-42"
    assert captured["json"]["ttlDays"] == 3650  # CC-3: shipped units ~10y (non-expiring)


def test_mint_claim_code_allows_short_ttl_for_test_codes():
    captured = {}
    def fake_post(url, json=None, headers=None, timeout=None):
        captured["json"] = json
        return type("R", (), {
            "status_code": 200,
            "json": lambda self: {"code": "SUNSET-TEST-0001", "expires_at": "2026-07-13T00:00:00Z"},
            "raise_for_status": lambda self: None,
        })()
    # 30d is operator/test-only (CC-3): explicit, never the shipped default.
    pl.mint_claim_code(
        api_base="https://x", cron_secret="s3cret", label="bench-test",
        ttl_days=30, poster=fake_post,
    )
    assert captured["json"]["ttlDays"] == 30


def test_write_boot_config_writes_only_claim_code(tmp_path):
    out = tmp_path / "config.json"
    pl.write_boot_config(out, "SUNSET-7K3M-9XQ2")
    data = json.loads(out.read_text())
    assert data == {"claim_code": "SUNSET-7K3M-9XQ2"}  # CC-1: nothing else on the SD
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/jessekauppila/GitHub/sunset-cam-firmware/.claude/worktrees/bench-supervisor && python -m pytest tests/test_provision_lib.py -v`
Expected: FAIL — `No module named 'scripts.provision_lib'`. (If `scripts/__init__.py` is absent, the test's `from scripts import ...` needs it — add an empty `scripts/__init__.py` in Step 3.)

- [ ] **Step 3: Write minimal implementation**

Create empty `scripts/__init__.py`. Create `scripts/provision_lib.py`:

```python
"""Pure, testable provisioning helpers (E-spec §5.2, contract CC-1/CC-3).
The shell wrapper (provision-unit.sh) calls these; the dd flash stays in bash
because it is hardware-gated. Shipped units mint effectively NON-EXPIRING
(`ttl_days` default ~3650 ≈ 10y) so the sticker code stays valid for the
device's life and supports recommissioning (CC-3); 30d is operator/test-only."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Callable

SETUP_URL_BASE = "https://sunrisesunset.studio/setup"


def setup_url(code: str) -> str:
    return f"{SETUP_URL_BASE}/{code}"


# CC-3: shipped units are effectively non-expiring (~10y). 30d is test-only and
# must be passed explicitly (e.g. provision-unit.sh --test).
SHIPPED_TTL_DAYS = 3650


def mint_claim_code(
    *, api_base: str, cron_secret: str, label: str, ttl_days: int = SHIPPED_TTL_DAYS,
    poster: Callable | None = None,
) -> tuple[str, str]:
    import requests

    post = poster or requests.post
    resp = post(
        f"{api_base.rstrip('/')}/api/admin/claim-codes",
        json={"label": label, "ttlDays": ttl_days},
        headers={"Authorization": f"Bearer {cron_secret}"},
        timeout=20,
    )
    resp.raise_for_status()
    body = resp.json()
    return body["code"], body["expires_at"]


def write_boot_config(path: str | Path, code: str) -> None:
    Path(path).write_text(json.dumps({"claim_code": code}) + "\n")
```

> Contract CC-3 requires `provision-unit.sh` to pass `ttlDays`. `mintClaimCode` in the cloud already accepts `ttlDays` (`app/lib/cameraClaimCode.ts`), but the admin route (`app/api/admin/claim-codes/route.ts`) currently does NOT forward it. **Add a cloud sub-step:** in that route, parse `body.ttlDays` (number) and pass `{ label, ttlDays }` to `mintClaimCode`. (CLOUD; covered by a quick test in `app/api/admin/claim-codes/route.test.ts` asserting the mock `mintClaimCode` receives `ttlDays`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/jessekauppila/GitHub/sunset-cam-firmware/.claude/worktrees/bench-supervisor && python -m pytest tests/test_provision_lib.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/__init__.py scripts/provision_lib.py tests/test_provision_lib.py
git commit -m "feat(firmware): provisioning helpers (mint, setup-url, boot config)"
```

### Task 16b: Forward `ttlDays` in the admin claim-codes route (CLOUD)

**Files:**
- Modify: `app/api/admin/claim-codes/route.ts`
- Test: `app/api/admin/claim-codes/route.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `app/api/admin/claim-codes/route.test.ts` (reuse the file's existing `mintClaimCode` mock; read it to match the variable name — assume `mintClaimCodeMock`):

```typescript
  it('forwards ttlDays to mintClaimCode', async () => {
    process.env.CRON_SECRET = 'secret';
    mintClaimCodeMock.mockResolvedValueOnce({ code: 'SUNSET-AAAA-BBBB', expires_at: new Date('2099-01-01') });
    const req = new Request('http://test/api/admin/claim-codes', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer secret' },
      body: JSON.stringify({ label: 'unit-42', ttlDays: 180 }),
    });
    await POST(req);
    expect(mintClaimCodeMock).toHaveBeenCalledWith({ label: 'unit-42', ttlDays: 180 });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/jessekauppila/GitHub/the-sunset-webcam-map && npx vitest run app/api/admin/claim-codes/route.test.ts -t ttlDays`
Expected: FAIL — `mintClaimCode` called with `{ label }` only (no `ttlDays`).

- [ ] **Step 3: Write minimal implementation**

In `app/api/admin/claim-codes/route.ts`, widen the body type to `{ label?: unknown; ttlDays?: unknown }`, then:

```typescript
  const ttlDays =
    typeof body.ttlDays === 'number' && Number.isFinite(body.ttlDays) ? body.ttlDays : undefined;

  try {
    const minted = await mintClaimCode(ttlDays === undefined ? { label } : { label, ttlDays });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/jessekauppila/GitHub/the-sunset-webcam-map && npx vitest run app/api/admin/claim-codes/route.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/claim-codes/route.ts app/api/admin/claim-codes/route.test.ts
git commit -m "feat(cloud): forward ttlDays in admin claim-codes mint route"
```

### Task 17: Sticker generation (QR + human-readable code)

**Files:**
- Create: `scripts/make_sticker.py`
- Test: `tests/test_make_sticker.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_make_sticker.py`:

```python
from scripts.make_sticker import build_qrencode_cmd, sticker_text


def test_build_qrencode_cmd_encodes_the_setup_url():
    cmd = build_qrencode_cmd("SUNSET-7K3M-9XQ2", "/tmp/qr.png")
    assert "qrencode" in cmd
    assert "https://sunrisesunset.studio/setup/SUNSET-7K3M-9XQ2" in cmd
    assert "/tmp/qr.png" in cmd


def test_sticker_text_includes_code_url_and_sd_serial_footer():
    text = sticker_text("SUNSET-7K3M-9XQ2", sd_serial="0xabc123")
    assert "SUNSET-7K3M-9XQ2" in text
    assert "sunrisesunset.studio/setup/SUNSET-7K3M-9XQ2" in text
    assert "0xabc123" in text  # E-spec §7: SD serial footer so stickers can't be swapped
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/jessekauppila/GitHub/sunset-cam-firmware/.claude/worktrees/bench-supervisor && python -m pytest tests/test_make_sticker.py -v`
Expected: FAIL — `No module named 'scripts.make_sticker'`

- [ ] **Step 3: Write minimal implementation**

Create `scripts/make_sticker.py`:

```python
"""Generate a sticker for one unit: QR (via the qrencode CLI) encoding the setup
URL, plus the human-readable claim code and an SD-serial footer (E-spec §7, so a
sticker can't be paired with the wrong card). Returns the command/text; the shell
wrapper runs qrencode and lays out the PDF."""
from __future__ import annotations

from scripts.provision_lib import setup_url


def build_qrencode_cmd(code: str, out_png: str) -> list[str]:
    return ["qrencode", "-o", out_png, "-s", "8", setup_url(code)]


def sticker_text(code: str, sd_serial: str) -> str:
    return (
        f"{code}\n"
        f"{setup_url(code).replace('https://', '')}\n"
        f"SD: {sd_serial}"
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/jessekauppila/GitHub/sunset-cam-firmware/.claude/worktrees/bench-supervisor && python -m pytest tests/test_make_sticker.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/make_sticker.py tests/test_make_sticker.py
git commit -m "feat(firmware): sticker QR + text generation"
```

### Task 18: provision-unit.sh wrapper + CSV log (⚠️ HARDWARE-GATED for the flash)

**Files:**
- Create: `scripts/provision-unit.sh`
- Test: `tests/test_provision_unit_sh.py`

- [ ] **Step 1: Write the failing test (dry-run, no real SD)**

Create `tests/test_provision_unit_sh.py`:

```python
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / "scripts" / "provision-unit.sh"


def test_dry_run_mints_writes_config_and_logs_csv(tmp_path, monkeypatch):
    # DRY_RUN skips the dd flash (hardware-gated) but exercises mint+config+sticker+log
    env = {
        "DRY_RUN": "1",
        "API_BASE": "https://x",
        "CRON_SECRET": "s",
        "PROVISION_OUT": str(tmp_path),
        "PATH": "/usr/bin:/bin",
        # a stub mint that the script sources in DRY_RUN mode
        "FAKE_CLAIM_CODE": "SUNSET-7K3M-9XQ2",
    }
    result = subprocess.run(
        ["bash", str(SCRIPT), "unit-42"], capture_output=True, text=True, env=env,
    )
    assert result.returncode == 0, result.stderr
    csv = (tmp_path / "provision-log.csv").read_text()
    assert "SUNSET-7K3M-9XQ2" in csv
    assert "unit-42" in csv
    assert (tmp_path / "config.json").exists()


def test_requires_a_label_argument():
    result = subprocess.run(["bash", str(SCRIPT)], capture_output=True, text=True, env={"PATH": "/usr/bin:/bin"})
    assert result.returncode != 0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/jessekauppila/GitHub/sunset-cam-firmware/.claude/worktrees/bench-supervisor && python -m pytest tests/test_provision_unit_sh.py -v`
Expected: FAIL — script missing

- [ ] **Step 3: Write minimal implementation**

Create `scripts/provision-unit.sh`:

```bash
#!/usr/bin/env bash
# Provision one unit: mint a claim code (long TTL), write SD config.json with ONLY
# the claim_code, generate a sticker, flash the SD, and append a CSV log row.
# DRY_RUN=1 skips the dd flash (⚠️ hardware-gated) so the rest is testable.
# Usage: API_BASE=... CRON_SECRET=... ./scripts/provision-unit.sh <label>
set -euo pipefail

LABEL="${1:-}"
if [ -z "$LABEL" ]; then
  echo "usage: provision-unit.sh <serial-or-label>" >&2
  exit 2
fi

OUT="${PROVISION_OUT:-./provision-out}"
mkdir -p "$OUT"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
PY="${PYTHON:-python3}"

if [ "${DRY_RUN:-0}" = "1" ] && [ -n "${FAKE_CLAIM_CODE:-}" ]; then
  CODE="$FAKE_CLAIM_CODE"
else
  CODE="$("$PY" - "$API_BASE" "$CRON_SECRET" "$LABEL" <<'PYEOF'
import sys
sys.path.insert(0, ".")
from scripts.provision_lib import mint_claim_code
code, _ = mint_claim_code(api_base=sys.argv[1], cron_secret=sys.argv[2], label=sys.argv[3], ttl_days=180)
print(code)
PYEOF
)"
fi

# Write the SD /boot config.json (only claim_code — contract CC-1)
"$PY" -c "import sys; sys.path.insert(0,'.'); from scripts.provision_lib import write_boot_config; write_boot_config('$OUT/config.json', '$CODE')"

# Sticker: QR + text
"$PY" -c "import sys; sys.path.insert(0,'.'); from scripts.make_sticker import build_qrencode_cmd; print(' '.join(build_qrencode_cmd('$CODE', '$OUT/qr-$CODE.png')))" >/dev/null || true

SD_SERIAL="dry-run"
if [ "${DRY_RUN:-0}" != "1" ]; then
  # ⚠️ HARDWARE-GATED: detect the inserted SD and flash the template image.
  SD_SERIAL="$(cat /sys/block/mmcblk0/device/serial 2>/dev/null || echo unknown)"
  dd if="${TEMPLATE_IMG:?set TEMPLATE_IMG}" of=/dev/mmcblk0 bs=4M status=progress
fi

echo "$(date -u +%FT%TZ),$CODE,$LABEL,$SD_SERIAL,$OUT/config.json" >> "$OUT/provision-log.csv"
echo "provisioned $LABEL -> $CODE"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/jessekauppila/GitHub/sunset-cam-firmware/.claude/worktrees/bench-supervisor && chmod +x scripts/provision-unit.sh && python -m pytest tests/test_provision_unit_sh.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/provision-unit.sh tests/test_provision_unit_sh.py
git commit -m "feat(firmware): provision-unit.sh wrapper with CSV log and dry-run"
```

- [ ] **Step 6: ⚠️ HARDWARE-GATED — flash a real SD and boot it**

Run `provision-unit.sh` without `DRY_RUN` against a real inserted SD card (E-spec §6.3 step 1), boot the Pi, and confirm it enters SETUP with the minted code on the sticker matching `config.json`. **The `dd` flash and SD-serial detection cannot be unit-tested.**

---

## Slice 8 — Full-suite gate + protocol doc amendment

### Task 19: Run both full suites; amend device-protocol.md (FIRMWARE + docs)

**Files:**
- Modify: `docs/device-protocol.md` (firmware repo or cloud repo — wherever it lives; E-spec §8.9)

- [ ] **Step 1: Run the full firmware suite**

Run: `cd /Users/jessekauppila/GitHub/sunset-cam-firmware/.claude/worktrees/bench-supervisor && python -m pytest -q`
Expected: PASS (all new + pre-existing tests green)

- [ ] **Step 2: Run the full cloud cameras suite**

Run: `cd /Users/jessekauppila/GitHub/the-sunset-webcam-map && npx vitest run app/api/cameras app/api/admin/claim-codes app/lib/cameraRegistration.test.ts`
Expected: PASS

- [ ] **Step 3: Amend device-protocol.md (contract divergences D-1/D-4)**

Add `claim_code TEXT` to the `cameras` schema in §10 (D-1); change the `register` `placement_status` enum text from `"pending"|"ready"` to `awaiting_location | awaiting_aim | ready` and note firmware treats non-`ready` as IDLE/poll (D-4); add the `azimuth_source/coarse/bracket` fields to the documented `placement` block (D-3).

- [ ] **Step 4: Commit**

```bash
git add docs/device-protocol.md
git commit -m "docs: amend device-protocol for claim_code, placement_status enum, bracket fields"
```

- [ ] **Step 5: ⚠️ HARDWARE-GATED — end-to-end smoke on one Pi**

Per E-spec §6.3 full sequence + §6.4: provision → flash → boot → captive form → join → `setup-status` flips `awaiting_wifi`→`registered` within 30 s → `pre-register` with bracket payload → device heartbeat receives placement → IDLE→ACTIVE. **This whole loop cannot be unit-tested.**

---

## Self-Review

**Spec coverage (E-spec §8 slice order):** (1) `placement_status`+setup-status — Task 0 verifies existing (bracket persistence is F-owned, see contract §0 — NOT authored here); (2) either-order pre-register — verified Task 0 (bracket parse/validate is F Task 6); (3) heartbeat placement — verified Task 0 (bracket emit is F Task 7); (4) state machine SETUP/ONLINE/IDLE/ACTIVE + capture extraction — Tasks 6–8; (4a) **device HTTP client — register, IDLE heartbeat-poll, placement consume, wired into the supervisor rendezvous — Tasks 8a–8d**; (5) captive-portal Flask — Tasks 9–13; (6) hostapd/dnsmasq/setup.service — Task 14; (7) SD-image build — Task 15; (8) provision-unit.sh + sticker — Tasks 16–18; plus protocol amendment Task 19. Contract CC-3 (long TTL) is Task 16/16b.

**Reconciliation (2026-06-13) coverage:** Fix 2 — removed the duplicate cloud authoring slices (old Slices 1–2: migration, `pre-register` validator with the stale `left/right`+`up/down/left/right` enums, `register`/`heartbeat`/`cameraRegistration` edits); replaced with the F-ownership dependency note. Fix 3 — added the device HTTP client (Slice 3a, Tasks 8a–8d) making `SETUP→ONLINE→register→IDLE→heartbeat→ACTIVE` real code. Fix 6 — IDLE heartbeat-poll uses bounded backoff with a give-up guard (`poll_for_placement`). Fix 8 — register-first INSERT default `phase=NULL` is F-owned; E only consumes the resulting placement.

**Lifecycle addendum (2026-06-13) coverage:** CC-3 — `mint_claim_code` defaults to the non-expiring shipped TTL (`SHIPPED_TTL_DAYS=3650`); 30d is explicit test-only (Task 16, two tests). §11a relocation — `decide_boot_state(has_creds, associated)` re-enters SETUP when old creds no longer associate (Task 7, added assertion); the moved-to-new-network unit needs no new trigger. §12 PD-1 / §13 — device honors a heartbeat `reprovision`/`wipe_wifi` directive: `wifi_wipe.wipe_wifi_credentials` + `wants_wifi_wipe`, clearing creds → SETUP, TDD with mocked FS/subprocess; no physical reset button (Task 8e).

**Placeholder scan:** none — every code step has full content.

**Type consistency:** `WifiSetupService(scan_runner=, join_runner=, conf_writer=)` is consistent Tasks 11–13; the device client surface (`register_device`/`RegisterResult`, `heartbeat_once`/`poll_for_placement`, `apply_placement`/`RefineMode`, `run_online_rendezvous`) is consistent across Tasks 8a–8d; `set_mode("setup")` + `SETUP_UNIT` consistent Tasks 7–8/14. No cloud TS types are authored here (F-owned).
