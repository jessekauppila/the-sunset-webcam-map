#!/bin/bash
# Reload all Chromium kiosk windows on the Raspberry Pi.
#
# Usage (from your Mac via SSH):
#   ssh pi@sunsetdisplay 'bash ~/reload-kiosk.sh'
#
# Prerequisites on Pi:
#   sudo apt install -y xdotool   (done during Pi setup)
#
# How it works:
#   Chromium ignores synthetic key events delivered by XSendEvent, which is
#   what `xdotool search --class chromium key ...` does to a window it has not
#   focused. That form printed success while the page sat untouched for days.
#   So: focus each window first, then send Ctrl+R through XTEST, which
#   Chromium does accept — and report the count we actually delivered rather
#   than a fixed success line.
#
#   `--sync` is load-bearing: it blocks until activation completes, so a
#   keystroke cannot land on the window we were focused on a moment ago.
#   Do not drop it. If this ever hangs, suspect the window manager, not SSH.
#
#   No `set -e`: `xdotool search` exits 1 when it matches nothing, and we want
#   the friendly message below rather than a bare abort. xdotool's own stderr
#   is deliberately not silenced — "Can't open display :0" is the difference
#   between an X problem and a Chromium problem.

export DISPLAY=:0

windows=$(xdotool search --onlyvisible --class chromium)

if [ -z "$windows" ]; then
  echo "No visible Chromium kiosk windows found — is the kiosk running?" >&2
  exit 1
fi

total=0
sent=0
for w in $windows; do
  total=$((total + 1))
  if xdotool windowactivate --sync "$w" && xdotool key --clearmodifiers ctrl+r; then
    sent=$((sent + 1))
  else
    echo "Failed to reload window $w" >&2
  fi
done

# "Sent", not "Reloaded": xdotool exits 0 on delivery, not on effect. Claiming
# the effect is the exact overreach that hid this bug for months.
echo "Sent Ctrl+R to $sent of $total focused kiosk window(s)"
[ "$sent" -eq "$total" ] || exit 1
