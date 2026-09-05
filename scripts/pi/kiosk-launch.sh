#!/bin/bash
# Dual-monitor sunrise/sunset kiosk launcher for sunsetdisplay.
# Called from the desktop session autostart. Assumes X11 session.
#
# Monitors are mounted "open book" style: both portrait, with the panels'
# native bottom bezels (Dell logos) facing the CENTER seam. That means the
# two panels are physically rotated opposite directions, so each output
# gets its own rotation below.

LABEL_MODE=0   # 1 = show local SUNRISE/SUNSET identification pages, 0 = production mosaics

ROT_LEFT_SCREEN="right"   # rotation for output tiled at x=0 (left half of book)
ROT_RIGHT_SCREEN="left"   # rotation for output tiled at x=1080 (right half)

sleep 6  # let X and displays settle after login

xset s off
xset -dpms
xset s noblank
pkill -f xscreensaver 2>/dev/null

OUTS=($(xrandr | awk '/ connected/{print $1}'))
[ -n "${OUTS[0]}" ] && xrandr --output "${OUTS[0]}" --mode 1920x1080 --rotate "$ROT_LEFT_SCREEN" --pos 0x0
[ -n "${OUTS[1]}" ] && xrandr --output "${OUTS[1]}" --mode 1920x1080 --rotate "$ROT_RIGHT_SCREEN" --pos 1080x0

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
    --window-position=$3,0 --window-size=1080,1920 \
    "$1" &
}

launch "$URL_A" /home/pi/.kiosk-sunrise 0
launch "$URL_B" /home/pi/.kiosk-sunset  1080
