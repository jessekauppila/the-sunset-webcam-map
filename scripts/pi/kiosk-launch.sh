#!/bin/bash
# Dual-monitor sunrise/sunset kiosk launcher for sunsetdisplay.
# Called from the desktop session autostart. Assumes X11 session.
#
# The canonical copy lives in the repo at scripts/pi/kiosk-launch.sh and is
# pushed to the Pi by `kiosk-doctor.sh --sync`. Edit it there, not on the Pi.
#
# Orientation is a SETTING, read from /home/pi/kiosk.env (see
# scripts/pi/kiosk.env.example). Anything but ORIENTATION=landscape means
# portrait, which is exactly what this script did before the setting existed,
# so a missing or garbled file falls back to the mosaic arrangement rather
# than to a blank or mis-tiled glass.
#
# portrait  — the "open book": both panels portrait with their native bottom
#             bezels (Dell logos) facing the CENTER seam, so the two outputs
#             are rotated opposite ways. Tiled at x=0 and x=1080; each window
#             1080x1920. The mosaic versions.
# landscape — both panels unrotated, tiled at x=0 and x=1920; each window
#             1920x1080. The solo kiosk (one frame per screen).

LABEL_MODE=0   # 1 = show local SUNRISE/SUNSET identification pages, 0 = production

ORIENTATION=portrait
[ -f /home/pi/kiosk.env ] && . /home/pi/kiosk.env

MODE=1920x1080   # the panels' native mode (Dell 27", landscape)

case "$ORIENTATION" in
  landscape)
    ROT_LEFT_SCREEN="normal"
    ROT_RIGHT_SCREEN="normal"
    SECOND_X=1920
    WIN_W=1920; WIN_H=1080
    ;;
  *)
    ORIENTATION=portrait
    ROT_LEFT_SCREEN="right"   # output tiled at x=0 (left half of the book)
    ROT_RIGHT_SCREEN="left"   # output tiled at x=1080 (right half)
    SECOND_X=1080
    WIN_W=1080; WIN_H=1920
    ;;
esac

sleep 6  # let X and displays settle after login

xset s off
xset -dpms
xset s noblank
pkill -f xscreensaver 2>/dev/null

OUTS=($(xrandr | awk '/ connected/{print $1}'))
[ -n "${OUTS[0]}" ] && xrandr --output "${OUTS[0]}" --mode "$MODE" --rotate "$ROT_LEFT_SCREEN" --pos 0x0
[ -n "${OUTS[1]}" ] && xrandr --output "${OUTS[1]}" --mode "$MODE" --rotate "$ROT_RIGHT_SCREEN" --pos "${SECOND_X}x0"
echo "kiosk-launch: ORIENTATION=$ORIENTATION outputs=${OUTS[0]:-none},${OUTS[1]:-none} second panel at x=$SECOND_X window ${WIN_W}x${WIN_H}"

if [ "$LABEL_MODE" = "1" ]; then
  URL_A="file:///home/pi/labels/sunrise.html"
  URL_B="file:///home/pi/labels/sunset.html"
else
  URL_A="https://www.sunrisesunset.studio/kiosk/sunrise"
  URL_B="https://www.sunrisesunset.studio/kiosk/sunset"
fi

launch() {
  chromium --kiosk --noerrdialogs --disable-infobars --incognito \
    --password-store=basic --no-first-run \
    --user-data-dir="$2" \
    --window-position=$3,0 --window-size=${WIN_W},${WIN_H} \
    "$1" &
}

# Wait for the kiosk origin before launching (issue #196). The Pi rides a
# cellular router that comes back slower than the Pi boots; launching into a
# dead uplink parks both tabs on a Chromium error page where none of our
# JavaScript runs. Poll the actual page, not the gateway: DNS and TLS return
# after the link does. Bounded, and falls through to launching regardless, so
# the worst case is exactly what happened before this wait existed — and the
# watchdog (kiosk-watchdog.sh, cron every minute) takes it from there.
wait_for_origin() {
  local url=$1 budget=${KIOSK_NET_WAIT_S:-120} t0 elapsed
  case "$url" in file://*) return 0 ;; esac
  t0=$(date +%s)
  while :; do
    if curl -sS -o /dev/null --max-time 5 "$url" 2>/dev/null; then
      echo "kiosk-launch: origin reachable after $(( $(date +%s) - t0 ))s"
      return 0
    fi
    elapsed=$(( $(date +%s) - t0 ))
    if [ "$elapsed" -ge "$budget" ]; then
      echo "kiosk-launch: origin NOT reachable after ${elapsed}s — launching anyway"
      return 1
    fi
    sleep 3
  done
}

wait_for_origin "$URL_A"

launch "$URL_A" /home/pi/.kiosk-sunrise 0
launch "$URL_B" /home/pi/.kiosk-sunset  "$SECOND_X"

# The watchdog reloads a tab that lands on an error page anyway. Idempotent.
[ -f /home/pi/kiosk-watchdog.sh ] && bash /home/pi/kiosk-watchdog.sh --install
