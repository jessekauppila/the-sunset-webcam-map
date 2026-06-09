# QR Label + Shippable-Unit Hardening (Read-Only Root + Log-Shipping)

Status: Draft v0.1 — 2026-06-08
Owner: Jesse Kauppila
Part of the streamlined-deployment umbrella (`2026-05-15-streamlined-deployment-overview.md`). Refines E's sticker (`2026-05-15-wifi-onboarding-and-provisioning-design.md` §5.1–5.2).

---

## 1. Problem

A pre-built camera shipped to a non-technical recipient needs three things it doesn't have:

1. **A physical entry point** to onboarding (and later, management) that works even for someone who isn't digitally savvy or lacks a camera-phone.
2. **To survive being unplugged** without SD-card corruption — recipients *will* pull the power, and there's no graceful-shutdown ritual a non-technical person will perform.
3. **To stay debuggable** once it's a read-only field unit whose logs are volatile.

## 2. Goals

1. **A Nelko-P21 label per unit:** one QR to the setup/management site, plus human-readable URL + claim code + a friendly camera name — and **no secrets on the label**.
2. **Unplug-safe:** the unit can lose power at any instant with zero corruption risk — no button, no shutdown step.
3. **Debuggable while read-only:** recent device logs reach the cloud.

## 3. Non-goals (deferred / elsewhere)

- **The state-aware control surface** (the site menu: onboard / recalibrate / turn-off) and the **`reaim`/`shutdown` directives** — depends on sub-project F + the device supervisor; its own follow-on spec. This spec only points the QR at the setup URL; the site decides what to show.
- **E's full `provision-unit.sh` + WiFi captive portal** — not built yet; the label generator starts standalone and folds into provisioning later.
- **On-device "best sunset" ML** — that scoring is cloud-side (Vercel), unaffected by read-only root.
- **A/B-partition OTA** — the overlay-toggle maintenance window suffices at this fleet size.
- **A physical safe-shutdown button** — superseded by read-only root (the safe-unplug answer).

## 4. Design

### 4.1 The label

**Tape:** Nelko P21. Default stock is **14×40mm**, but that's too cramped for a scannable QR plus three text lines — so the design targets **14×75mm (0.55"×2.95")**. The generator is **parameterized by tape dimensions** (width_mm, length_mm, print DPI) so 14×50mm or 14×40mm-QR-only remain options.

