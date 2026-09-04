#!/bin/bash
# kiosk-doctor.sh — answer "what is the wall actually doing right now?" in one command.
#
# Usage (from your Mac):
#   bash scripts/pi/kiosk-doctor.sh              # diagnose only
#   bash scripts/pi/kiosk-doctor.sh --sync       # also copy scripts/pi/*.sh to the Pi
#   bash scripts/pi/kiosk-doctor.sh --reload     # also reload, and prove it reloaded
#   bash scripts/pi/kiosk-doctor.sh --sync --reload
#
# Env: KIOSK_HOST overrides the default host.
#
# Why this exists:
#   "The kiosk looks wrong" has three completely different causes that all
#   present identically as silence — this Mac is off the tailnet, the Pi is
#   powered off, or the Pi is fine and only the monitors are off. Guessing
#   between them wastes the most time, so this checks them in that order and
#   refuses to move on until each one is settled.
#
#   Every check reports what it observed. Nothing here prints success it did
#   not verify — see
#   docs/solutions/integration-issues/chromium-ignores-xdotool-keystrokes-without-focus.md
#   for the bug that motivated that rule.

set -u

HOST="${KIOSK_HOST:-sunsetdisplay}"
DO_SYNC=0
DO_RELOAD=0
for arg in "$@"; do
  case "$arg" in
    --sync) DO_SYNC=1 ;;
    --reload) DO_RELOAD=1 ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

say() { printf '\n\033[1m%s\033[0m\n' "$1"; }
ok()   { printf '  ok    %s\n' "$1"; }
bad()  { printf '  FAIL  %s\n' "$1"; }
info() { printf '        %s\n' "$1"; }

# ---------------------------------------------------------------- step 1: Mac
# Checked first and fatally, because every downstream symptom is identical to
# "the Pi is dead" when this Mac is simply not on the tailnet.
say "1. This Mac's tailnet"
if [ -n "${KIOSK_HOST:-}" ]; then
  # An explicit host is the LAN route (sunsetdisplay.lan / 192.168.8.x on the
  # GL-X3000 wifi). The tailnet is irrelevant to it, so don't fail on it.
  info "KIOSK_HOST=$HOST — skipping the tailnet check (LAN route)"
elif ifconfig 2>/dev/null | grep -q 'inet 100\.'; then
  ok "on the tailnet"
else
  bad "this Mac has no 100.x tailnet address — the Pi's state is UNKNOWN from here"
  info "Common cause: the Tailscale system extension is stuck mid-upgrade."
  info "Check with:  systemextensionsctl list | grep -i tailscale"
  info "A line reading 'activated waiting to upgrade' needs a Mac reboot."
  info ""
  info "To learn whether the Pi is up without fixing this Mac, open"
  info "login.tailscale.com/admin/machines and read sunsetdisplay's last-seen."
  exit 1
fi

# ---------------------------------------------------------------- step 2: Pi
say "2. Reaching $HOST"
if ssh -o ConnectTimeout=8 -o BatchMode=yes "pi@$HOST" true 2>/dev/null; then
  ok "ssh succeeded — the Pi is powered and networked"
else
  bad "cannot ssh to $HOST"
  # Re-run once, unsilenced, so the reason is on screen: a timeout means the
  # Pi is unreachable; "Permission denied (publickey)" means it is up and
  # refusing this Mac's key, which no amount of power-cycling will fix.
  ERR=$(ssh -o ConnectTimeout=8 -o BatchMode=yes "pi@$HOST" true 2>&1)
  info "ssh: $ERR"
  case "$ERR" in
    *"Permission denied"*)
      info "The Pi is UP and refusing this Mac's key. Power-cycling will not help."
      info "Add ~/.ssh/id_ed25519.pub to /home/pi/.ssh/authorized_keys on the Pi"
      info "(dir mode 700, file mode 600), from its keyboard or another authorized machine." ;;
    *"Host key verification"*)
      info "No known_hosts entry for this name. Use the address instead, e.g."
      info "  KIOSK_HOST=192.168.8.223 bash $0" ;;
    *)
      if [ -n "${KIOSK_HOST:-}" ]; then
        info "Is this Mac on the Pi's wifi (the GL-X3000 network)? The LAN route needs it."
      else
        info "This Mac IS on the tailnet, so this is the Pi's end: powered off, or"
        info "off the network. Note the Pi rides the GL-X3000 travel router — if the"
        info "router left the Pi's location, the Pi has no internet regardless of power."
        info "Confirm which at login.tailscale.com/admin/machines, then power-cycle in person."
      fi ;;
  esac
  exit 1
