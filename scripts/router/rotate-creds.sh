#!/usr/bin/env bash
# Rotate the GL-X3000 credentials that leaked into public git history
# (commit f8503237e): admin password + wifi PSK. Runs entirely "from here" —
# directly if this machine is on the router's wifi, otherwise through the
# kiosk Pi jump host over Tailscale.
#
# Ordering is the whole point: the Pi's spitz profile gets the new PSK BEFORE
# the router does, so the recovery path is never stranded. Secrets come from
# ~/.config/sunset/router.env (see init-secrets.sh) and travel over stdin,
# never argv. Nothing secret is printed.
#
# Usage: ./rotate-creds.sh [pi@sunsetdisplay]
set -euo pipefail
ENV_FILE="$HOME/.config/sunset/router.env"
PI="${1:-pi@sunsetdisplay}"
DIR="$(cd "$(dirname "$0")" && pwd)"
SSH=(ssh -o BatchMode=yes -o ConnectTimeout=6 -o StrictHostKeyChecking=accept-new)

[ -f "$ENV_FILE" ] || { echo "Missing $ENV_FILE — run ./init-secrets.sh first."; exit 1; }
# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a
: "${GLINET_PASSWORD:?run init-secrets.sh}" "${GLINET_NEW_PASSWORD:?}" "${WIFI_NEW_PSK:?}"
HOST="${GLINET_HOST:-192.168.8.1}"

case "$GLINET_PASSWORD" in *"'"*) echo "Current password contains a single quote — handle this rotation manually."; exit 1;; esac

setk() {
  grep -vE "^$1=" "$ENV_FILE" > "$ENV_FILE.tmp" || true
  printf '%s=%s\n' "$1" "$2" >> "$ENV_FILE.tmp"
  mv "$ENV_FILE.tmp" "$ENV_FILE"; chmod 600 "$ENV_FILE"
}
delk() {
  grep -vE "^$1=" "$ENV_FILE" > "$ENV_FILE.tmp" || true
  mv "$ENV_FILE.tmp" "$ENV_FILE"; chmod 600 "$ENV_FILE"
}

# --- Reachability: direct LAN or via the Pi -------------------------------
PI_OK=0
"${SSH[@]}" "$PI" true 2>/dev/null && PI_OK=1

if curl -sm 3 -o /dev/null "http://$HOST/rpc"; then
  VIA="direct"
  gl() { GLINET_PASSWORD="$1" python3 "$DIR/glinet.py" --host "$HOST" "${@:2}"; }
elif [ "$PI_OK" = 1 ]; then
  VIA="via $PI"
  "${SSH[@]}" "$PI" 'mkdir -p ~/router'
  scp -q "$DIR/glinet.py" "$PI:router/glinet.py"
  # Line 1 of the remote stdin is the password; the rest (if piped in, e.g.
  # JSON params for `raw ... -`) is forwarded through. Secrets never hit argv.
  gl() {
    { printf '%s\n' "$1"; [ -t 0 ] || cat; } | "${SSH[@]}" "$PI" \
      'read -r GP; GLINET_PASSWORD="$GP" python3 ~/router/glinet.py --host '"$HOST"' '"${*:2}"
  }
else
  echo "Router not reachable directly, and $PI is not on Tailscale."
  echo "Nothing can be rotated until the router is powered and something can see it."
  exit 1
fi
echo "Router reachable ($VIA). Verifying current admin password..."
gl "$GLINET_PASSWORD" login

# --- Step 1: Pi first — new PSK into spitz, new admin pw into its file ----
if [ "$PI_OK" = 1 ]; then
  "${SSH[@]}" "$PI" "sudo nmcli con modify spitz wifi-sec.psk '$WIFI_NEW_PSK'"
  printf '%s' "$GLINET_NEW_PASSWORD" | "${SSH[@]}" "$PI" \
    'mkdir -p ~/.config/glinet && cat > ~/.config/glinet/password && chmod 600 ~/.config/glinet/password'
  echo "Step 1 OK: Pi holds the new PSK (spitz) and new admin password."
else
  echo "WARNING: Pi unreachable — will rotate the admin password only."
  echo "         Refusing to touch the wifi PSK (it would strand the Pi)."
fi

# --- Step 2: router admin password — API method varies by firmware --------
CHANGED_PW=0
for om in "system set_password" "system change_password" "user set_password"; do
  if printf '{"username":"root","old":"%s","password":"%s"}\n' \
       "$GLINET_PASSWORD" "$GLINET_NEW_PASSWORD" \
     | gl "$GLINET_PASSWORD" raw $om - >/dev/null 2>&1; then
    if gl "$GLINET_NEW_PASSWORD" login >/dev/null 2>&1; then
      CHANGED_PW=1; echo "Step 2 OK: admin password rotated (API: $om)."; break
    fi
  fi
done
if [ "$CHANGED_PW" = 1 ]; then
  setk GLINET_PASSWORD "$GLINET_NEW_PASSWORD"; delk GLINET_NEW_PASSWORD
else
  echo "Step 2 MANUAL: no known password API on this firmware. Change it in the panel"
  echo "  (System → Admin password) using GLINET_NEW_PASSWORD from $ENV_FILE, then run:"
  echo "  python3 $DIR/glinet.py login   # and promote the key in the env file"
  [ "$VIA" = direct ] || echo "  Panel from here: ssh -L 8081:$HOST:80 $PI  →  http://localhost:8081"
fi

# --- Step 3: wifi PSK on the router — panel, deliberately not API-guessed --
if [ "$PI_OK" = 1 ]; then
  echo
  echo "Step 3 (wifi PSK — safe to do now, the Pi already has the new one):"
  echo "  Panel → WIRELESS → change the password for BOTH GL-X3000-ced and"
  echo "  GL-X3000-ced-5G to WIFI_NEW_PSK from $ENV_FILE. Keep the SSIDs unchanged."
  [ "$VIA" = direct ] || echo "  Panel from here: ssh -L 8081:$HOST:80 $PI  →  http://localhost:8081"
  echo "  (Not automated on purpose: wifi-config API shapes vary by firmware and a"
  echo "   wrong guess kills the LAN. After the first live 'probe' we can automate.)"
  read -rp "Press Enter AFTER changing the PSK in the panel (or Ctrl-C to stop here)..."
  echo "Waiting up to 90s for the Pi to rejoin with the new PSK..."
  for _ in $(seq 1 18); do
    if "${SSH[@]}" "$PI" true 2>/dev/null; then
      setk WIFI_PSK "$WIFI_NEW_PSK"; delk WIFI_NEW_PSK
      echo "Step 3 OK: Pi reconnected on the new PSK. Rotation complete."
      echo "Remaining by hand: update the PSK on your Mac/phone (read it from $ENV_FILE)"
      echo "and file both new values in the password manager."
      exit 0
    fi
    sleep 5
  done
  echo "Pi did NOT come back in 90s. Old PSK may still be active, or the Pi is"
  echo "mid-reconnect. Check the panel; do not power off anything yet."
  exit 1
fi