**Layout (14×75mm, landscape):**
- **Left:** the QR, ~12–13mm square (the tape's 14mm height minus margins) — large enough to scan reliably.
- **Right column** (the human-readable fallback): **camera name** (bold, e.g. "Backyard West"), the **URL** (`sunrisesunset.studio/setup`), and the **claim code** (`SUNSET-7K3M-9XQ2`) in a clear monospace.

**The QR encodes** `https://www.sunrisesunset.studio/setup/{claim_code}` — E's existing format. **No `device_token`, no password** — the claim_code is the only credential, and it's a safe-to-show one-time binding key (§ Security below).

**The generator — an owner-gated admin label page** (recommended over a standalone script — it fits the Next.js stack, gives a live print preview, and reuses the existing admin claim-code mint):
- Route: `/admin/label` (owner-gated via the existing `requireOwner`), querying `?claim_code=…&name=…&tape=14x75`.
- Renders the label at the tape's pixel size (mm → px at the chosen DPI) — QR via the `qrcode` npm library, composited with the text — and offers **Export PNG** (and/or print).
- The operator exports the PNG → loads it into the Nelko phone app → prints on P21 tape.
- Ties to the existing `/api/admin/claim-codes` mint and `tier0-create-camera.sh` (which already produce the claim_code + camera identity).

**Security (why no secret on the label):** the camera authenticates to the cloud with a `device_token` the user never sees; the `claim_code` is a one-time binding key consumed at onboarding. A photographed label can at worst let someone claim an *un-onboarded* camera (the real owner notices). Putting the `device_token` on a physically-visible label would let anyone impersonate the camera — explicitly avoided.

### 4.2 Read-only root (overlay filesystem) — "unplug anytime"

The SD is mounted **read-only** with all writes going to a **RAM overlay** discarded on reboot, so power loss can never interrupt an SD write → zero corruption risk.

- **SD-image template:** enable the overlay filesystem (Raspberry Pi OS `raspi-config nonint enable_overlayfs`, or the boot-config equivalent) as the **last** image-build step.
- **Provisioning-order rule:** flash → boot → **commission** (write `device_token`/`camera_id`/`api_base` via `configure.sh` while the FS is still writable) → **enable overlay** → ship. Identity is baked in read-only and survives power loss permanently.
- **Runtime mutable state comes from the cloud:** the supervisor's `write_location` write lands in the RAM overlay (works during the session, re-fetched from the heartbeat after a reboot — self-healing). Captured images upload immediately; nothing important lives only on the SD at runtime.
- **Remote updates:** a deliberate maintenance window — toggle overlay **off** + reboot (writable) → `apt upgrade` / `git pull` the firmware / drop in files → toggle overlay **on** + reboot. Done over SSH now; a future cloud "maintenance mode" directive can orchestrate it.

**Known costs (accepted):** no persistent on-disk logs (mitigated by §4.3), updates require the toggle ceremony, future features must not assume disk persistence, and the Pi Zero's lack of an RTC means NTP-on-boot remains a dependency (unchanged by this).

### 4.3 Cloud log-shipping (thin)

So a read-only unit (volatile logs) is still debuggable.

- **Device side:** the supervisor's heartbeat loop attaches the **last N journal lines** (e.g. `journalctl -n 50 --no-pager` output, or a captured recent-log buffer) and a short status summary to its heartbeat request.
- **Cloud side:** the heartbeat handler stores the latest log blob per camera (a `cameras.last_log` text column, or a small `camera_logs` table with light rotation), readable by the owner/operator.
- Deliberately minimal — enough to see what a field unit is doing without SSH.

## 5. Testing

- **Label generator:** given `claim_code` + name + tape dims → the rendered output is the correct pixel size, the QR decodes to `…/setup/{claim_code}`, and the name/URL/code text is present. (Unit-test the URL construction + the mm→px sizing; verify the visual layout by eye.)
- **Read-only root:** a provisioning checklist + an **unplug test** — cut power mid-operation ~10×, confirm clean boot each time and that the device re-fetches lat/lng + mode from the cloud.
- **Log-shipping:** device — the heartbeat payload includes the log blob (test with a fake journal source); cloud — the handler stores and returns the latest blob.

## 6. Open questions

1. **Confirm the P21 tape length** — design targets 14×75mm; if the on-hand stock is 14×40mm, the layout falls back to QR-only (text on a second label or omitted). (Default 14×75mm.)
2. **Log storage shape** — `cameras.last_log` column (simplest) vs a `camera_logs` table with rotation (richer history). Lean toward the column first.
3. **Config persistence** — bake identity at commission + cloud-refetch mutable state (chosen), vs a small writable partition for `/opt/sunset-cam/config`. Lean toward bake + refetch (no extra partition).

## 7. Implementation slice order

1. **Admin label page** (`/admin/label`, owner-gated) + the `qrcode` dep — the centerpiece, usable the moment it lands (mint a code → render → print).
2. **Read-only root** — document + script the SD-image overlay step and the provisioning-order rule (operator procedure + an overlay-toggle helper for the update window).
3. **Cloud log-shipping** — firmware heartbeat log blob + the cloud store/view.

Each slice is independent and shippable on its own.

## 8. Relationship to existing work

- Refines E §5.1 (the sticker) and §5.2 (provisioning) — the label generator is the concrete production of E's sticker, starting standalone.
- The QR target (`/setup/{claim_code}`) is E's existing route; the state-aware behavior behind it is F + the control-surface follow-on.
- Read-only root pairs with the cloud-source-of-truth design already chosen (heartbeat delivers lat/lng; the supervisor re-derives mode on boot).
