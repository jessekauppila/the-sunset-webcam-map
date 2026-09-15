#!/bin/bash
# kiosk-lock.sh — the kiosk Pi's read-only root, so pulling the plug is safe.
#
# Usage on the Pi (kiosk-doctor.sh drives all of this from the Mac):
#   bash ~/kiosk-lock.sh status            # overlay on/off, boot ro, RAM upper usage
#   bash ~/kiosk-lock.sh prepare           # one-time: package, journald, apt timers (idempotent)
#   bash ~/kiosk-lock.sh lock              # stage read-only root; REBOOT to apply
#   bash ~/kiosk-lock.sh unlock            # stage writable root; REBOOT to apply
#   bash ~/kiosk-lock.sh persist FILE...   # while locked: write files through to the card
#
# The canonical copy lives in the repo at scripts/pi/kiosk-lock.sh and is
# pushed to the Pi by `kiosk-doctor.sh --sync`.
#
# Why this exists (issue #203):
#   Root is ext4 rw on an SD card. A cord yanked mid-write can corrupt it, so
#   the case button was the only safe off. Raspberry Pi OS ships a read-only
#   root behind `raspi-config nonint enable_overlayfs`: the card is mounted
#   read-only and every write lands in a RAM overlay that vanishes at reboot.
#   Nothing that matters lives only on this card at runtime — settings come
#   from /api/kiosk/state, pictures from the site — so losing the overlay costs
#   nothing.
#
# How it is built (raspi-config on trixie, read from /usr/bin/raspi-config):
#   the `overlayroot` package plus `overlayroot=tmpfs` in cmdline.txt. At boot
#   overlayroot mounts the card read-only at /media/root-ro, a tmpfs at
#   /media/root-rw, and the overlay of the two on /. /boot/firmware goes
#   read-only through fstab (`enable_bootro`).
#
# The trap this script exists to close:
#   with the overlay on, `kiosk-doctor.sh --sync` copies scripts into RAM,
#   reports success, and the copies vanish at the next reboot. `persist`
#   writes a file through to the card by remounting /media/root-ro writable
#   for the copy, so a sync on a locked Pi stays synced. The full unlock /
#   reboot / relock ceremony is only for OS-level work (apt, kernel, cmdline).
#
# Every command prints KEY=value lines the doctor can parse, and nothing
# prints an ok it did not check.

set -u

LOWER=/media/root-ro
UPPER=/media/root-rw
JOURNAL_DROPIN=/etc/systemd/journald.conf.d/kiosk-volatile.conf

overlay_now()  { grep -q "overlayroot=tmpfs" /proc/cmdline && echo on || echo off; }
overlay_conf() { grep -q "overlayroot=tmpfs" /boot/firmware/cmdline.txt && echo on || echo off; }
bootro_now()   { findmnt -no OPTIONS /boot/firmware 2>/dev/null | grep -q "^ro," && echo on || echo off; }
bootro_conf()  { grep /boot/firmware /etc/fstab | grep -q "defaults.*,ro[ ,]" && echo on || echo off; }
prepared() {
  dpkg -s overlayroot >/dev/null 2>&1 || { echo "no (overlayroot package missing)"; return; }
  [ -f "$JOURNAL_DROPIN" ] || { echo "no (journald not volatile)"; return; }
  [ "$(systemctl is-enabled apt-daily.timer 2>/dev/null)" = "disabled" ] || { echo "no (apt-daily.timer enabled)"; return; }
  echo yes
}

status() {
  echo "OVERLAY_NOW=$(overlay_now)"
  echo "OVERLAY_CONF=$(overlay_conf)"
  echo "BOOTRO_NOW=$(bootro_now)"
  echo "BOOTRO_CONF=$(bootro_conf)"
  echo "PREPARED=$(prepared)"
  if [ "$(overlay_now)" = on ] && findmnt "$UPPER" >/dev/null 2>&1; then
    echo "UPPER_USED=$(df -h --output=used,size "$UPPER" | tail -1 | awk '{print $1 " of " $2}')"
  else
    echo "UPPER_USED=n/a"
  fi
  echo "ROOT_MOUNT=$(findmnt -no SOURCE,OPTIONS / 2>/dev/null | cut -c1-60)"
}

prepare() {
  if [ "$(overlay_now)" = on ]; then
    echo "PREPARE=refused (overlay is on; unlock first — these are card writes)"
    return 1
  fi
  # The package raspi-config would otherwise apt-get during `lock`; do the
  # network work here so `lock` itself needs none.
  if dpkg -s overlayroot >/dev/null 2>&1; then
    echo "PACKAGE=already installed"
  elif sudo apt-get install -y -q overlayroot >/dev/null 2>&1; then
    echo "PACKAGE=installed overlayroot"
  else
    echo "PACKAGE=FAILED to install overlayroot (apt) — is the uplink up?"
    return 1
  fi
  # Journald would otherwise fill the RAM overlay over a long uptime.
  if [ -f "$JOURNAL_DROPIN" ]; then
    echo "JOURNALD=already volatile"
  else
    sudo mkdir -p "$(dirname "$JOURNAL_DROPIN")"
    printf '[Journal]\nStorage=volatile\nRuntimeMaxUse=32M\n' | sudo tee "$JOURNAL_DROPIN" >/dev/null
    sudo systemctl restart systemd-journald
    echo "JOURNALD=set volatile (RuntimeMaxUse=32M)"
  fi
  # apt's daily timers would download into RAM over the cellular uplink and
  # install into a layer that evaporates. Off for good on this machine;
  # `unlock` is the maintenance window and apt is run by hand there.
  if [ "$(systemctl is-enabled apt-daily.timer 2>/dev/null)" = "disabled" ]; then
    echo "APT_TIMERS=already disabled"
  else
    sudo systemctl disable --now apt-daily.timer apt-daily-upgrade.timer >/dev/null 2>&1
    echo "APT_TIMERS=disabled"
  fi
  # The watchdog cron line is in /var/spool, which will be under the overlay.
  # Install it now so it is on the card, not only re-created at each boot.
  [ -f /home/pi/kiosk-watchdog.sh ] && echo "WATCHDOG=$(bash /home/pi/kiosk-watchdog.sh --install)"
  sync
  echo "PREPARED=$(prepared)"
}

