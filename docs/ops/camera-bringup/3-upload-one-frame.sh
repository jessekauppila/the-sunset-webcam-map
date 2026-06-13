#!/usr/bin/env bash
# Step 3 — POST one frame to camera 4 so it lights up the My Cameras map (#64)
# and the detail page (#65). Requires the pairing (steps 1-2) to be done first,
# or the server returns 404 "camera has no paired webcam row".
#
# Env-var driven (paste-safe — no secrets inline). Set these, then run:
#   export BASE_URL="https://<your-deployed-origin>"     # NOT localhost; the prod/preview URL
#   export DEVICE_TOKEN="<camera 4's 64-hex device token>" # the one on the Pi's config.json
#   export IMAGE="/path/to/any.jpg"                        # any jpg <= 5MB
#   bash .superpowers/camera4-bringup/3-upload-one-frame.sh
#
# Optional: CAMERA_ID (default 4), PHASE (default sunset).
set -euo pipefail

: "${BASE_URL:?set BASE_URL to your deployed origin, e.g. https://your-app.vercel.app}"
: "${DEVICE_TOKEN:?set DEVICE_TOKEN to camera 4's device token (from the Pi config)}"
: "${IMAGE:?set IMAGE to a path to a jpg file}"
CAMERA_ID="${CAMERA_ID:-4}"
PHASE="${PHASE:-sunset}"        # must be 'sunrise' or 'sunset'
NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

curl -sS -X POST "$BASE_URL/api/cameras/$CAMERA_ID/snapshot" \
  -H "Authorization: Bearer $DEVICE_TOKEN" \
  -F "image=@$IMAGE" \
  -F "phase=$PHASE" \
  -F "captured_at=$NOW" \
  -F "window_id=manual-commission-$NOW" \
  -w '\nHTTP %{http_code}\n'

# Expected: HTTP 202 with {"snapshot_id":N,"accepted_at":"..."}.
# Then: camera 4 shows a thumbnail on the My Cameras globe, and /cameras/4 has
# one image in its history. (captured_at=now → likely "stale/offline" health
# unless you're actually in a sunset window; that's fine for the render test.)