fi

# ------------------------------------------------------- step 3: what it's doing
# One SSH round trip; parsed on the Mac so the remote side stays quotable.
say "3. Kiosk state"
STATE=$(ssh -o ConnectTimeout=10 "pi@$HOST" '
  export DISPLAY=:0
  echo "UPTIME=$(uptime -p 2>/dev/null)"
  if xset q >/dev/null 2>&1; then
    echo "X=up"
    echo "DPMS=$(xset q | awk "/Monitor is/ {print \$3}")"
    echo "OUTPUTS=$(xrandr 2>/dev/null | grep -c " connected")"
  else
    echo "X=down"
  fi
  echo "WINDOWS=$(xdotool search --onlyvisible --class chromium 2>/dev/null | wc -l | tr -d " ")"
  pgrep -a chromium 2>/dev/null | grep -o "https://[^ ]*" | sort -u | sed "s/^/URL=/"
' 2>/dev/null)

get() { printf '%s\n' "$STATE" | grep "^$1=" | head -1 | cut -d= -f2-; }

info "$(get UPTIME)"

if [ "$(get X)" = "up" ]; then
  ok "X server is up"
  DPMS=$(get DPMS)
  OUTPUTS=$(get OUTPUTS)
  info "monitors connected: ${OUTPUTS:-unknown}"
  case "$DPMS" in
    On)  ok "monitors are awake (DPMS On)" ;;
    "")  info "DPMS state not reported" ;;
    *)   bad "monitors are asleep or blanked (DPMS $DPMS)"
         info "The Pi is fine; only the screens are dark. Wake them with:"
         info "  ssh pi@$HOST 'DISPLAY=:0 xset dpms force on'" ;;
  esac
else
  bad "no X server on :0 — the desktop session did not start"
  info "Check the autostart profile is rpd-x, not LXDE-pi."
fi

WINDOWS=$(get WINDOWS)
if [ "${WINDOWS:-0}" -ge 2 ]; then
  ok "$WINDOWS visible Chromium kiosk windows"
elif [ "${WINDOWS:-0}" -ge 1 ]; then
  bad "only $WINDOWS visible Chromium window — expected 2"
else
  bad "no visible Chromium kiosk windows — kiosk-launch.sh did not run"
fi

printf '%s\n' "$STATE" | grep '^URL=' | sed 's/^URL=/        serving /'

# ---------------------------------------------------------------- step 4: sync
if [ "$DO_SYNC" = "1" ]; then
  say "4. Syncing scripts/pi/*.sh"
  # The Pi's copies are copies, not a checkout, so they drift silently.
  if scp -q scripts/pi/*.sh "pi@$HOST:/home/pi/"; then
    ok "copied $(ls -1 scripts/pi/*.sh | wc -l | tr -d ' ') script(s)"
  else
    bad "scp failed — the Pi is running whatever it had before"
    exit 1
  fi
fi

# -------------------------------------------------------------- step 5: reload
if [ "$DO_RELOAD" = "1" ]; then
  say "5. Reloading, and proving it"
  BEFORE=$(ssh "pi@$HOST" 'export DISPLAY=:0; scrot -o /tmp/kd-a.png && md5 -q /tmp/kd-a.png 2>/dev/null || md5sum /tmp/kd-a.png | cut -d" " -f1' 2>/dev/null)
  ssh "pi@$HOST" 'bash ~/reload-kiosk.sh' || bad "reload-kiosk.sh reported failure (see its stderr above)"
  AFTER=$(ssh "pi@$HOST" 'export DISPLAY=:0; sleep 3; scrot -o /tmp/kd-b.png && md5 -q /tmp/kd-b.png 2>/dev/null || md5sum /tmp/kd-b.png | cut -d" " -f1' 2>/dev/null)

  if [ -n "$BEFORE" ] && [ "$BEFORE" = "$AFTER" ]; then
    bad "screen is byte-identical across the reload — nothing reloaded"
    info "That is conclusive. Investigate the reload path, not the app."
  else
    info "screen changed across the reload"
    info "NOT conclusive on its own: the mosaic drifts continuously, so pixels"
    info "change with or without a reload. To confirm the new build is live,"
    info "look for content only it produces."
  fi
fi

say "Done"
