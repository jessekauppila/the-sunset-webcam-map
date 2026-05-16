# Tier 0 Cameras — Deployment & Verification Plan (2026-05-12)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take the existing Tier 0 scaffold from "code merged but never exercised end-to-end" to "one Pi Zero 2 W at Jesse's house captures a JPEG, posts it to `sunrisesunset.studio`, and the image appears in the live mosaic." Five buckets, mapped 1:1 to the canonical Tier 0 framing in `~/Documents/Claude Sessions/ongoing/sunset-pi-cameras.md`: (1) schema migration, (2) snapshot endpoint, (3) test camera SQL, (4) Pi firmware skeleton, (5) end-to-end run.

**Architecture:** All wire-protocol shapes match `docs/device-protocol.md` §6.4 / §10. Pi captures with `picamera2` at 1 fps inside a hardcoded UTC window, attaches a static `device_token` from `config.json`, POSTs `multipart/form-data` to `POST /api/cameras/:id/snapshot`. The Next.js handler authenticates against `cameras.device_token_hash`, uploads bytes to Firebase Storage via `firebase-admin`, writes a `webcam_snapshots` row. A paired `webcams` row (`source='custom'`, `custom_camera_id` linked) plus a `terminator_webcam_state` row with `active=true` make the camera visible to the existing `/api/db-terminator-webcams` query path with zero frontend changes.

**Tech Stack:** Next.js 15 App Router (TypeScript), Neon Postgres via `@neondatabase/serverless`, Firebase Storage via `firebase-admin`, Vitest. Firmware: Python 3.11+, `picamera2`, `requests`, `pytest`. Systemd. Two repos: `the-sunset-webcam-map` (parent) and `~/GitHub/sunset-cam-firmware` (firmware).

**Reference docs:**
- `docs/device-protocol.md` — wire contract (§6.4 snapshot endpoint, §10 schema)
- `~/Documents/Claude Sessions/ongoing/sunset-pi-cameras.md` — decisions log
- `docs/superpowers/plans/2026-05-03-tier-0-cameras.md` — prior plan that scaffolded the code referenced below

---

## Current State (do not rebuild)

Code already committed in both repos. This plan assumes these exist and only verifies/deploys them. **Do not re-implement.**

**Parent repo (`the-sunset-webcam-map`):**

| Already exists | Notes |
|---|---|
| `database/migrations/20260503_cameras_schema.sql` | Forward-only. Implements protocol §10 in full. |
| `database/seeds/tier0-test-camera.sql` | Idempotent upsert by `hardware_id`. |
| `scripts/tier0-create-camera.sh` | Wrapper: generates token, hashes, runs seed, prints `camera_id` + plaintext token. |
| `app/lib/cameraAuth.ts` + `cameraAuth.test.ts` | `verifyDeviceToken`, `hashDeviceToken`. |
| `app/lib/cameraSnapshot.ts` + `cameraSnapshot.test.ts` | `uploadCameraSnapshot`, `insertCameraSnapshotRow`. |
| `app/api/cameras/[id]/snapshot/route.ts` | Multipart parse, 400/401/404/413/202 paths. |
| `app/api/cron/update-windy/lib/dbOperations.ts` | `deactivateMissingTerminatorState` already filtered to `source='windy'` so custom rows survive cron ticks. |

**Firmware repo (`~/GitHub/sunset-cam-firmware`, branch `main`):**

6 commits scaffolding: `config.py` (typed loader), `window.py` (hardcoded UTC window), `upload.py` (multipart POST with bearer), `capture.py` (lazy `picamera2`), `main.py` (loop), systemd unit, install script, tests.

**Already done (do not redo):**

- Migration applied to prod Neon on 2026-05-12 (per `ongoing/sunset-pi-cameras.md` decisions log). Task 1 below is verify-only — do not re-apply.

**Gaps (what this plan covers):**

- Schema state in prod has not been independently re-verified at the start of this session — confirm the six expected additions are present.
- Snapshot endpoint has never been exercised against a live server.
- No test camera has been created in prod.
- No physical Pi has been flashed or configured.
- No image has flowed end-to-end.

**Branch:** This plan executes on `feat/tier-0-cameras` (branched from `main`, 2026-05-13). The prior `feat/model-analysis-tab` is unrelated and already merged via PR #3.

