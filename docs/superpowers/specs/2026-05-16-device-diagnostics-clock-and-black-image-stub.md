# Device Diagnostics — Clock Drift + Black Image

Status: Stub — 2026-05-16
Owner: Jesse Kauppila
Subproject B of the post-MVP visibility/AR/hardware decomposition.

---

## Problem

Two symptoms observed on the field-deployed Pi Zero 2 W test camera (lat 48.7519, lng −122.4787, "Tier 0 Test Camera — Jesse House"):

1. **Black images.** Snapshots captured during the device's active window — uploaded to Firebase and scored normally — are visually solid black or near-black. AI scoring still runs but on no real content.
2. **Future-stamped snapshots.** The `captured_at` value attached to uploaded snapshots is ~7 hours in the future. Observed example on 2026-05-16: device-side cron-tick payload showed `snapAt=2026-05-17T11:29:58.396Z` returned by the API while server-side `now()` was `2026-05-17T04:36Z` UTC.

Both symptoms originate at the device, not in the cloud. Server-side accepts whatever the device sends.

## Hypothesis: Two Decoupled Problems

**Updated 2026-05-16 22:00 PDT after a second sunset of observation.**

The initial hypothesis was that both symptoms shared a root cause: a wrong clock would shift the active window into real-world darkness and produce black images, while also stamping uploads with future timestamps. Both predictions are *consistent* with the clock-drift hypothesis.

But the second night of testing showed the camera producing real, well-exposed sunset imagery — *while still uploading future-stamped snapshots*. If clock drift caused the black images, every image should be black. They aren't. So:

- **The clock drift is real and persistent.** Confirmed twice. Likely a `datetime.now()` vs `datetime.utcnow()` confusion in the upload path (the +7h offset matches PDT/UTC arithmetic exactly).
- **The black image from 2026-05-15 was likely transient.** Probably weather (heavy overcast at golden hour), a startup driver glitch, or a one-off exposure error. Will know once we have several nights of observation under varied conditions.

Treat these as two independent items. The clock fix is small and obvious. The intermittent black-image issue needs more data points before it's worth a real diagnosis — collect another week of snapshots and look for a pattern (does it correlate with weather, time-of-night, reboots, anything?).

A secondary consequence: this also explains why the cam appeared at "wrong" times on the map before the visibility fix landed. The freshness predicate the cloud cron uses (`captured_at >= now - 90min`) is trivially satisfied by future timestamps, so the cam was "always fresh" regardless of when it actually captured. Once a real geometric predicate landed, the geographic gating started working — but freshness is still effectively a no-op for this device until the clock is fixed.

## Why the Pi clock would be wrong

The Pi Zero 2 W has **no battery-backed RTC.** On boot it has no idea what time it is. The standard recovery is:

- `systemd-timesyncd` polls NTP and sets the system clock.
- If NTP is blocked by the local network, misconfigured in `/etc/systemd/timesyncd.conf`, or the service is failing, the clock stays at whatever the kernel decides on boot (often Jan 1 1970, but also sometimes whatever the filesystem mtime hints at).

The **specific +7 hour skew** is suspicious. Possibilities, in rough order of likelihood:

1. **Timezone double-conversion.** Pacific (PDT, UTC−7) is exactly 7 hours behind UTC. Code that takes a local-time wallclock value and stamps it as if it were UTC would produce snapshots 7 hours in the future during PDT. The arithmetic matches *exactly*.
2. **NTP succeeded but UTC offset got added twice somewhere** in the capture-and-upload pipeline (Python's `datetime.now()` vs `datetime.utcnow()` confusion, or naive datetime → ISO string assuming local but treating as UTC).
3. **Clock got set from an HTTP `Date` header in the wrong reference** — less likely, but the firmware does talk to the cloud on boot for registration.

Hypothesis 1 is the most testable: if the device thinks "now" is 2026-05-17 04:30 PDT but the firmware stamps it as "2026-05-17T04:30Z UTC", the resulting timestamp will be 7 hours in the future of true UTC.

## How to diagnose (in priority order)

1. **SSH into the Pi.** Run `date`, `timedatectl`, and `cat /etc/timezone`. Compare to wallclock. If `date` reports the correct local time and `timedatectl` says NTP is synced and UTC is correct, then the bug is in the firmware's timestamp serialization (Hypothesis 1). If `date` is already wrong, then NTP is failing.
2. **Look at the snapshot-emitting Python code.** Search the firmware repo for `datetime.now()`, `datetime.utcnow()`, `isoformat()`, `astimezone()`. Any path that builds the `captured_at` string from a naive datetime is a smoking gun.
3. **If suspicion lands on the active-window math:** add a debug log line on the device that prints `[active-window-check] now={now_iso} sunrise_today={sunrise_iso} sunset_today={sunset_iso} in_window={bool}` once per tick. Watch for a tick where `now` and `in_window` disagree with real-world conditions.
4. **Confirm black-image causality:** force the device to capture *outside* its computed active window (manual trigger). If the resulting image is well-exposed, the active-window math is the bug. If it's still black, the sensor / driver / lens is also at fault, separately.

## Out of scope for this stub

- **Image-quality tuning** (ISO, shutter, lens). Separate from the timing bug. Defer until clock is verified-correct and a real golden-hour snapshot is captured.
- **Hardware mounting / orientation** ("which way is up"). That's Subproject C.
- **Server-side guards** against future timestamps. Explicitly *not* fixing this in the cloud — masking the symptom would prevent diagnosis of the device-side root cause.

## Linkage

- [[2026-05-15-custom-cam-visibility-single-source-of-truth-design]] — the visibility fix that surfaced this bug. The freshness predicate is no-op'd by the clock skew but still correct in principle.
- Future Subproject C ("which way is up") — black-image cause is split between *timing* (this spec) and *orientation* (subproject C). After timing is fixed, if the image is still bad, the orientation hypothesis becomes the leading one.

## When this becomes a real spec

When someone (probably you, with SSH access to the Pi) runs the diagnostic steps above and identifies which hypothesis is correct. The full spec then proposes the firmware-side fix (NTP enforcement, timestamp serialization correction, or both) and the verification plan (round-trip a known-good snapshot during a real golden hour).
