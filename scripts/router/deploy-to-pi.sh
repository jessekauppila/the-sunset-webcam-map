#!/usr/bin/env bash
# Deploy glinet.py to the kiosk Pi (the jump host on the router's LAN) and
# install the every-5-min signal-log cron. Run from anywhere with Tailscale up:
#   ./deploy-to-pi.sh [pi@sunsetdisplay]
set -euo pipefail
HOST="${1:-pi@sunsetdisplay}"
DIR="$(cd "$(dirname "$0")" && pwd)"

ssh "$HOST" 'mkdir -p ~/router'
scp "$DIR/glinet.py" "$HOST:router/glinet.py"

if ! ssh "$HOST" 'test -s ~/.config/glinet/password'; then
  echo "Router admin password is not on the Pi yet."
  read -rs -p "GL-X3000 admin password (stored on the Pi, chmod 600, never in git): " PW
  echo
  printf '%s' "$PW" | ssh "$HOST" \
    'mkdir -p ~/.config/glinet && cat > ~/.config/glinet/password && chmod 600 ~/.config/glinet/password'
fi

CRON='*/5 * * * * /usr/bin/python3 /home/pi/router/glinet.py log --db /home/pi/router/signal.sqlite --ntfy sunset-kiosk-data-jk7x3q >> /home/pi/router/cron.log 2>&1 # glinet-signal-log'
ssh "$HOST" "( crontab -l 2>/dev/null | grep -v glinet-signal-log ; echo '$CRON' ) | crontab -"

echo "Deployed. Probing the router API (first run on this firmware — expect some MISSes):"
ssh "$HOST" 'python3 ~/router/glinet.py probe' || true
