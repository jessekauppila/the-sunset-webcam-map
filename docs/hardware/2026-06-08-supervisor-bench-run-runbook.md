# Device Supervisor — Current State + Bench-Run Runbook

Date: 2026-06-08
Resume anchor for the device-supervisor / deployment-integration work.

---

## Where we are

The **device supervisor** (AIMING↔ACTIVE auto-run) is **built and deployable**, on firmware branch `feat/deploy-aiming-supervisor` (pushed). It bundles the entire device side of the deployment integration: v0.4 sun-tap aiming + `POST /setup/confirm` + the config-driven launcher + the supervisor + the gyro fix (firmware `main` merged in for `make_orientation_reader`). **83 tests green, full import chain resolves.**

Pieces on the branch:
- `heartbeat.py` — `post_heartbeat` / `parse_placement` (read `placement_status` + lat/lng from the cloud)
- `service_control.py` — `SystemctlController.set_mode("aiming"|"capture"|"idle")` (idempotent systemctl)
- `device_config.py` — `write_location` (merge cloud lat/lng into config.json)
- `placement_report.py` — `post_placement` (report the confirmed aim to the cloud's `/placement`)
- `supervisor.py` — `decide_mode` + `run_once` + `main` (the always-on brain)
- `systemd/sunset-cam-aiming.service` (`Conflicts=sunset-cam.service`) + `systemd/sunset-cam-supervisor.service`

The end-to-end chain is wired: supervisor heartbeats → `awaiting_aim` → writes lat/lng + starts aiming → phone tap + **Confirm** → `/setup/confirm` → `post_placement` to the cloud → cloud flips to `ready` → supervisor stops aiming, starts capture.

## What's next: the BENCH END-TO-END RUN (the walking-skeleton validation)

No real sun needed — only the sun-tap *accuracy* needs a real sunset; the *plumbing* doesn't. This is the integration test that proves the green-tested pieces actually fit.

### A — Deploy to cam1
```bash
ssh pi@sunset-cam-1.local
cd /opt/sunset-cam && sudo git fetch origin && sudo git checkout feat/deploy-aiming-supervisor && sudo git pull
sudo cp systemd/sunset-cam-aiming.service systemd/sunset-cam-supervisor.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl stop sunset-cam      # let the supervisor own it
```

### B — Start the supervisor and watch
```bash
sudo systemctl start sunset-cam-supervisor
journalctl -u sunset-cam-supervisor -f
```
Expect: `supervisor up; camera_id=4` → then `mode=aiming` (camera 4 has lat/lng but no aim yet → `awaiting_aim`).

### C — Aim from the phone
- `http://sunset-cam-1.local:8080` (same WiFi) → live preview + overlay.
- Tap anywhere (the sun if up; anything works for the plumbing test).
- The **"Confirm aim"** button appears → tap it.

### D — Watch the flip
Within ~30s: `mode=capture` in the supervisor log — it saw the cloud flip to `ready`, stopped aiming, started capture. Confirm `sudo systemctl status sunset-cam` is active.

**Success = the whole loop ran with no typed commands after `start`.**

### Likely snags (integration — surprises live here)
- **camera 4 not `awaiting_aim`**: if already `ready` → straight to capture (clear the aim to re-test); if `awaiting_location` → idles.
- **`User=root` units** (aiming + supervisor) vs the existing capture unit's `User=pi` — watch journals for camera/venv permission issues as root.
- **placement POST 401** — if camera 4's `device_token` in `config.json` doesn't match.

## Branch stack + merge gating

```
firmware main (has gyro #4, install #3)
  └─ feat/v0.4-sun-tap-aiming  (PR #5 — OPEN, gated on real-sun hardware validation)
       └─ feat/deploy-aiming-firmware  (confirm + config launcher)
            └─ feat/deploy-aiming-supervisor  (this — supervisor + cloud report; main merged in for gyro)
```
Nothing in this stack merges until **#5's real-sun hardware validation** (tap the actual sun on cam1, confirm the heading is right). The bench run validates the *plumbing*; the real sunset validates *accuracy*. Cloud side (#52) is already merged + deployed.

## Related
- Spec: `docs/superpowers/specs/2026-06-07-pi-deployment-aiming-integration-design.md`
- Plans: `docs/superpowers/plans/2026-06-08-pi-deployment-supervisor.md`, `...-firmware.md`, `...-cloud.md`
- Learnings: `docs/solutions/integration-issues/stacked-branch-missing-merged-dependency.md`, `docs/solutions/best-practices/walking-skeleton-over-horizontal-buildout.md`
