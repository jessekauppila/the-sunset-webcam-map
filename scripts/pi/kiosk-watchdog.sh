#!/bin/bash
# kiosk-watchdog.sh — reload a kiosk tab that is sitting on an error page.
#
# Usage on the Pi:
#   bash ~/kiosk-watchdog.sh --once      # one check (what cron runs every minute)
#   bash ~/kiosk-watchdog.sh --install   # add the cron line (idempotent)
#   bash ~/kiosk-watchdog.sh --status    # cron line present? last run? recent log
#
# The canonical copy lives in the repo at scripts/pi/kiosk-watchdog.sh and is
# pushed to the Pi by `kiosk-doctor.sh --sync`, which also runs --install.
#
# Why this exists (issue #196):
#   After a power event the Pi can finish booting before the GL-X3000 has
#   internet. Both Chromium tabs then land on a Chromium network-error page
#   and stay there until a person reloads them. The build-stamp self-reload
#   cannot rescue this: on an error page none of our JavaScript runs, so
#   nothing polls and nothing reloads. Dead tabs also stop POSTing
#   /api/kiosk/tick, which is what drives the terminator sweep.
#
# How a bad tab is recognised:
#   The kiosk page titles itself "… Kiosk Display" (app/kiosk/layout.tsx), so
#   its X window is named "Sunset Webcam — Kiosk Display - Chromium". A network
#   error page, an "Aw, Snap!" crash page, and a tab still loading are all
#   titled with the URL instead. So: a visible Chromium window whose name lacks
#   the mark is suspect. A suspect must be seen on TWO consecutive runs before
#   it is reloaded, which is what keeps a page that is merely still loading
#   from being kicked. The mark is a setting (KIOSK_TITLE_MARK in kiosk.env) so
#   a title change in the app is one line here, not a silent watchdog death.
#
# How it reloads:
#   Exactly like reload-kiosk.sh — focus the window (--sync), then Ctrl+R via
#   XTEST. Chromium ignores unfocused synthetic keys; see
#   docs/solutions/integration-issues/chromium-ignores-xdotool-keystrokes-without-focus.md.
#   Only the bad window is reloaded, so a healthy panel never blinks.
#
# What Chromium does on its own (measured on the Pi 2026-09-15, Chromium 152):
#   a reload against a dead uplink takes ~20 s to show the error page (TCP
#   retries), and Chromium auto-reloads a net-error page with growing backoff
#   once the network is back — 11 s after a 60 s outage. So for a short blip
#   this script never fires. It exists for the long boot-time outage, where
#   that backoff climbs to many minutes, and for the "Aw, Snap!" crash page,
#   which Chromium never retries. Worst case with this running: about two
#   minutes from the network returning to pictures.
#
# State lives under /tmp (tmpfs), so it survives nothing and writes nothing
# to the SD card — deliberate, ahead of the read-only root work (issue #203).

export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-/home/pi/.Xauthority}"

KIOSK_TITLE_MARK="Kiosk Display"
[ -f /home/pi/kiosk.env ] && . /home/pi/kiosk.env

STATE_DIR=/tmp/kiosk-watchdog
LOG="$STATE_DIR/log"
SELF=/home/pi/kiosk-watchdog.sh
CRON_LINE="* * * * * /bin/bash $SELF --once >/dev/null 2>&1"

mkdir -p "$STATE_DIR"

log() {
  printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" >> "$LOG"
  # keep the log bounded; it is on tmpfs
  if [ "$(wc -l < "$LOG")" -gt 300 ]; then
    tail -n 200 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
  fi
}

once() {
  date +%s > "$STATE_DIR/last-run"
  if ! xset q >/dev/null 2>&1; then
    log "no X on $DISPLAY — nothing to watch"
    return 0
  fi

  windows=$(xdotool search --onlyvisible --class chromium 2>/dev/null)
  if [ -z "$windows" ]; then
    log "no visible Chromium windows — that is kiosk-launch.sh's job, not mine"
    return 0
  fi

  for w in $windows; do
    name=$(xdotool getwindowname "$w" 2>/dev/null)
    strikes="$STATE_DIR/strikes.$w"
    case "$name" in
      *"$KIOSK_TITLE_MARK"*)
        rm -f "$strikes"
        ;;
      *)
        n=$(( $(cat "$strikes" 2>/dev/null || echo 0) + 1 ))
        echo "$n" > "$strikes"
        if [ "$n" -lt 2 ]; then
          log "window $w suspect (1/2): [$name]"
        elif xdotool windowactivate --sync "$w" && xdotool key --clearmodifiers ctrl+r; then
          # "Sent", not "Reloaded": xdotool exits 0 on delivery, not on effect.
          log "window $w sent Ctrl+R after $n strikes: [$name]"
          rm -f "$strikes"
        else
          log "window $w FAILED to reload (xdotool): [$name]"
        fi
        ;;
    esac
  done
}

install_cron() {
  current=$(crontab -l 2>/dev/null)
  if printf '%s\n' "$current" | grep -qF "$SELF --once"; then
    echo "cron line already present"
  else
    { [ -n "$current" ] && printf '%s\n' "$current"; printf '%s\n' "$CRON_LINE"; } | crontab -
    echo "cron line installed: $CRON_LINE"
  fi
}

status() {
  if crontab -l 2>/dev/null | grep -qF "$SELF --once"; then
    echo "CRON=present"
  else
    echo "CRON=absent"
  fi
  if [ -f "$STATE_DIR/last-run" ]; then
    echo "LAST_RUN_AGE_S=$(( $(date +%s) - $(cat "$STATE_DIR/last-run") ))"
  else
    echo "LAST_RUN_AGE_S=never"
  fi
  [ -f "$LOG" ] && tail -n 5 "$LOG" | sed 's/^/LOG=/'
}

case "${1:---once}" in
  --once)    once ;;
  --install) install_cron ;;
  --status)  status ;;
  -h|--help) sed -n '2,8p' "$0" ;;
  *) echo "Unknown option: $1" >&2; exit 2 ;;
esac