lock() {
  if [ "$(overlay_now)" = on ]; then
    echo "LOCK=already on"
    return 0
  fi
  if [ "$(prepared)" != yes ]; then
    echo "LOCK=refused (not prepared: $(prepared)) — run: bash ~/kiosk-lock.sh prepare"
    return 1
  fi
  # Both edit files on the card: cmdline.txt (overlay) and fstab (boot ro).
  # Order matters — enable_bootro refuses once the overlay is live.
  if ! sudo raspi-config nonint enable_overlayfs; then
    echo "LOCK=FAILED (enable_overlayfs)"
    return 1
  fi
  sudo raspi-config nonint enable_bootro
  sync
  echo "OVERLAY_CONF=$(overlay_conf)"
  echo "BOOTRO_CONF=$(bootro_conf)"
  if [ "$(overlay_conf)" = on ]; then
    echo "LOCK=staged — reboot to apply"
  else
    echo "LOCK=FAILED (cmdline.txt unchanged)"
    return 1
  fi
}

# Remount the card writable for the duration of one function call, then back.
with_lower_rw() {
  if ! findmnt "$LOWER" >/dev/null 2>&1; then
    echo "LOWER=not mounted at $LOWER — overlayroot layout differs; refusing"
    return 1
  fi
  sudo mount -o remount,rw "$LOWER" || { echo "LOWER=remount rw FAILED"; return 1; }
  "$@"
  local rc=$?
  sync
  sudo mount -o remount,ro "$LOWER" || echo "LOWER=WARNING remount ro failed; card is writable until reboot"
  return $rc
}

unlock() {
  if [ "$(overlay_now)" = off ]; then
    echo "UNLOCK=already off"
    return 0
  fi
  # disable_overlayfs edits cmdline.txt on /boot/firmware (it remounts it rw
  # itself). disable_bootro refuses while the overlay is live because the
  # fstab it would edit is in RAM, so edit the one on the card directly.
  if ! sudo raspi-config nonint disable_overlayfs; then
    echo "UNLOCK=FAILED (disable_overlayfs)"
    return 1
  fi
  fix_fstab() { sudo sed -i "$LOWER/etc/fstab" -e 's#\(.*/boot/firmware.*\)defaults,ro\(.*\)#\1defaults\2#'; }
  with_lower_rw fix_fstab || { echo "UNLOCK=FAILED (fstab on the card)"; return 1; }
  echo "OVERLAY_CONF=$(overlay_conf)"
  echo "BOOTRO_CONF=$(grep /boot/firmware "$LOWER/etc/fstab" | grep -q "defaults.*,ro[ ,]" && echo on || echo off)"
  if [ "$(overlay_conf)" = off ]; then
    echo "UNLOCK=staged — reboot to apply"
  else
    echo "UNLOCK=FAILED (cmdline.txt still has overlayroot=tmpfs)"
    return 1
  fi
}

persist() {
  if [ "$(overlay_now)" = off ]; then
    echo "PERSIST=not needed (root is writable; $# file(s) are on the card already)"
    return 0
  fi
  [ $# -gt 0 ] || { echo "PERSIST=nothing to do"; return 0; }
  copy_all() {
    local f n=0
    for f in "$@"; do
      case "$f" in /*) ;; *) f="/home/pi/$f" ;; esac
      [ -f "$f" ] || { echo "PERSIST_SKIP=$f (not a file)"; continue; }
      sudo mkdir -p "$LOWER$(dirname "$f")"
      sudo cp -p "$f" "$LOWER$f" || { echo "PERSIST_FAIL=$f"; return 1; }
      if [ "$(md5sum < "$f")" = "$(sudo md5sum < "$LOWER$f")" ]; then
        n=$((n + 1))
      else
        echo "PERSIST_FAIL=$f (checksum differs on the card)"
        return 1
      fi
    done
    echo "PERSIST=ok ($n file(s) written through to the card)"
  }
  with_lower_rw copy_all "$@"
}

case "${1:-status}" in
  status)  status ;;
  prepare) prepare ;;
  lock)    lock ;;
  unlock)  unlock ;;
  persist) shift; persist "$@" ;;
  -h|--help) sed -n '2,10p' "$0" ;;
  *) echo "Unknown command: $1" >&2; exit 2 ;;
esac
