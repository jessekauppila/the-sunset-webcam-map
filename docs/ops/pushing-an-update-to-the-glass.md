# Pushing an update to the glass

"The glass" is the kiosk Pi (`sunsetdisplay`) driving the two portrait panels.
It runs two Chromium windows pointed at `www.sunrisesunset.studio/kiosk/sunrise`
and `/kiosk/sunset` — the production site, i.e. whatever is merged to `main`.

Nothing on the Pi updates itself except **settings**. This page is the whole
procedure; you should not need to re-derive any of it.

## What kind of change did you make?

| You changed | How it reaches the Pi | What you do |
|---|---|---|
| A dial in `/studio` | Hold **Deploy**. That copies the `studio` settings row to `live`; the kiosk polls `/api/kiosk/state` once a minute and picks it up. | Wait up to 60 s. Nothing else. |
| Code (a merged PR) | Vercel builds `main` (~2 min). The Pi's Chromium tabs keep running the JavaScript they loaded at boot **until they reload**. | Wait for the build, then **reload the glass** (below). |
| `scripts/pi/*.sh` | The Pi holds *copies* of these, not a checkout. They drift silently. | Reload with `--sync` (below). On a locked Pi the doctor writes the copies through to the card and fails loudly if it cannot. |
| The OS itself (apt, kernel, `cmdline.txt`, `kiosk.env`) | Root is read-only when the card is locked; these need a writable root. | `--unlock`, do the work, `--lock` (see "The card is locked" below). |

"IN SYNC WITH GLASS" in `/studio` only means *studio row equals live row*. It
says nothing about which build the Pi is running. If the studio preview and the
panels disagree after a Deploy, the Pi is running an older build: reload it.

## Reloading the glass

From the repo root, on `main` (the scripts live in `scripts/pi/`):

```bash
bash scripts/pi/kiosk-doctor.sh --sync --reload
```

It checks, in order, and stops at the first failure:

1. This Mac is on the tailnet.
2. The Pi answers SSH.
3. What the Pi is doing: X up, monitors awake, two Chromium windows, which URLs.
4. `--sync`: copies `scripts/pi/*.sh` to the Pi.
5. `--reload`: screenshots, sends Ctrl+R to each window through XTEST, screenshots again.

Read the last block. "byte-identical across the reload" is a hard failure:
nothing reloaded. "screen changed" is **not** proof on its own, because the
mosaic drifts continuously; confirm by looking for something only the new
build draws.

Without the doctor script (older checkout, or in a hurry):

```bash
ssh pi@sunsetdisplay 'bash ~/reload-kiosk.sh'
```

It prints `Sent Ctrl+R to N of M`, and exits non-zero if N < M. "Sent", not
"reloaded" — xdotool confirms delivery, not effect. Why that wording matters:
`docs/solutions/integration-issues/chromium-ignores-xdotool-keystrokes-without-focus.md`.

### Off the tailnet, on the same wifi as the Pi

The Pi is on the GL-X3000 travel-router network. From a Mac on that wifi you
can skip Tailscale by naming the host explicitly, which also skips the doctor's
tailnet check:

```bash
KIOSK_HOST=sunsetdisplay.lan bash scripts/pi/kiosk-doctor.sh --sync --reload
```

(`192.168.8.223` is the Pi's wifi address if the router's DNS is not
resolving.) Same key requirement as the tailnet route.

## Confirming the build landed first

Reloading before Vercel finishes just reloads the old build. Check:

```bash
vercel ls --prod
```

The top row should be `● Ready` and younger than your merge. Builds take about
two minutes. Or watch the PR's checks on GitHub.

## Order of operations for a new dial

1. Merge the code. 2. Wait for the build. 3. Reload the glass. 4. **Then** set
the dial in `/studio` and Deploy.

Backwards, the settings API discards the unknown key and the studio status
strip shows `⚠ not stored: <key> (unknown)`. Deploy will keep reporting in
sync while the panels show nothing new.

## Switching the glass between mosaic and solo

The solo kiosk (spec `docs/superpowers/specs/2026-09-04-solo-kiosk-design.md`)
runs the panels **landscape**. Three things must agree: the Pi's rotation
(`/home/pi/kiosk.env`), the panel preset (`dell` vs `dell-l`), and the active
version (`v1`..`v4` vs `solo`). Change them in this order.

`kiosk-launch.sh` is now in the repo (`scripts/pi/`) and reaches the Pi with
`--sync`; the Pi reads `ORIENTATION` from `/home/pi/kiosk.env` at boot.
Missing file means portrait, so a lost file falls back to the mosaic
arrangement, never to a blank glass. The doctor prints both the setting and
what xrandr is actually doing.

### Mosaic → solo

