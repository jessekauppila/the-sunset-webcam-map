# Solo Kiosk Phase 4 (Pi) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the solo kiosk on the glass, reversibly: the two panels turned landscape by a one-line setting on the Pi, the panel preset and active version flipped from `/studio`, verified on the screens with the doctor script and the solo studio, and the whole procedure written into the runbook with its rollback.

**Architecture:** The Pi's `~/kiosk-launch.sh` is today the only copy of the rotation logic and lives outside the repo. This phase brings it into `scripts/pi/` as the canonical copy, makes orientation a value in `/home/pi/kiosk.env` (default `portrait`, so nothing changes until someone edits it), and teaches the doctor to report each output's rotation. Switching modes is then: edit one line on the Pi, reboot, flip two dials, Deploy.

**Tech Stack:** bash, xrandr, ssh, the existing `kiosk-doctor.sh --sync --reload` flow.

**Spec:** `docs/superpowers/specs/2026-09-04-solo-kiosk-design.md` §8 phase 4; `docs/ops/pushing-an-update-to-the-glass.md`.

## Global Constraints

- Branch `docs/solo-pi-rotation` from `main` after phase 2 merges. The scripts and doc changes are a PR; the Pi steps are run by hand and their outputs pasted into the PR.
- Nothing here changes Pi behaviour until `ORIENTATION=landscape` is written on the Pi. Default is `portrait`, today's behaviour, byte for byte in the xrandr calls.
- Every Pi command is one line, paste-safe. Heredocs only where marked, with `EOF` flush-left.
- The physical turn of the monitors on their stands is a human step and is listed as one.
- Verification is on the glass, never inferred: screenshots through the doctor, and the frame on the panel matching `/studio/solo`'s "on glass" row.

---

## File structure

| path | responsibility |
|---|---|
| `scripts/pi/kiosk-launch.sh` | canonical launch script, orientation from `kiosk.env` |
| `scripts/pi/kiosk.env.example` | the one setting, documented |
| `scripts/pi/kiosk-doctor.sh` | report rotation + mode per output |
| `docs/ops/pushing-an-update-to-the-glass.md` | "Switching the glass between mosaic and solo" section |

---

### Task 1: Bring the launch script into the repo

- [ ] **Step 1: Copy the Pi's script into the worktree, unchanged**

```bash
scp pi@sunsetdisplay:/home/pi/kiosk-launch.sh scripts/pi/kiosk-launch.sh
```

If the tailnet is down, `scp pi@192.168.8.223:/home/pi/kiosk-launch.sh scripts/pi/kiosk-launch.sh` from the GL-X3000 wifi.

- [ ] **Step 2: Read it and record what it does**

Open the file. Note the exact xrandr invocation (output names, `--rotate right`, the `--pos 0x0` / `--pos 1080x0` tiling) and the two chromium lines. These are the lines Task 2 parametrises; nothing else changes.

- [ ] **Step 3: Commit the unchanged copy first**

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" = "docs/solo-pi-rotation" ] && git add scripts/pi/kiosk-launch.sh && git commit -m "chore(pi): bring kiosk-launch.sh into the repo, unchanged from the Pi"
```

That commit is the rollback reference for everything after it.

---

### Task 2: Orientation as a setting

**Files:**
- Modify: `scripts/pi/kiosk-launch.sh`
- Create: `scripts/pi/kiosk.env.example`

- [ ] **Step 1: `kiosk.env.example`**

```bash
# /home/pi/kiosk.env — read by kiosk-launch.sh at boot. Copy this file there.
#
# ORIENTATION=portrait   both panels rotated right, tiled at x=0 and x=<short edge>  (mosaic)
# ORIENTATION=landscape  both panels unrotated, tiled at x=0 and x=<long edge>       (solo)
#
# After changing it: sudo reboot, then in /studio set panel = dell/ktc (portrait)
# or dell-l/ktc-l (landscape) and activeVersion = v1…v4 (portrait) or solo
# (landscape), then Deploy.
ORIENTATION=portrait
```

- [ ] **Step 2: Parametrise the launcher**

Replace the fixed xrandr block with (keep the script's existing output-name discovery if it has one; otherwise this reads the two connected outputs in xrandr order):

```bash
ORIENTATION=portrait
[ -f /home/pi/kiosk.env ] && . /home/pi/kiosk.env

# The two connected outputs, in xrandr order. The first is the sunrise panel
# (nearest the USB-C power port), the second the sunset panel.
mapfile -t OUTPUTS < <(xrandr --query | awk '/ connected/ {print $1}')
LEFT="${OUTPUTS[0]}"; RIGHT="${OUTPUTS[1]}"
# Native mode of the first output, e.g. 2560x1440.
MODE=$(xrandr --query | awk -v o="$LEFT" '$1==o {getline; print $1}')
W=${MODE%x*}; H=${MODE#*x}

case "$ORIENTATION" in
  landscape)
    xrandr --output "$LEFT"  --mode "$MODE" --rotate normal --pos 0x0 \
           --output "$RIGHT" --mode "$MODE" --rotate normal --pos "${W}x0"
    SECOND_X=$W ;;
  *)
    xrandr --output "$LEFT"  --mode "$MODE" --rotate right --pos 0x0 \
           --output "$RIGHT" --mode "$MODE" --rotate right --pos "${H}x0"
    SECOND_X=$H ;;
