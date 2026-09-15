#!/bin/bash
# kiosk-doctor.sh — answer "what is the wall actually doing right now?" in one command.
#
# Usage (from your Mac):
#   bash scripts/pi/kiosk-doctor.sh              # diagnose only
#   bash scripts/pi/kiosk-doctor.sh --sync       # also copy scripts/pi/*.sh to the Pi
#   bash scripts/pi/kiosk-doctor.sh --reload     # also reload, and prove it reloaded
#   bash scripts/pi/kiosk-doctor.sh --sync --reload
#   bash scripts/pi/kiosk-doctor.sh --lock       # read-only root: stage, reboot, verify
#   bash scripts/pi/kiosk-doctor.sh --unlock     # writable root: stage, reboot, verify
#   bash scripts/pi/kiosk-doctor.sh --prepare    # one-time setup the lock needs
#
# Order when combined: --unlock, --prepare, --sync, --reload, --lock. A --sync on
# a locked Pi writes the copies through to the card (kiosk-lock.sh persist) and
# FAILS loudly if it cannot; it never reports a sync that a reboot would undo.
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
DO_LOCK=0
DO_UNLOCK=0
DO_PREPARE=0
for arg in "$@"; do
  case "$arg" in
    --sync) DO_SYNC=1 ;;
    --reload) DO_RELOAD=1 ;;
    --lock) DO_LOCK=1 ;;
    --unlock) DO_UNLOCK=1 ;;
    --prepare) DO_PREPARE=1 ;;
    -h|--help) sed -n '2,28p' "$0"; exit 0 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

say() { printf '\n\033[1m%s\033[0m\n' "$1"; }
ok()   { printf '  ok    %s\n' "$1"; }
bad()  { printf '  FAIL  %s\n' "$1"; }
info() { printf '        %s\n' "$1"; }

# Reboot the Pi and block until ssh answers again (or give up). Prints what
# it saw; the caller decides what the new state means.
reboot_and_wait() {
  ssh "pi@$HOST" 'sudo reboot' >/dev/null 2>&1
  local t0 elapsed
  t0=$(date +%s)
  sleep 15
  while :; do
    if ssh -o ConnectTimeout=5 -o BatchMode=yes "pi@$HOST" true 2>/dev/null; then
      info "ssh back after $(( $(date +%s) - t0 ))s"
      return 0
    fi
    elapsed=$(( $(date +%s) - t0 ))
    if [ "$elapsed" -ge 300 ]; then
      bad "no ssh after ${elapsed}s — the Pi did not come back on its own"
      info "Get to the Pi. If the overlay is what broke the boot, mount the card on"
      info "another machine and delete 'overlayroot=tmpfs ' from cmdline.txt."
      return 1
    fi
    sleep 5
  done
}

lock_state() { ssh -o ConnectTimeout=10 "pi@$HOST" 'bash ~/kiosk-lock.sh status 2>/dev/null' 2>/dev/null | grep "^$1=" | cut -d= -f2-; }

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
    xrandr --query 2>/dev/null | awk "/connected/ {print \"ROT=\" \$1 \" \" \$2 \" \" \$3 \" \" \$4 \" \" \$5}"
    echo "ORIENTATION=$(grep -s "^ORIENTATION=" /home/pi/kiosk.env | cut -d= -f2)"
  else
    echo "X=down"
  fi
  echo "WINDOWS=$(xdotool search --onlyvisible --class chromium 2>/dev/null | wc -l | tr -d " ")"
  for w in $(xdotool search --onlyvisible --class chromium 2>/dev/null); do
    echo "TITLE=$(xdotool getwindowname "$w" 2>/dev/null)"
  done
  pgrep -a chromium 2>/dev/null | grep -o "https://[^ ]*" | sort -u | sed "s/^/URL=/"
  if [ -f /home/pi/kiosk-watchdog.sh ]; then
    bash /home/pi/kiosk-watchdog.sh --status 2>/dev/null | sed "s/^/WD_/"
  else
    echo "WD_CRON=missing"
  fi
  if [ -f /home/pi/kiosk-lock.sh ]; then
    bash /home/pi/kiosk-lock.sh status 2>/dev/null | sed "s/^/LK_/"
  else
    echo "LK_OVERLAY_NOW=missing"
  fi
' 2>/dev/null)

get() { printf '%s\n' "$STATE" | grep "^$1=" | head -1 | cut -d= -f2-; }

info "$(get UPTIME)"

if [ "$(get X)" = "up" ]; then
  ok "X server is up"
  DPMS=$(get DPMS)
  OUTPUTS=$(get OUTPUTS)
  info "monitors connected: ${OUTPUTS:-unknown}"
  # Orientation is a setting on the Pi (kiosk.env) and a fact in X (xrandr).
  # Both are printed so a mismatch between them, or with the /studio panel
  # preset, is visible here rather than only on the glass.
  info "kiosk.env ORIENTATION=$(get ORIENTATION) (empty = portrait default)"
  printf '%s\n' "$STATE" | grep '^ROT=' | sed 's/^ROT=/xrandr /' | while read -r line; do info "$line"; done
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

# A window titled with the URL instead of "Kiosk Display" is on an error
# page, a crash page, or still loading — the case issue #196 is about. The
# watchdog reloads it after two sightings; this just shows what it sees.
printf '%s\n' "$STATE" | grep '^TITLE=' | cut -d= -f2- | while read -r title; do
  case "$title" in
    *"Kiosk Display"*) ok "window titled [$title]" ;;
    *) bad "window titled [$title] — not the kiosk page (error page? still loading?)" ;;
  esac
