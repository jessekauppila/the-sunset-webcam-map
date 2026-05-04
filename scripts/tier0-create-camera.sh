#!/usr/bin/env bash
# Tier 0: create one custom camera and print the device token + camera_id.
#
# Usage:
#   DATABASE_URL=... ./scripts/tier0-create-camera.sh \
#     --hardware-id pi-zero-2w-tier0-jesse-house \
#     --lat 47.6062 --lng -122.3321 \
#     --timezone America/Los_Angeles \
#     --title "Tier 0 Test Camera" \
#     --phase sunset
#
# Outputs the plaintext device_token (64 hex chars) and camera_id.
# Copy both into sunset-cam-firmware/config/config.json.

set -euo pipefail

HARDWARE_ID=""
LAT=""
LNG=""
TIMEZONE=""
TITLE="Tier 0 Test Camera"
PHASE="sunset"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --hardware-id) HARDWARE_ID="$2"; shift 2 ;;
    --lat) LAT="$2"; shift 2 ;;
    --lng) LNG="$2"; shift 2 ;;
    --timezone) TIMEZONE="$2"; shift 2 ;;
    --title) TITLE="$2"; shift 2 ;;
    --phase) PHASE="$2"; shift 2 ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
done

for v in HARDWARE_ID LAT LNG TIMEZONE; do
  if [[ -z "${!v}" ]]; then
    echo "missing required flag for $v" >&2
    exit 2
  fi
done

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL must be set" >&2
  exit 2
fi

# Generate a 32-byte hex token and its SHA-256 hash.
TOKEN="$(openssl rand -hex 32)"
TOKEN_HASH="$(printf '%s' "$TOKEN" | openssl dgst -sha256 -hex \
  | awk '{print $NF}')"

CAMERA_ID="$(psql "$DATABASE_URL" -At -v ON_ERROR_STOP=1 \
  -v hardware_id="$HARDWARE_ID" \
  -v device_token_hash="$TOKEN_HASH" \
  -v lat="$LAT" -v lng="$LNG" \
  -v timezone="$TIMEZONE" \
  -v title="$TITLE" -v phase="$PHASE" \
  -f database/seeds/tier0-test-camera.sql \
  | tail -n 1)"

if ! [[ "$CAMERA_ID" =~ ^[0-9]+$ ]]; then
  echo "failed to read camera_id from psql output" >&2
  exit 1
fi

cat <<EOF

Tier 0 camera created.

  camera_id:     $CAMERA_ID
  device_token:  $TOKEN

Paste these into sunset-cam-firmware/config/config.json under
"camera_id" and "device_token". The token is shown ONCE — store it now.
EOF