1. Merge and build the code that carries `solo` in the version list.
   `vercel ls --prod`.
2. Sync the scripts and reload: `bash scripts/pi/kiosk-doctor.sh --sync --reload`.
3. Set the orientation and reboot the Pi:
   `ssh pi@sunsetdisplay 'printf "ORIENTATION=landscape\n" > /home/pi/kiosk.env && sudo reboot'`
4. Turn the monitors on their stands. The doctor's `xrandr` lines say which
   way the Pi draws; the picture on the panels says whether the stand agrees.
5. In `/studio`: panel = `dell-l`, active version = `solo`. Hold Deploy. The
   tabs pick it up within a minute and start advancing.
6. Verify on the glass: `bash scripts/pi/kiosk-doctor.sh --reload` twice,
   30 s apart; the two screenshots must differ AND the frame on each panel
   must be the "on glass" row in `/studio` (pick the version at the top)
   for that feed.

### Solo → mosaic (rollback)

1. In `/studio`: active version = `v1` (or whichever was live), panel =
   `dell`. Hold Deploy.
2. `ssh pi@sunsetdisplay 'printf "ORIENTATION=portrait\n" > /home/pi/kiosk.env && sudo reboot'`
3. Turn the monitors back. Doctor to confirm.

### Solo → solo2 (and back)

`solo2` (spec `docs/superpowers/specs/2026-09-04-solo2-rhythm-design.md`) is
a second registered version beside `solo`: same bins, same schedule, same
landscape panels, its own dials in the `solo2` namespace. Switching is
settings only, once the build that carries it is on the glass.

1. Merge and build the code that carries `solo2` in the version list.
   `vercel ls --prod`.
2. `bash scripts/pi/kiosk-doctor.sh --sync --reload` so both tabs run that
   build. Without this step the dial does nothing: the tabs do not know the
   version.
3. In `/studio`: active version = `solo2`. Hold Deploy. Tabs pick it up
   within a minute. Every `solo2` dial starts at `solo`'s behaviour except
   the caption's local time, so the glass looks the same until you tune.
4. Tune on `/studio`: pick the version at the top, then dial valleys,
   screens, lead, transition, prelude and time. Deploy there.
5. Back: `/studio`, active version = `solo`. Hold Deploy. The `solo2` dials
   stay where you left them for next time.

## When it does not work

| Symptom | Meaning | Do |
|---|---|---|
| Doctor step 1 fails, `Tailscale status` says stopped | Tailscale is off on this Mac | `/Applications/Tailscale.app/Contents/MacOS/Tailscale up`, or the menu-bar toggle |
| Step 1 fails and `systemextensionsctl list` shows the extension "activated waiting to upgrade" | The network extension is wedged | Reboot the Mac. Restarting the app does not clear it. |
| Step 2 fails while step 1 passed | Pi is off, or the travel router is not where the Pi is | Check last-seen at login.tailscale.com/admin/machines, then power-cycle in person |
| `Permission denied (publickey)` | The Pi is up but refused this Mac's `~/.ssh/id_ed25519`. On 2026-09-04 it refused on both routes for about 15 minutes and then accepted the same key with no change on either end; the doctor prints the ssh error so this is not mistaken for a dead Pi. | Retry after a few minutes first. If it persists, get on the Pi (keyboard, or another authorized machine) and add the Mac's `~/.ssh/id_ed25519.pub` to `/home/pi/.ssh/authorized_keys`; check `~/.ssh` is mode 700 and the file 600. |
| Doctor says monitors asleep (DPMS Off) | Pi is fine, screens are blanked | `ssh pi@sunsetdisplay 'DISPLAY=:0 xset dpms force on'` |
| "No visible Chromium kiosk windows" | `kiosk-launch.sh` did not run | `ssh pi@sunsetdisplay sudo reboot`; a cold boot brings both windows up with no interaction |
| Reload reported success but the panels still look old | Build not finished, or you are looking at a settings problem | `vercel ls --prod`; then check `/studio` for `not stored` warnings |
| Doctor says a window is titled with the URL, not "Kiosk Display" | The tab is on a Chromium error page or crash page (issue #196). Usually the Pi booted before the router had internet. | Nothing, if the watchdog cron is present: it reloads the tab within about two minutes. If the doctor says the cron is absent, run the doctor with `--sync`. |

## The card is locked (read-only root)

Once locked, the SD card is mounted read-only and every write since boot
lives in a RAM overlay that vanishes at reboot, so **anyone can pull the
plug**. Raspberry Pi OS does this with `raspi-config nonint enable_overlayfs`
(the `overlayroot` package, `overlayroot=tmpfs` in `cmdline.txt`, the card at
`/media/root-ro`, the RAM layer at `/media/root-rw`). `/boot/firmware` goes
read-only through fstab at the same time. Nothing that matters lives only on
the card at runtime: settings come from `/api/kiosk/state`, pictures from the
site, the watchdog's state is on tmpfs already. Issue #203.

The doctor reports the state every run: "root is READ-ONLY … the plug is
safe to pull", or "root is WRITABLE … the case button is the safe off". A
line saying a reboot is pending means the config and the running state
disagree.

What still works while locked, with no ceremony:

- **`--sync`.** The scp lands in RAM (live immediately), then
  `kiosk-lock.sh persist` remounts the card writable for the copy, writes the
  same files through, checksums them, and remounts read-only. If that step
  fails the doctor says NOT persisted and exits non-zero. It never reports a
  sync that the next reboot would undo.
- **`--reload`**, Deploy from `/studio`, the build-stamp self-reload, the
  watchdog.

What needs the ceremony (a writable root): apt, a kernel or firmware update,
editing `cmdline.txt` or `/home/pi/kiosk.env`, adding a package.

```bash
bash scripts/pi/kiosk-doctor.sh --unlock      # stages, reboots, waits for ssh, verifies overlay off
ssh pi@sunsetdisplay                          # do the work
bash scripts/pi/kiosk-doctor.sh --sync --lock # stages, reboots, waits, verifies overlay on
```

Each reboot takes the glass down for a minute or two; Chromium relaunches on
its own. The doctor gives the Pi five minutes to answer ssh and then tells
you to go to it. If the overlay is what broke the boot, mount the card on
another machine and delete `overlayroot=tmpfs ` from `cmdline.txt`.

First-time setup, once, on a writable root: `--prepare` installs the
`overlayroot` package (so the lock itself needs no network), sets journald
to volatile with a 32 MB cap (so a month of uptime cannot fill the RAM
layer), disables apt's daily timers for good (they would download over the
cellular uplink into a layer that evaporates; `--unlock` is the maintenance
window and apt is run by hand there), and installs the watchdog cron line on
the card. Then `--lock`.

