#!/usr/bin/env bash
# One-shot router capture for the wifi catch-22: joining the router's wifi cuts
# this machine's internet (and the Claude session with it), so nothing can be
# diagnosed live. Instead: join GL-X3000-ced, run this (pure LAN, no internet
# needed), flip back to home wifi, and let Claude read the output file.
#
# Needs the admin password in ~/.config/sunset/router.env (init-secrets.sh).
# Output includes ICCID/IMEI if the firmware reports them — that's the point
# (ICCID compare vs the US Mobile app) — so don't commit the capture file.
set -uo pipefail  # deliberately no -e: capture as much as possible
DIR="$(cd "$(dirname "$0")" && pwd)"
OUT="$HOME/router-capture.txt"
HOST="$(grep -E '^GLINET_HOST=' "$HOME/.config/sunset/router.env" 2>/dev/null | tail -1 | cut -d= -f2-)"
HOST="${HOST:-192.168.8.1}"

{
  echo "=== router capture $(date -u +%Y-%m-%dT%H:%M:%SZ) host=$HOST ==="
  echo "--- ping ---";   ping -c 2 "$HOST" 2>&1 | tail -3
  echo "--- login ---";  python3 "$DIR/glinet.py" --host "$HOST" login 2>&1
  echo "--- probe ---";  python3 "$DIR/glinet.py" --host "$HOST" probe 2>&1
  echo "--- status ---"; python3 "$DIR/glinet.py" --host "$HOST" status --json 2>&1
  echo "--- usage ---";  python3 "$DIR/glinet.py" --host "$HOST" usage 2>&1
} > "$OUT" 2>&1
echo "Wrote $OUT"
echo "Reconnect to home wifi, then tell Claude to read it."