---

## File Structure

This plan **does not create new files** in either repo. Each task is a sequence of verifications, single-file edits to `config/config.json` on the Pi, and shell invocations. The only artifact that gets *modified* is `~/GitHub/sunset-cam-firmware/config/config.example.json` if its placeholder `window_id`/dates need updating to reflect today's deployment date — and only as a deploy-time edit on the Pi, not a commit.

If a gap is found that requires new code (e.g., the migration won't apply cleanly, an endpoint test fails, the firmware crashes on a Pi-specific edge case), STOP the relevant task and surface it — do not silently extend scope here. Each bucket below has an explicit "halt condition" for that.

---

## Task 1: Schema state in prod re-verified

The migration was applied on 2026-05-12 (notes file, decisions log). This task is verify-only: confirm the six schema additions are still present and the cron filter still excludes custom cameras. **Do not run the migration.**

**Files:**
- Read-only: `database/migrations/20260503_cameras_schema.sql`
- Read-only: `app/api/cron/update-windy/lib/dbOperations.ts`

**Halt condition:** Any schema check returns NULL/FALSE, or the cron filter has regressed. Halt → diagnose → re-plan; do not band-aid.

- [x] **Step 1: Confirm `DATABASE_URL` is set and points at prod Neon**

Run:
```bash
echo "${DATABASE_URL:0:30}..."
```

Expected: a `postgres://...` prefix that matches the connection string in Vercel's env vars for the `sunrisesunset.studio` project. If it's not set, `export DATABASE_URL="$(vercel env pull --environment=production - 2>/dev/null | grep ^DATABASE_URL | cut -d= -f2- | tr -d '"')"` or pull it from the Neon console.

- [x] **Step 2: Verify all six schema additions exist in prod**

Run:
```bash
psql "$DATABASE_URL" -c "
  SELECT
    to_regclass('public.cameras') AS cameras,
    to_regclass('public.camera_claim_codes') AS claim_codes,
    EXISTS (SELECT 1 FROM information_schema.columns
            WHERE table_name='webcams' AND column_name='source') AS webcams_source,
    EXISTS (SELECT 1 FROM information_schema.columns
            WHERE table_name='webcams' AND column_name='custom_camera_id') AS webcams_custom_camera_id,
    EXISTS (SELECT 1 FROM information_schema.columns
            WHERE table_name='webcam_snapshots' AND column_name='edge_score') AS snapshots_edge_score,
    EXISTS (SELECT 1 FROM information_schema.columns
            WHERE table_name='webcam_snapshots' AND column_name='window_id') AS snapshots_window_id;
"
```

Expected: `cameras` and `claim_codes` return their fully-qualified names (`public.cameras`, `public.camera_claim_codes`); the four `EXISTS` flags all return `t`. If any column is NULL or `f`, prod has drifted from the migration — halt; do not "fix forward" by re-running the migration without first understanding why a column went missing.

- [x] **Step 3: Verify the cron filter is in place (no code change, just a grep)**

Run:
```bash
grep -n "source = 'windy'" app/api/cron/update-windy/lib/dbOperations.ts
```

Expected: at least one match inside `deactivateMissingTerminatorState`. If absent, the next cron tick will set `terminator_webcam_state.active=false` for custom cameras and silently disappear them from the mosaic — halt and patch before continuing.

- [x] **Step 4: Confirm the decisions-log entry already exists**

The notes file already records the migration. Just confirm — don't append a duplicate:

```bash
grep -n "Migration applied to prod Neon" \
  ~/Documents/Claude\ Sessions/ongoing/sunset-pi-cameras.md
```

Expected: at least one match. If zero matches, add the line per the format in [the file's "Decisions locked Session 2 (continued, late)" section]. No commit; it's a notes file.

---

## Task 2: Snapshot endpoint verified locally and in prod

**Files:**
- Read-only: `app/api/cameras/[id]/snapshot/route.ts`
- Read-only: `app/lib/cameraAuth.ts`, `app/lib/cameraSnapshot.ts` and their `.test.ts` neighbors

**Halt condition:** A Vitest test fails, `npm run build` errors, or the production smoke-test returns anything other than `401` for a fake token / `202` for a real one.

- [x] **Step 1: Run the existing Vitest unit tests for the snapshot pipeline**

Run:
```bash
npx vitest run app/lib/cameraAuth.test.ts app/lib/cameraSnapshot.test.ts
```

Expected: both files pass, ~12–20 tests total, exit code 0.

- [x] **Step 2: Run the full test suite to catch any cross-file regression**

> **2026-05-13 execution note:** 124/126 passed. Two pre-existing failures in `app/components/Map/hooks/useSetMarker.test.ts` and `app/components/Map/lib/terminatorRing.test.ts` — neither is Tier 0 scope. All camera-related test files (`app/api/cameras/[id]/snapshot/route.test.ts`, `app/lib/cameraAuth.test.ts`, `app/lib/cameraSnapshot.test.ts`, `app/api/cron/update-windy/lib/dbOperations.test.ts`) pass.

Run:
```bash
npx vitest run
```

Expected: green. If unrelated tests fail (e.g., `modelRuns` from in-flight branch work), that's outside Tier 0 scope — note them and continue. If a test in `cameraAuth`, `cameraSnapshot`, or any `app/api/cameras/**` file fails, halt.

- [x] **Step 3: Type-check + production build**

Run:
```bash
npm run build
```

Expected: clean build, no TypeScript errors. The route is dynamic (`export const dynamic = 'force-dynamic'`); Next.js will report it as a Dynamic route in the route summary.

- [x] **Step 4: Start a local dev server**

Run in a separate terminal:
```bash
DATABASE_URL="$DATABASE_URL" npm run dev
```

Expected: `▲ Next.js 15.x  - Local: http://localhost:3000` and "Ready" within ~5s. Keep it running for Steps 5–6.

- [x] **Step 5: Local smoke-test — 401 for a missing/fake bearer**

Run:
```bash
curl -sS -o /dev/null -w "%{http_code}\n" \
  -X POST http://localhost:3000/api/cameras/1/snapshot
```

Expected: `401`. (No `Authorization` header → `verifyDeviceToken` returns null.)

Then run:
```bash
curl -sS -o /dev/null -w "%{http_code}\n" \
  -X POST http://localhost:3000/api/cameras/1/snapshot \
  -H "Authorization: Bearer not-a-real-token"
```

Expected: `401`. (Header present but hash doesn't match anything in `cameras`.)

- [x] **Step 6: Local smoke-test — 400 for missing fields with a valid-format-but-still-unknown bearer**

We can't fully exercise the 202 path locally without a real `cameras` row. Confirming the route's argument validation runs before token verification is enough for Tier 0 — that's already covered by Vitest in `app/api/cameras/[id]/snapshot/route.test.ts` if present, or by Step 5 above otherwise.

Stop the dev server: `Ctrl-C` in the dev-server terminal.

- [x] **Step 7: Ensure the working tree is on the Tier 0 branch with no surprise changes**

Run:
```bash
git status
git rev-parse --abbrev-ref HEAD
```

Expected: branch is `feat/tier-0-cameras`, working tree clean (or only this plan file untracked). The Tier 0 server code is already on `main` (the migration file landed on `2026-05-03` and the snapshot route + lib files followed). If `git status` shows uncommitted Tier-0-relevant changes, halt and surface them — do not bundle them with the deployment.

- [x] **Step 8: Confirm prod has the snapshot endpoint deployed**

> **2026-05-13 execution note:** Prod returned `307 → 401`. The bare host `sunrisesunset.studio` redirects to `www.sunrisesunset.studio` (Vercel's canonical-host redirect). After following, the route returns `{"error":"unauthorized"}` with status `401` — route exists and rejects unauthenticated requests as expected. **Important downstream impact:** Task 4 Step 6's `config.json` must set `"api_base": "https://www.sunrisesunset.studio"` (with `www`) to avoid the redirect on every multipart upload.

Run:
```bash
curl -sS -o /dev/null -w "%{http_code}\n" \
  -X POST https://sunrisesunset.studio/api/cameras/1/snapshot
```

Expected: `401` (route exists, auth rejects no-bearer). If `404`, the route hasn't been deployed — that means the branch carrying the snapshot route was never merged to `main`. Halt, identify the branch, merge or cherry-pick, redeploy. If `500`, the route exists but threw — check Vercel logs for the trace before continuing.

---

## Task 3: Test camera hand-created in prod

**Files:**
- Read-only: `database/seeds/tier0-test-camera.sql`, `scripts/tier0-create-camera.sh`

**Halt condition:** The script fails to print a numeric `camera_id`, or the post-run verification queries find missing rows.

- [ ] **Step 1: Decide on the camera's identity**

Pick values for the wrapper script's flags. Reasonable Tier 0 defaults for Jesse's house in Seattle:

| Flag | Value |
|---|---|
| `--hardware-id` | `pi-zero-2w-tier0-jesse-house` |
| `--lat` | (real lat of Jesse's house, e.g., `47.6062`) |
| `--lng` | (real lng of Jesse's house, e.g., `-122.3321`) |
| `--timezone` | `America/Los_Angeles` |
| `--title` | `Tier 0 Test Camera — Jesse House` |
| `--phase` | `sunset` |

Use the actual coordinates of the deployment location, not the Seattle downtown placeholder. The lat/lng controls when the active window opens for this camera (currently irrelevant — Tier 0 firmware uses a hardcoded UTC window — but it's also the lat/lng used by the mosaic to position the marker, so it needs to be right).

- [ ] **Step 2: Run the wrapper script**

Run (substituting real lat/lng):
```bash
DATABASE_URL="$DATABASE_URL" ./scripts/tier0-create-camera.sh \
  --hardware-id pi-zero-2w-tier0-jesse-house \
  --lat 47.6062 --lng -122.3321 \
  --timezone America/Los_Angeles \
  --title "Tier 0 Test Camera — Jesse House" \
  --phase sunset
```

Expected output (concrete numbers and the token will differ):
```
Tier 0 camera created.

  camera_id:     1
  device_token:  9f2c...e8a4    (64 hex chars)

Paste these into sunset-cam-firmware/config/config.json under
"camera_id" and "device_token". The token is shown ONCE — store it now.
```

**Capture both values immediately.** The plaintext token is not recoverable; only the hash is stored in the DB. If lost, re-run the script — it's idempotent on `hardware_id` and will overwrite the hash with a new token.

- [ ] **Step 3: Verify the three rows exist and are linked**

Run:
```bash
psql "$DATABASE_URL" -c "
  SELECT
    c.id AS camera_id,
    c.hardware_id,
    c.status AS cam_status,
    c.webcam_id,
    w.id AS w_id,
    w.source,
    w.custom_camera_id,
    w.status AS web_status,
    t.active AS terminator_active,
    t.phase
  FROM cameras c
  LEFT JOIN webcams w ON w.id = c.webcam_id
  LEFT JOIN terminator_webcam_state t ON t.webcam_id = w.id
  WHERE c.hardware_id = 'pi-zero-2w-tier0-jesse-house';
"
```

Expected: exactly one row. `webcam_id` matches `w_id`, `custom_camera_id` matches `camera_id`, `source='custom'`, `cam_status='active'`, `web_status='active'`, `terminator_active=true`, `phase='sunset'`. If any field is NULL or wrong, halt.

- [ ] **Step 4: Verify the camera shows up in the terminator query**

Run:
```bash
curl -sS https://sunrisesunset.studio/api/db-terminator-webcams \
  | python3 -c "import sys,json; d=json.load(sys.stdin); \
      hits=[w for w in d if w.get('source')=='custom']; \
      print(f'custom webcams returned: {len(hits)}'); \
      print(json.dumps(hits[:2], indent=2)[:500])"
```

Expected: at least 1 custom webcam, with the title/lat/lng matching what was just created. If the terminator query response is cached (via `getCachedTerminatorPayload`), it may take up to 60s for the new row to appear — wait, retry. If still 0 after 2 minutes, halt — likely a query bug in `terminatorPayload.ts` not joining custom rows, or the row is `active=false` somehow.

- [ ] **Step 5: Stash the credentials in a safe local note**

Write the `camera_id` and `device_token` to a local file the Pi can later read. Recommended:
```bash
cat > ~/.sunset-cam-tier0-credentials.json <<EOF
{
  "camera_id": <CAMERA_ID_FROM_STEP_2>,
  "device_token": "<DEVICE_TOKEN_FROM_STEP_2>",
  "hardware_id": "pi-zero-2w-tier0-jesse-house",
  "created_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
chmod 600 ~/.sunset-cam-tier0-credentials.json
```

This is a local scratch file — **do not commit it anywhere**. It exists so that if the Pi flash takes multiple attempts, you don't have to re-run the seed script and rotate the token each time.

---

## Task 4: Pi firmware deployed to physical hardware

**Files:**
- Read-only across the firmware repo at `~/GitHub/sunset-cam-firmware`
- One-time edit on the Pi: `/opt/sunset-cam/config/config.json` (from `config.example.json`)

**Halt condition:** Local tests fail on the dev mac, `pip install -e .` fails on the Pi, `picamera2` import errors out (likely `--system-site-packages` was forgotten on the venv), or the systemd unit fails to start.

- [ ] **Step 1: Local validation on the dev mac**

Run:
```bash
cd ~/GitHub/sunset-cam-firmware
python3.11 -m venv .venv  # safe to re-run; no-op if exists
.venv/bin/pip install -e ".[dev]"
.venv/bin/pytest
```

Expected: tests in `tests/test_config.py`, `tests/test_window.py`, `tests/test_upload.py` all pass. If any fails — particularly `test_upload.py` (which uses `responses` to mock HTTP) — halt; either the firmware drifted from the protocol or the `requests` shape is wrong.

- [ ] **Step 2: Flash a fresh Raspberry Pi OS Lite (64-bit) SD card**

Using the Raspberry Pi Imager:
1. Choose Device: **Raspberry Pi Zero 2 W**
2. Choose OS: **Raspberry Pi OS Lite (64-bit)** (no desktop)
3. Choose Storage: the target SD card
4. Settings (gear icon):
   - **Set hostname:** `sunset-cam-0`
   - **Enable SSH** — use password authentication or paste a public key
   - **Set username/password** — `pi` / a strong password (write it down)
   - **Configure wireless LAN** — the Wi-Fi the Pi will use in its final location
   - **Set locale settings** — your timezone
5. Write the image; eject the card.

No code changes here — this is one-time hardware setup.

- [ ] **Step 3: Boot the Pi, find its IP, SSH in**

Plug the SD card into the Pi Zero 2 W, plug in USB power, wait ~60s for first boot. Find its IP:
```bash
ping sunset-cam-0.local
# or check the router's DHCP leases
```

SSH in:
```bash
ssh pi@sunset-cam-0.local
```

Expected: a shell prompt as `pi@sunset-cam-0`. If `.local` resolution fails, use the raw IP from the router.

- [ ] **Step 4: Clone the firmware repo to `/opt/sunset-cam` on the Pi**

On the Pi:
```bash
sudo mkdir -p /opt/sunset-cam
sudo chown pi:pi /opt/sunset-cam
git clone https://github.com/jessekauppila/sunset-cam-firmware.git /opt/sunset-cam
# Or use the SSH URL if the repo is private; alternatively scp from the dev mac.
cd /opt/sunset-cam
```

If the repo isn't on GitHub yet, instead `rsync` it from the dev mac:
```bash
# On dev mac:
rsync -av --exclude '.venv' --exclude '__pycache__' --exclude '.pytest_cache' \
  ~/GitHub/sunset-cam-firmware/ pi@sunset-cam-0.local:/opt/sunset-cam/
```

- [ ] **Step 5: Run the installer**

On the Pi, in `/opt/sunset-cam`:
```bash
bash scripts/install.sh
```

Expected: apt installs `python3-picamera2 python3-venv git`, creates `.venv` with `--system-site-packages`, installs `requirements.txt` and the package, copies the systemd unit, then prints:
```
==> NOTE: /opt/sunset-cam/config/config.json does not exist.
    Copy config/config.example.json there and fill in
    camera_id, device_token, api_base, capture_window_*.
    Then: sudo systemctl enable --now sunset-cam
```

If apt fails on `python3-picamera2`, the Pi may be on Bookworm and the package name is correct; if on Bullseye the package name differs (`python3-picamera2` was added in Bookworm). Halt and confirm OS version with `lsb_release -a`.

- [ ] **Step 6: Author the deployment config**

On the Pi:
```bash
cp /opt/sunset-cam/config/config.example.json /opt/sunset-cam/config/config.json
nano /opt/sunset-cam/config/config.json
```

Fill in the values produced by Task 3. The deployment date matters for `window_id` and the capture window — pick a 30-minute window starting roughly now in UTC so the first run captures immediately:

```json
{
  "camera_id": <CAMERA_ID_FROM_TASK_3>,
  "device_token": "<DEVICE_TOKEN_FROM_TASK_3>",
  "api_base": "https://www.sunrisesunset.studio",
  "phase": "sunset",
  "window_id": "2026-05-12-sunset-cam<CAMERA_ID>",
  "capture_window_start_utc": "2026-05-12T<HH>:<MM>:00Z",
  "capture_window_end_utc":   "2026-05-12T<HH+0:30>:<MM>:00Z",
  "capture_interval_s": 1.0,
  "log_level": "INFO"
}
```

To get a UTC start ~30s in the future and end 30min later:
```bash
date -u -d '+30 seconds' +%Y-%m-%dT%H:%M:%SZ      # start
date -u -d '+30 minutes 30 seconds' +%Y-%m-%dT%H:%M:%SZ  # end
```

Save (Ctrl-O, Enter, Ctrl-X).

- [ ] **Step 7: Enable and start the systemd unit**

On the Pi:
```bash
sudo systemctl enable --now sunset-cam.service
sudo systemctl status sunset-cam --no-pager
```

Expected: status `active (running)`, no immediate crashes. If `failed`, dump the logs:
```bash
journalctl -u sunset-cam -n 50 --no-pager
```

Common failures:
- `ModuleNotFoundError: No module named 'picamera2'` → venv wasn't created with `--system-site-packages`. Recreate the venv.
- `ValueError: now must be timezone-aware` in `window.py` → bug in `main.py` (it should be passing `datetime.now(timezone.utc)`). Halt and patch.
- `RuntimeError: snapshot upload failed: HTTP 401` → wrong `device_token`. Re-paste from Task 3.
- `RuntimeError: snapshot upload failed: HTTP 404` → wrong `camera_id` or migration not deployed to prod. Re-check Task 1 / Task 3.

---

## Task 5: End-to-end run — one image in the mosaic

**Files:**
- None modified. Pure verification.

**Halt condition:** No `snapshot_id=...` line in journalctl after the capture window opens; or `snapshot_id=...` lines appear but the Firebase Storage object can't be fetched; or the object is in Firebase but the snapshot doesn't appear in the mosaic within 90s.

- [ ] **Step 1: Tail the firmware logs on the Pi**

On the Pi:
```bash
journalctl -u sunset-cam -f
```

Expected within seconds of the window opening (per the config from Task 4 Step 6):
```
<timestamp> INFO sunset_cam starting; camera_id=<N> api_base=https://sunrisesunset.studio
<timestamp> INFO sunset_cam uploaded snapshot_id=<M> bytes=<NNNNN>
<timestamp> INFO sunset_cam uploaded snapshot_id=<M+1> bytes=<NNNNN>
...
```

Each `uploaded snapshot_id=` line is one successfully-ingested frame. The byte count should be roughly 400–800KB for Pi Camera Module 3 Wide at 1920×1080.

- [ ] **Step 2: Verify Firebase Storage has the bytes**

On the dev mac (with credentials configured for `firebase-admin` or `gsutil`):
```bash
gsutil ls "gs://$(grep -E '^(NEXT_PUBLIC_)?FIREBASE_STORAGE_BUCKET=' .env.local | head -1 | cut -d= -f2- | tr -d '"')/snapshots/custom/<CAMERA_ID>/" | head -5
```

Expected: filenames of form `<unix_ms>.jpg` — one per `uploaded snapshot_id=` log line. If the path is empty but logs say uploads succeeded, halt: probable `getFirebaseBucket()` misconfiguration writing to the wrong bucket, or `firebase-admin` silently swallowing errors.

If `gsutil` isn't installed, open the Firebase console → Storage → navigate to `snapshots/custom/<camera_id>/` and confirm visually.

- [ ] **Step 3: Verify Postgres has the snapshot rows**

```bash
psql "$DATABASE_URL" -c "
  SELECT id, webcam_id, captured_at, edge_score, window_id, firebase_url
  FROM webcam_snapshots
  WHERE webcam_id = (SELECT webcam_id FROM cameras
                     WHERE hardware_id='pi-zero-2w-tier0-jesse-house')
  ORDER BY captured_at DESC
  LIMIT 5;
"
```

Expected: 5 most-recent rows, all from today, `window_id` matches the value in `config.json`, `edge_score` is NULL (Tier 0 doesn't compute one), `firebase_url` is a `https://storage.googleapis.com/...` URL.

- [ ] **Step 4: Verify the image is publicly fetchable**

Pick the most recent `firebase_url` from Step 3 and:
```bash
curl -sS -o /tmp/cam0-latest.jpg -w "%{http_code} %{size_download}\n" "<firebase_url>"
file /tmp/cam0-latest.jpg
```

Expected: `200 <bytes>`, and `file` reports `JPEG image data`. If 403, `uploadCameraSnapshot` is failing to call `file.makePublic()` — halt and fix.

- [ ] **Step 5: Verify the camera appears in the live mosaic**

Open `https://sunrisesunset.studio` in a browser. The terminator-ring query polls every ~60s. Look for a new pin near the configured lat/lng with the title from Task 3 (`Tier 0 Test Camera — Jesse House`).

Click the pin; the popup should show the most recent image from the Pi. Refresh after 60s — the image should change (each refresh shows the latest snapshot).

If the pin doesn't appear:
- Hit `/api/db-terminator-webcams` directly with `curl` to see if the row is returned but not rendered (frontend bug), vs. not returned (likely `terminator_webcam_state.active=false` — see Task 1 Step 5).
- Confirm the lat/lng is inside the terminator query's active band right now — if not, the camera is correctly registered but won't display until the terminator passes over its location. Wait or temporarily relocate the test.

- [ ] **Step 6: Halt the firmware before sunset ends (or let it run)**

If you want to verify the upload-stop side of the lifecycle, stop the systemd unit after Step 5:
```bash
sudo systemctl stop sunset-cam
```
and confirm `journalctl -u sunset-cam -n 5` shows `shutdown signal received; exiting cleanly`. Otherwise leave it running — Tier 0 will simply run for the configured window and then idle.

- [ ] **Step 7: Record what worked, what didn't**

Append a session log entry to `~/Documents/Claude Sessions/ongoing/sunset-pi-cameras.md` summarizing:

- date / wall-clock time of first successful end-to-end run
- `camera_id` and last-3-of `device_token` for fingerprint (NOT the full token)
- number of snapshots uploaded in the first window
- any halts / fixes encountered
- the next blocker that would prevent moving to Tier 1 (likely: Tailscale on the Pi + edge ML scoring + operator delivery)

No commit — this is the notes file. The artifact of the Tier 0 build is a single working image in the live mosaic, not a deliverable file.

---

## Self-Review (executed; results inline)

1. **Spec coverage.** The five Tier 0 sub-steps from the notes file — (1) schema migration, (2) snapshot endpoint, (3) test camera SQL, (4) Pi firmware skeleton, (5) end-to-end run — each map 1:1 to a Task above. Task 1 is verify-only because the migration is already applied (notes file, 2026-05-12). ✅
2. **Placeholder scan.** "Real lat/lng of Jesse's house" and the runtime UTC timestamps in Task 4 Step 6 are deliberate operator inputs, not placeholders to be filled by a downstream agent. Every shell command and SQL query is concrete and runnable. Several `<CAMERA_ID_FROM_TASK_3>` / `<DEVICE_TOKEN_FROM_TASK_3>` style substitutions are similarly the documented hand-off mechanism between tasks. ✅
3. **Type consistency.** `device_token_hash` (DB column) ↔ `hashDeviceToken()` (cameraAuth.ts) ↔ `--device-token-hash` (seed SQL psql var). All matched in the existing code; this plan only invokes them. ✅
4. **Branch hygiene.** Plan executes on `feat/tier-0-cameras` (created 2026-05-13 off `main`). Task 2 Step 7 verifies this. ✅
