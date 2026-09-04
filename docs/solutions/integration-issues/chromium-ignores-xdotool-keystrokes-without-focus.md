---
title: Kiosk reload script reports success but never reloads — Chromium ignores xdotool's synthetic keystrokes
date: 2026-09-02
category: docs/solutions/integration-issues
module: kiosk-display
problem_type: integration_issue
component: tooling
symptoms:
  - "`reload-kiosk.sh` prints \"Reloaded all kiosk windows\" while the glass sits unchanged for days"
  - "Two screenshots 25 seconds apart have identical md5sums — the wall is frozen, not drifting slowly"
  - "Webcam frames on the display are stamped two days stale"
  - "Merged, deployed code never appears on the kiosk even though prod is confirmed serving it"
  - "`xdotool search --class chromium key ctrl+r` exits 0 and produces no observable effect"
root_cause: wrong_api
resolution_type: code_fix
severity: high
related_components: [development_workflow, documentation]
tags: [xdotool, chromium, kiosk, raspberry-pi, x11, silent-failure, shell-script, verification]
---

# Kiosk reload script reports success but never reloads — Chromium ignores xdotool's synthetic keystrokes

## Problem

The kiosk reload script on the display Pi printed a success message on every run
but never actually reloaded Chromium, so the wall silently served a page loaded
days earlier while reporting that it had refreshed.

## Symptoms

- `ssh pi@sunsetdisplay 'bash ~/reload-kiosk.sh'` printed `Reloaded all kiosk
  windows` and exited 0, on every invocation, regardless of outcome.
- The mosaic did not change after merges that had already shipped to production.
- Webcam frames on the glass were stamped `31-08-2026` while the current date
  was `2026-09-02` — the page was two days stale.
- Two `scrot` screenshots taken 25 seconds apart were byte-identical, so the
  page was not merely animating slowly, it was frozen.
- The Pi's `uptime` showed three days, matching how long the page had gone
  without a real reload.

## What Didn't Work

None of these were wasted effort. Each was a plausible link in the chain between
"code merged" and "pixels on the glass," and each had a direct observable check,
which is the only reason they were cheap to eliminate. The lesson is not "we
guessed wrong three times" — it is that a pipeline with an observable at every
boundary can be bisected in minutes.

**Hypothesis: production had not finished deploying the merge.** The merge
landed at 18:48:51 and the reload was attempted minutes later, so a race against
the Vercel build was credible. Ruled out by `vercel ls --prod`, which showed two
production deployments in `Ready` state, both roughly 8 minutes old with
2-minute build durations.

**Hypothesis: production deployed, but the bundle did not contain the new
code.** This repo has a documented history of `outputFileTracingIncludes` and
`.vercelignore` shipping incomplete bundles, so "deployed but missing" was worth
checking. Ruled out by extracting the chunk URLs from the served page and
grepping each one for a dial name introduced by the new work:

```bash
curl -sS https://www.sunrisesunset.studio/kiosk/sunset -o kiosk.html
grep -oE '/_next/static/chunks/[A-Za-z0-9._/-]+\.js' kiosk.html | sort -u > chunks.txt
while read -r p; do
  # motionMode is a placeholder: substitute any symbol only the new code contains.
  curl -sS "https://www.sunrisesunset.studio$p" | grep -q "motionMode" && echo "FOUND in $p"
done < chunks.txt
```

`motionMode` was present in the live bundle. Production was serving the new code.

**Hypothesis: the kiosk was rendering the wrong mosaic version.** All of the new
work lived in `app/components/mosaic/v2/`, and the registry pins
`DEFAULT_MOSAIC_VERSION = 'v1'`. The kiosk URL carries no `?v=` parameter, so a
v1 fallback would have hidden every line of the change. Ruled out by reading the
resolution order in `app/kiosk/sunset/page.tsx` — the parameter falls back to
the live `shared.activeVersion` setting, not to the registry default — and then
querying that live setting, which returned `"activeVersion": "v2"`.

Only after the deploy, the bundle, and the version selection were all confirmed
healthy did suspicion move to the one component that had never been checked: the
reload mechanism itself, which had been trusted because it said so.

## Solution

Focus each window before sending the keystroke, and report the count actually
delivered instead of a fixed success line.

**Before:**

```bash
DISPLAY=:0 xdotool search --class chromium key --clearmodifiers ctrl+r
echo "Reloaded all kiosk windows"
```

**After** (`scripts/pi/reload-kiosk.sh`):

```bash
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

echo "Sent Ctrl+R to $sent of $total focused kiosk window(s)"
[ "$sent" -eq "$total" ] || exit 1
```

Three details in that script are load-bearing and easy to delete by mistake:

- `--onlyvisible` filters out unmapped helper windows, which `windowactivate`
  cannot focus. Without it a healthy kiosk prints failures on every run, which
  trains the reader to ignore the one channel that reports real breakage.
- `--sync` blocks until activation completes, so a keystroke cannot land on the
  window that was focused a moment earlier. A hang here means the window
  manager, not the network.