esac
echo "kiosk-launch: ORIENTATION=$ORIENTATION mode=$MODE second panel at x=$SECOND_X"
```

Then the two chromium lines use `--window-position=0,0` and `--window-position=${SECOND_X},0` (matching whatever flag the script uses today). If the current script hard-codes `1080`, that is the value `SECOND_X` replaces. If it uses `--rotate left`, keep `left` in the portrait branch: the direction is a property of how the panels are mounted, not of this plan.

- [ ] **Step 3: Dry-run the rotation logic on the Pi without launching**

```bash
ssh pi@sunsetdisplay 'export DISPLAY=:0; xrandr --query | awk "/ connected/ {print \$1}"; xrandr --query | head -8'
```

Expected: two output names and their modes. Confirm `MODE` parsing gives the native landscape mode (`2560x1440` for KTC, `1920x1080` for Dell), not a rotated one.

- [ ] **Step 4: Commit**

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" = "docs/solo-pi-rotation" ] && git add scripts/pi/kiosk-launch.sh scripts/pi/kiosk.env.example && git commit -m "feat(pi): orientation from /home/pi/kiosk.env; portrait stays the default"
```

---

### Task 3: Doctor reports rotation

**Files:**
- Modify: `scripts/pi/kiosk-doctor.sh:105` (the state probe) and the block that prints it

- [ ] **Step 1: Probe**

After the `OUTPUTS=` line inside the remote script:

```bash
  xrandr --query 2>/dev/null | awk "/ connected/ {print \"ROT=\" \$1 \" \" \$3 \" \" \$4 \" \" \$5}"
  echo "ORIENTATION=$(grep -s '^ORIENTATION=' /home/pi/kiosk.env | cut -d= -f2)"
```

`$3 $4 $5` carry the geometry and the rotation word (`right`, `left`, or nothing for normal) as xrandr prints them.

- [ ] **Step 2: Report**

In the "X server is up" branch, after the monitor count:

```bash
  info "kiosk.env ORIENTATION=$(get ORIENTATION)"
  printf '%s\n' "$STATE" | grep '^ROT=' | sed 's/^ROT=/        /' | while read -r line; do info "$line"; done
```

- [ ] **Step 3: Run the doctor against the Pi**

```bash
bash scripts/pi/kiosk-doctor.sh
```

Expected: the two ROT lines show the current geometry and `right` (or `left`), and ORIENTATION reads empty until the env file exists. Paste the block into the PR.

- [ ] **Step 4: Commit**

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" = "docs/solo-pi-rotation" ] && git add scripts/pi/kiosk-doctor.sh && git commit -m "feat(pi): doctor reports each output's rotation and the kiosk.env orientation"
```

---

### Task 4: Runbook section

**Files:**
- Modify: `docs/ops/pushing-an-update-to-the-glass.md` (new section before "When it does not work")

- [ ] **Step 1: Write it**

```markdown
## Switching the glass between mosaic and solo

The solo kiosk (spec `docs/superpowers/specs/2026-09-04-solo-kiosk-design.md`)
runs the panels **landscape**. Three things must agree: the Pi's rotation,
the panel preset, and the active version. Change them in this order.

### Mosaic → solo

1. Merge and build phase 2 (`solo` in the version list). `vercel ls --prod`.
2. Sync the scripts and reload: `bash scripts/pi/kiosk-doctor.sh --sync --reload`.
3. On the Pi, set the orientation and reboot:
   `ssh pi@sunsetdisplay 'printf "ORIENTATION=landscape\n" > /home/pi/kiosk.env && sudo reboot'`
4. Turn the monitors on their stands. The doctor's ROT lines say which way
   the Pi now draws; the picture on the panels says whether the stand agrees.
5. In `/studio`: panel = `ktc-l` (or `dell-l`), active version = `solo`.
   Hold Deploy. The tabs pick it up within a minute and start advancing.
6. Verify on the glass: `bash scripts/pi/kiosk-doctor.sh --reload` twice, 30 s
   apart; the two screenshots must differ AND the frame on each panel must be
   the "on glass" row in `/studio/solo` for that feed.

### Solo → mosaic (rollback)

1. In `/studio`: active version = `v1` (or whichever was live), panel = `ktc`
   (or `dell`). Hold Deploy.
2. `ssh pi@sunsetdisplay 'printf "ORIENTATION=portrait\n" > /home/pi/kiosk.env && sudo reboot'`
3. Turn the monitors back. Doctor to confirm.

`ORIENTATION` unset or anything but `landscape` means portrait, so a lost env
file falls back to the mosaic arrangement, never to a blank screen.
```

- [ ] **Step 2: Commit, push, PR**

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" = "docs/solo-pi-rotation" ] && git add docs/ops/pushing-an-update-to-the-glass.md && git commit -m "docs(ops): switching the glass between mosaic and solo, with rollback"
GIT_TERMINAL_PROMPT=0 git -c credential.helper= -c credential.helper='!gh auth git-credential' push -u origin docs/solo-pi-rotation
```

PR title: `feat(pi): landscape orientation as a setting; runbook for switching to the solo kiosk (phase 4)`.

---

### Task 5: The switch itself (run by hand, after the PR merges)

- [ ] Follow "Mosaic → solo" in the runbook, step by step.
- [ ] Paste the doctor output and the two screenshot hashes into the PR, or into the opening-night tracker.
- [ ] Watch `/studio/solo` for ten minutes: the "on glass" row on each feed must change every 20 s, the two feeds 10 s apart, and the tally on a frame must rise after it shows.
- [ ] Leave the dials at their defaults for the first night; tune the next day with the bins in view.

---

## Self-review against the spec

- §8 phase 4: rotate both panels, runbook step, panel preset, flip `activeVersion`, verify with the doctor ✔ (Tasks 2–5)
- Reversible by a switch, no code change to go back ✔ (Task 2 default + Task 4 rollback)
- The Pi's launch script is no longer the only copy of the rotation logic ✔ (Task 1)
