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

launch "$URL_A" /home/pi/.kiosk-sunrise 0
launch "$URL_B" /home/pi/.kiosk-sunset  "$SECOND_X"