- xdotool's stderr is deliberately not silenced. `Can't open display :0` is the
  difference between an X problem and a Chromium problem, and swallowing it
  sends the reader to the wrong component.

The comparison is `-eq "$total"`, not `-gt 0`, because on a two-screen kiosk
"1 of 2 reloaded" is an outage. Exiting 0 on a partial reload would be the same
class of lie the fix exists to remove.

The repo copy and the Pi copy must both be updated. The Pi runs
`~/reload-kiosk.sh`, which is a copy, not a checkout:

```bash
scp scripts/pi/reload-kiosk.sh pi@sunsetdisplay:/home/pi/reload-kiosk.sh
ssh pi@sunsetdisplay 'bash ~/reload-kiosk.sh'
```

**Verified.** The old form produced byte-identical screenshots before, during,
and after a reload. The new form changed the screen within one second and kept
changing three seconds later, and the page came back rendering a visibly
different composition — tile rating overlays that the stale page did not have.
That qualitative difference, not the hash change alone, is what confirmed the
reload; see the caveat under Prevention.

## Why This Works

There were two independent defects on that one line, and `man xdotool` on the Pi
documents both.

**The keystroke went through the wrong API.** From the `SENDEVENT NOTES`
section, quoted verbatim:

> If you specify `xdotool type --window 12345 hello` xdotool will generate key
> events and send them directly to window 12345. However, X11 servers will set a
> special flag on all events generated in this way (see `XEvent.xany.send_event`
> in X11's manual). Many programs observe this flag and reject these events.
>
> It is important to note that for key and mouse events, we only use XSendEvent
> when a specific window is targeted. Otherwise, we use XTEST.

`search` populates the window stack. The `key` documentation states that with a
non-empty stack the window argument defaults to `%1`, and that only an empty
stack causes the current window to be typed at using XTEST. So chaining `search`
into `key` silently opts into XSendEvent, and Chromium is one of the many
programs that reject flagged events. Removing the chain and focusing the window
first leaves the stack empty at the moment `key` runs, which routes through
XTEST — indistinguishable from real hardware input, and accepted.

**The command targeted one window, not all of them.** The `COMMAND CHAINING`
section notes that an omitted window argument defaults to `%1`, the first
window, where `%@` is the notation for all windows. So even on an application
that honored XSendEvent, the original line would have reloaded a single window
while the comment above it promised "all Chromium windows." The loop makes the
fan-out explicit and countable, which is why the fix reports `2` rather than
asserting "all."

**The success line was unconditional.** `echo` ran on the next line regardless of
what `xdotool` did, and `xdotool` exits 0 after successfully *sending* an event
that the receiver discards. The script had no way to be wrong out loud.

## Prevention

- **A remote-control script must report what it verified, not what it
  attempted.** An unconditional success echo is a lie generator: it converts
  silence into false confidence and costs days before anyone doubts it. Count
  the operations that actually succeeded and print the count; exit non-zero when
  the count is zero. This is the same failure class as letting an ML fallback
  path masquerade as real model output — the fix there is persisting
  `pathTaken` and surfacing a fallbacks counter, and it is the same fix here,
  which is to make the observable distinguish the real path from the no-op path.

- **When a process "runs but does nothing," verify it executes before theorizing
  about the components downstream of it.** The three ruled-out hypotheses were
  all downstream of a step that was never instrumented. Checking the silent
  component first would have found this in one probe instead of four. The
  `__main__`-entrypoint bug on camera-2 was the same shape: an ordering theory
  for what turned out to be code that never ran.

- **Use screenshot hashing as the ground-truth probe for "did the glass actually
  change?"** It requires nothing installed in the browser and cannot be fooled
  by a script's own reporting:

  ```bash
  ssh pi@sunsetdisplay 'export DISPLAY=:0; scrot -o /tmp/a.png; \
    bash ~/reload-kiosk.sh; sleep 2; scrot -o /tmp/b.png; md5sum /tmp/a.png /tmp/b.png'
  ```

  Identical hashes across a reload mean the reload did not happen. This
  generalizes to any headless display: capture, act, capture, compare.

  **The probe is one-directional, and became more so on the day it was
  written.** The mosaic now defaults to continuous slow drift with fading
  frames, so consecutive screenshots differ whether or not anything reloaded.
  Identical hashes still prove no reload; differing hashes prove nothing on
  their own. To confirm a reload actually landed, look for content only the new
  build produces rather than for movement.

- **Prefer exit codes to echoes for anything invoked over SSH.** The caller sees
  the remote exit status, so a non-zero exit is checkable by a wrapper, a cron
  job, or a health check; a success string is only checkable by a human who
  happens to be reading.

- **Treat every fire-and-forget remote command as suspect.** `xdotool`,
  `wmctrl`, `xset`, `DISPLAY=:0` one-liners, and systemd `--no-block` calls all
  exit 0 on delivery, not on effect. Where the effect matters, add a read-back
  that observes the effect rather than the attempt.

- **Distrust "How it works" comments that describe intent.** The original
  comment claimed the script sends Ctrl+R "to each" window. Both halves of that
  sentence were false, and the comment made the line look reviewed. The
  replacement comment states the mechanism and names the failure it avoids.

## Related Issues

- `docs/solutions/best-practices/dangerous-failures-here-are-silent.md` — the
  house rule this is a concrete instance of. That doc catalogues failures where
  behaviour is *absent* with no error; this one is the same silence produced by
  a tool boundary that accepts a command and discards it.
- `docs/solutions/2026-06-06-fallbacks-must-not-impersonate-real-signal.md` —
  the sibling failure mode, a fallback writing a plausible fake value into the
  real column. The unconditional success echo is that pattern in a shell script.
- `docs/superpowers/plans/2026-04-13-gallery-kiosk-routes.md` and
  `docs/superpowers/specs/2026-04-13-gallery-display-pi-setup-design.md` are
  where the broken `xdotool search --class chromium key` form was first written
  down as a copy-paste recipe. Both were marked superseded on 2026-09-02 and now
  point at `scripts/pi/reload-kiosk.sh` instead.