done

case "$(get WD_CRON)" in
  present) ok "watchdog cron present, last run $(get WD_LAST_RUN_AGE_S)s ago" ;;
  missing) bad "kiosk-watchdog.sh is not on the Pi — run with --sync" ;;
  *)       bad "watchdog cron line absent — run with --sync, or on the Pi: bash ~/kiosk-watchdog.sh --install" ;;
esac
printf '%s\n' "$STATE" | grep '^WD_LOG=' | cut -d= -f2- | while read -r line; do info "watchdog: $line"; done

# The card. "on" means every write since boot lives in RAM and the plug is
# safe to pull; "off" means a yanked cord can corrupt the SD (issue #203).
OVERLAY=$(get LK_OVERLAY_NOW)
case "$OVERLAY" in
  on)      ok "root is READ-ONLY (overlay on, RAM upper $(get LK_UPPER_USED); boot ro=$(get LK_BOOTRO_NOW)) — the plug is safe to pull" ;;
  off)     info "root is WRITABLE (overlay off) — pulling the plug can corrupt the card; the case button is the safe off"
           info "prepared for lock: $(get LK_PREPARED)" ;;
  missing) info "kiosk-lock.sh is not on the Pi — run with --sync to get the lock state" ;;
  *)       info "lock state not reported" ;;
esac
if [ "$(get LK_OVERLAY_NOW)" != "$(get LK_OVERLAY_CONF)" ] && [ -n "$(get LK_OVERLAY_CONF)" ]; then
  bad "overlay is $(get LK_OVERLAY_NOW) now but configured $(get LK_OVERLAY_CONF) — a reboot is pending"
fi

# --------------------------------------------------------------- step 3b: unlock
# Before sync, so a sync that needs OS-level writes lands on a writable root.
if [ "$DO_UNLOCK" = "1" ]; then
  say "3b. Unlocking the card (writable root)"
  if [ "$OVERLAY" != "on" ]; then
    info "overlay is already off — nothing to unlock"
  else
    ssh "pi@$HOST" 'bash ~/kiosk-lock.sh unlock' | while read -r line; do info "$line"; done
    if [ "$(lock_state OVERLAY_CONF)" = "off" ]; then
      info "rebooting to apply"
      reboot_and_wait || exit 1
      OVERLAY=$(lock_state OVERLAY_NOW)
      if [ "$OVERLAY" = "off" ]; then ok "root is writable (overlay off)"; else bad "overlay still $OVERLAY after the reboot"; exit 1; fi
    else
      bad "unlock did not take — see the lines above"
      exit 1
    fi
  fi
fi

# -------------------------------------------------------------- step 3c: prepare
if [ "$DO_PREPARE" = "1" ]; then
  say "3c. Preparing the Pi for a read-only root"
  ssh "pi@$HOST" 'bash ~/kiosk-lock.sh prepare' | while read -r line; do
    case "$line" in *FAIL*|*refused*) bad "$line" ;; *) ok "$line" ;; esac
  done
fi

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
  # On a locked Pi that scp landed in RAM. Write the same files through to the
  # card, or say plainly that the next reboot will undo this sync.
  if [ "$OVERLAY" = "on" ]; then
    FILES=$(ls -1 scripts/pi/*.sh | xargs -n1 basename | tr '\n' ' ')
    P=$(ssh "pi@$HOST" "bash ~/kiosk-lock.sh persist $FILES" 2>&1)
    case "$P" in
      *"PERSIST=ok"*) ok "$(printf '%s\n' "$P" | grep '^PERSIST=' | cut -d= -f2-)" ;;
      *) bad "NOT persisted — these copies vanish at the next reboot"
         printf '%s\n' "$P" | while read -r line; do info "$line"; done
         exit 1 ;;
    esac
  fi
  # The watchdog is a cron line, not a running process, so a fresh copy is
  # live as soon as the line exists. Idempotent.
  if WD=$(ssh "pi@$HOST" 'bash ~/kiosk-watchdog.sh --install' 2>&1); then
    ok "watchdog: $WD"
  else
    bad "watchdog install failed: $WD"
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

# ---------------------------------------------------------------- step 6: lock
if [ "$DO_LOCK" = "1" ]; then
  say "6. Locking the card (read-only root)"
  if [ "$(lock_state OVERLAY_NOW)" = "on" ]; then
    info "overlay is already on — nothing to lock"
  else
    ssh "pi@$HOST" 'bash ~/kiosk-lock.sh lock' | while read -r line; do info "$line"; done
    if [ "$(lock_state OVERLAY_CONF)" = "on" ]; then
      info "rebooting to apply"
      reboot_and_wait || exit 1
      NOW=$(lock_state OVERLAY_NOW)
      if [ "$NOW" = "on" ]; then
        ok "root is READ-ONLY (overlay on, RAM upper $(lock_state UPPER_USED), boot ro=$(lock_state BOOTRO_NOW))"
        info "The glass relaunches on its own; give it two minutes, then run the doctor plain."
      else
        bad "overlay is $NOW after the reboot — the card is still writable"
        exit 1
      fi
    else
      bad "lock did not stage — see the lines above (usually: run --prepare first)"
      exit 1
    fi
  fi
fi

say "Done"
