# Setup Wizard Reconciliation — One Cloud Wizard, Bracket Flow Inside

Date: 2026-06-13
Repo: `the-sunset-webcam-map` (the cloud wizard, sub-project F) — with a demoted role for
the firmware Pi-served wizard.

Reconciles **three** overlapping wizard designs into one canonical flow + look:
1. **Firmware Pi-served 4-step** (`existing-setup-wizard-spec.md`; sun/phone/window/manual) — the on-device vanilla wizard.
2. **Cloud wizard F** (`docs/superpowers/specs/2026-05-16-cloud-wizard-frontend-design.md`; the `app/setup/[claim_code]` skeleton) — confirm → phase → delivery → ar-placement → horizon-sweep → mount-here → submit.
3. **Window-bracket prototype** (`sunset-cam-firmware/docs/prototypes/2026-06-12-window-bracket-prototype.jsx` + handoff) — the polished phone-measures-window → physical-wedge flow.

## Problem

Three wizard designs, each started independently, cover overlapping ground (this is the
"verify it isn't already built / branch sprawl" lesson — see
`docs/solutions/best-practices/integrate-frequently-dont-let-branches-sprawl.md`). We need
ONE canonical wizard so future work stops forking.

## Decisions

1. **One canonical wizard: the cloud wizard (F)** at `app/setup/[claim_code]` (HTTPS — the
   phone's camera/compass need a secure context). The **bracket prototype is its placement
   experience and its visual language**; F's operational steps wrap it.
2. **The firmware Pi-served wizard is demoted to a local fallback + the "alignment tool"
   side-trip** — not retired. It still uniquely works **on the camera's own WiFi with no
   internet** (on-site / cloud-down installs) and is the **sun-tap/MPU fine-alignment** tool
   (per F spec §4's "Open the alignment tool" link).
3. **Bracket flow is the primary placement paradigm** (decided prior session). Phone measures
   the window → outputs a physical wedge; the aim is correct by construction.
4. **Not-yet-built steps ship as placeholders with a "Skip for now" affordance**, so the flow
   is end-to-end navigable before everything is built (the existing `ArPlacementPlaceholder` /
   `HorizonSweepPlaceholder` already do this — we're being deliberate about it).

## The merged flow (9 steps)

| # | Step | Source | Status |
|---|------|--------|--------|
| 1 | **Connect** — device online via WiFi handoff; poll `setup-status` | F | real, **gated on sub-project E** (placeholder/mock until E ships) |
| 2 | **Sunrise or sunset?** — sets facing (east/west) + equinox az (90/270) | bracket #1 *merged with* F's phase | real |
| 3 | **Measure the window** — phone flat on glass → window-normal azimuth | bracket | real |
| 4 | **Hinge to the equinox** — live camera + 3 arcs, swing to lock | bracket | real (engine = `solar.ts` + `/api/setup/declination`) |
| 5 | **Your bracket** — wedge angle + flip direction + lens | bracket | real |
| 6 | **Assemble** — fit the wedge to the case | bracket | real (mostly instructions) |
| 7 | **Mount & confirm** — mount on the glass; confirm live view | bracket + F | real |
| 8 | **Delivery** — notification channel + cadence | F | **placeholder ("Skip for now")** |
| 9 | **Submit** → `pre-register` | F | real |

- **Facing/phase merge:** the bracket's screen-1 facing choice *is* F's phase-preference. One
  step. (`phase` is `sunrise|sunset` for a single-aimed camera; drop `both`.)
- **Replaced:** F's `ar-placement` + `horizon-sweep` + `mount-here` → the bracket screens (3–7).
- **Dropped for v1:** `horizon-sweep`. `pre-register` defaults `horizon_profile` to a flat
  geometric horizon (`horizon_altitude_deg = 0`). Real refinement for obstructed horizons;
  add later as a (skippable) step.
- **Delivery** is the lone non-aiming step → moved to after Mount & confirm, shipped as a
  placeholder; default `gallery-only` if skipped. Notification prefs can also live in "My
  Cameras."

## Data: what `pre-register` stores (full provenance)

The bracket flow measures; `pre-register` persists a **placement** plus **full bracket
provenance** (provenance is cheap and feeds a real loop: the field distribution of wedge
angles tells us which bracket angles to actually manufacture — finer steps in the common
range, a few for outliers).

```
POST /api/cameras/pre-register
{
  claim_code,
  lat, lng,                         // phone geolocation (camera has none yet)
  elevation_m, timezone,
  placement: {
    azimuth_deg,                    // realized aim = window_normal_az + snapped_wedge ≈ equinox; COARSE
    tilt_deg: 0,                    // v19: no vertical tilt (camera level at the horizon)
    horizon_altitude_deg: 0,        // default (horizon-sweep dropped v1)
    horizon_profile: null,
    azimuth_source: 'bracket',      // NEW — drives sun self-refine (vs 'sun' = precise)
    coarse: true,                   // NEW
    bracket: {                      // NEW — full provenance (the prototype's output payload)
      window_normal_az_true,
      window_azimuth_offset_deg, window_offset_side,
      wedge_angle_deg, flip_direction,
      residual_aim_error_deg,
      lens,                         // 'wide_120' | 'standard_66' — sets FOV downstream
      material_thickness_mm
    }
  },
  operator_preferences: { phase_preference, delivery: null }  // delivery null when skipped
}
```

- **`azimuth_deg`** is the realized bracket aim, recorded **coarse** — the sun self-refines it
  to ~1° on the Pi over the next sunsets (the `azimuth_source`/`coarse` flags drive that).
- **`lens`** flows down to the device config (FOV math) and into coverage computation.
- The pure geometry (`wedge_angle_deg`/`flip_direction`/`residual`) is **installer-facing**
  (shown on the "Your bracket" screen) **and** stored for the manufacturing-distribution
  analysis. It's aggregatable across installs.
- Schema work: extend `pre-register`'s placement type + the `cameras`/placement persistence
  with `azimuth_source`, `coarse`, and a `bracket` JSON blob.

## The look

Adopt the bracket prototype's React aesthetic as the cloud wizard's visual language: the amber
palette, the `InsideOutFrame` top-down diagrams (window/glass/room), the rAF hinge animation
(demo→live), and the bracket-spec card. Port the prototype's components into
`app/setup/[claim_code]/steps/` (replacing the placeholders), reusing the existing
`useDeviceOrientation` / `useGeolocation` / `usePolling` hooks rather than the prototype's
mocked sliders.

## Where last night's salvage plugs in

Step 4 (Hinge to the equinox) is powered by the pieces salvaged onto `feat/cloud-https-setup`:
- `app/lib/solar.ts` — the 3 arc azimuths + `azToX` projection, computed **client-side** from
  the phone's geolocation (`useGeolocation`).
- `GET /api/setup/declination?lat=&lng=` — magnetic→true conversion for the live compass
  heading (`useDeviceOrientation`).

## Dependency / sequencing

- **Sub-project E (WiFi captive portal) is still the true foundation.** Step 1 ("Connect") and
  any real shipped end-to-end install depend on it. This wizard can be **built and demoed
  against a mocked WiFi handoff**, but it isn't *shippable to a recipient* until E exists.
- This spec **supersedes the placement portions** of `2026-05-16-cloud-wizard-frontend-design.md`
  (§4 ar-placement, §5 horizon-sweep, §6 mount-here) and the standalone
  `2026-06-13-cloud-https-phone-compass-calibration.md` plan (already banner-marked superseded).

## Not doing (this spec)

- Building it — this is the design-of-record only; implementation is a follow-on plan.
- Sub-project E (separate, and the foundation).
- Vertical tilt, sloped glass, horizon-sweep (v19 exclusions / v1 cuts).
- Retiring the firmware Pi-served wizard (kept as fallback + alignment tool).
