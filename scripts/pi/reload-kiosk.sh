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
#   xdotool finds all Chromium windows by class name and sends Ctrl+R to each.
#   This triggers a standard browser reload — fast, minimal flash (~1 sec).

DISPLAY=:0 xdotool search --class chromium key --clearmodifiers ctrl+r
echo "Reloaded all kiosk windows"
