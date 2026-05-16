# Streamlined Deployment — Decomposition and Status

Status: Draft v0.1 — 2026-05-15
Owner: Jesse Kauppila
Tracks: the sub-projects required to make a custom Pi camera deployable by a non-technical recipient.

---

## 1. The umbrella problem

Setting up the first test Pi at the operator's house took a long time: flashing the SD card, editing `config.json` with claim_code + lat/lng + placement angles, configuring WiFi credentials, SSHing in to verify. None of this is possible for a non-technical recipient.

**End-state goal:** the operator pre-builds a unit, ships it, and the recipient — who has never opened a terminal in their life — can take it from "unbox" to "first image arriving on the map" using only their phone.

This requires several pieces, each with its own design and implementation cycle. This doc tracks them.

## 2. The sub-projects

| # | Sub-project | Status | Spec |
|---|---|---|---|
| **E** | WiFi onboarding + SD-card provisioning | **Draft spec** | `2026-05-15-wifi-onboarding-and-provisioning-design.md` |
| **F** | Wizard frontend (cloud-hosted, picks up post-WiFi) | Stub | `2026-05-16-cloud-wizard-frontend-design.md` |
| **C** | Install-time orientation (roll capture + "which way is up" overlay) | Open questions | — |
| **D** | AI placement-quality checks + step reduction | Open questions | — |
| **G** | First-image verification UX | Not started | — |
| **B** | Test-camera black-image debug | Out of scope for this umbrella; tracked separately | — |

The lettering preserves the A/B/C/D framing from the 2026-05-15 brainstorm: A was the visibility single-source-of-truth (already specced); B is a debug task; C and D were the immediate triggers for this revisit. E, F, and G surfaced once we widened scope from "AR step polish" to "recipient end-to-end."

Subproject A (`2026-05-15-custom-cam-visibility-single-source-of-truth-design.md`) is **not** part of this umbrella — it's about how custom cams appear on the map, not how they get installed.

## 3. Dependency order

```
E (WiFi + provisioning)  ──► F (Wizard frontend) ──┬──► C (orientation)
                                                   └──► D (AI checks)
                            └──► G (verification)
```

- E must come first: without WiFi onboarding, no recipient can put a unit online.
- F builds the 6-screen wizard UI; it consumes E's WiFi-handoff contract.
- G closes the loop by polling for the first image and confirming success.
- C and D are polish on F's AR step — meaningful only once F is shippable.

## 4. Cross-cutting decisions made here

These are settled across all sub-projects so each spec doesn't re-litigate:

1. **WiFi mechanism: captive portal, not BLE.** BLE requires Web Bluetooth, which iOS Safari does not support; that alone kills it for a non-app-install setup flow.
2. **Two-wizard split:** a tiny device-local page during captive portal (just collects WiFi credentials), then a cloud-hosted wizard at `sunrisesunset.studio/setup/{claim_code}` for everything else. Detail in spec E.
3. **Claim code is the binding key end-to-end:** sticker → device firmware → cloud wizard → pre-register call → matched to device on `/register`. No other identifier needs to be human-handled.
4. **No native app.** Browser only, all platforms.
5. **The cloud wizard supersedes the old `docs/ar-placement-portal.md` stub.** That file has been moved into `2026-05-16-cloud-wizard-frontend-design.md` as the sub-project F starting point; this overview is the new entry point for the umbrella.

## 5. Open architectural questions (defer until E ships)

- Should `placement.roll_deg` (the new field from C) be required at `pre-register`, or can it default to 0 and be corrected after first image? Affects whether C blocks F.
- Should the device's `register` call ever happen *before* the cloud wizard finishes (the new order under captive-portal flow), and if so what's the device's behavior while placement is pending? Resolved in E's protocol-amendment section.
- Where does the captive portal's setup web app live in the firmware repo? Adjacent to `main.py` or a separate process? Resolved in E.

## 6. Build order summary

1. **E** — WiFi onboarding + provisioning (next; spec in progress).
2. **F** — Cloud wizard frontend, minimum-viable (just lat/lng + phase + delivery + placement; no AR overlay yet).
3. **G** — First-image verification (small; tacks onto F).
4. **C** — Orientation (roll capture + housing overlay).
5. **D** — AI placement-quality + step reduction.

Each becomes its own spec under `docs/superpowers/specs/` when its turn arrives.
