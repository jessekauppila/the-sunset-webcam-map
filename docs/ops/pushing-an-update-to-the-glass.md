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
| `scripts/pi/*.sh` | The Pi holds *copies* of these, not a checkout. They drift silently. | Reload with `--sync` (below). |

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
   must be the "on glass" row in `/studio/solo` for that feed.

### Solo → mosaic (rollback)

1. In `/studio`: active version = `v1` (or whichever was live), panel =
   `dell`. Hold Deploy.
2. `ssh pi@sunsetdisplay 'printf "ORIENTATION=portrait\n" > /home/pi/kiosk.env && sudo reboot'`
3. Turn the monitors back. Doctor to confirm.

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