Known costs, accepted:

- `vnstat`'s database is in RAM, so the 08:00 data digest counts traffic
  since the last boot, not since midnight, on a day the Pi rebooted.
- Tailscale's state directory is in RAM. Its node key was on the card when
  locked and expires 2027-02-01; before then, either **disable key expiry
  for `sunsetdisplay`** in the Tailscale admin console (the usual kiosk
  setting, and the durable fix) or unlock, let it re-key, relock.
- The case label strip reading "NEVER PULL THE PLUG" is now wrong and needs
  reprinting.
- `kiosk.env` edits need the ceremony. Orientation changes are rare.

## After a power event

The Pi boots faster than the GL-X3000 gets its cellular uplink back. Two
things cover that, both in `scripts/pi/` and pushed by `--sync`:

1. `kiosk-launch.sh` waits up to `KIOSK_NET_WAIT_S` (default 120 s) for the
   kiosk origin to answer before launching Chromium, then launches anyway.
2. `kiosk-watchdog.sh` runs from cron every minute. A visible Chromium
   window whose title lacks `KIOSK_TITLE_MARK` ("Kiosk Display", the title
   set in `app/kiosk/layout.tsx`) is suspect; on the second sighting in a row
   it gets the same focus-then-Ctrl+R reload the doctor uses. Only that
   window, so a healthy panel never blinks. Its state and log live under
   `/tmp/kiosk-watchdog/` (tmpfs), read by the doctor's step 3.

If the app's kiosk title ever changes, change `KIOSK_TITLE_MARK` in
`/home/pi/kiosk.env` in the same PR, or the watchdog will reload healthy
tabs every two minutes.

Measured on the Pi 2026-09-15 (Chromium 152) while testing this: a reload
against a dead uplink takes about 20 s to show the error page, so a 6 s look
after a reload proves nothing; and Chromium auto-reloads a net-error page on
its own once the network is back (11 s after a 60 s outage), with a backoff
that grows across a long outage. The watchdog is the bound on that backoff
and the only cover for the "Aw, Snap!" crash page.

Full Pi access notes (addresses, wifi profile, autostart quirks):
`docs/superpowers/specs/2026-04-13-gallery-display-pi-setup-design.md` and
the `sunsetdisplay-kiosk-access` memory.

## What is still manual, and the fix for it

The Pi never notices a new build. Every merged change to the kiosk needs a
human to run the reload. The cheap end of this loop is for `/api/kiosk/state`
to return the build's commit SHA and for the kiosk page to `location.reload()`
when the SHA it booted with changes, ideally only outside the quiet window so a
deploy never flashes the panels mid-show. Until that ships, this page is the
procedure.
