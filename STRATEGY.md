---
name: Sunrise/Sunset
last_updated: 2026-06-02
---

# Sunrise/Sunset Strategy

## Target problem

Somewhere on Earth a beautiful sunrise or sunset is happening right now, and there's no
way to know where — webcams are everywhere, but none of them know whether they're
pointed at a good sky. The crux: a genuinely beautiful sky is rare, buried in thousands
of mundane feeds (alleyways, highways, parking lots), and it vanishes within minutes.

## Our approach

Rate every webcam frame's sky quality with an ML model on a live, terminator-anchored
map, so the rare good skies surface out of the ordinary feeds in real time. The bet: the
mundane feeds are the point, not noise — beauty lands because of the contrast — and one
rated pipeline serves both a working product and the art it produces (installations,
collectors), so each makes the other better.

## Who it's for

**Primary:** The viewer / hub visitor — hiring Sunrise/Sunset to see, in one place and in
real time, where the sky is beautiful on Earth right now, and to feel the beauty that
pokes through ordinary life.

**Secondary:** The collector / camera operator — hiring it to install a camera at their
own window, get the best sunrise/sunset that window saw each day into a personal archive,
and contribute those frames back to the larger project.

<!-- Jesse operates the private studio (rating, model auditing, archive); that's an
operator role inside the project rather than a separate market persona. -->

## Key metrics

- **Sky-quality precision** — when the map/kiosk says a frame is "good," is it actually
  good? Model F1 / balanced accuracy on the frozen test set, plus agreement with human
  verdicts (ML eval + DB).
- **Sunrise/sunset vs. non-event detection** — can the model reliably tell a real event
  from a dud frame? (ML eval on the frozen test set.)
- **Coverage** — count of live, correctly-positioned cameras (public + custom) near the
  terminator at any tick; the richness of the planetary portrait (cron/DB).
- **Deployment friction** — time and step-count for a non-technical person to go unbox →
  online → first verified image; target under 5 minutes (timed walkthrough).
- **Label-flywheel health** — human/operator verdicts captured per week, especially on
  hard/disagreement examples feeding the next model version (DB).

## Tracks

### Model quality & sunrise/sunset detection

Getting the best skies to the top and reliably telling real sunrise/sunset events from
non-events — hard-example mining, private labeling, v4 → v5, and the deploy automation
that ships those models safely.

_Why it serves the approach:_ the ML rating is what surfaces beauty from the ordinary;
without it there is no signal and no art.

### Custom cameras in the field

Making custom Raspberry Pi cameras (Pi Zero 2 W + Arducam + IMU) reliably capture and
post end-to-end, and making them deployable by non-technical people — bringup, the device
protocol, WiFi onboarding, alignment, first-image verification.

_Why it serves the approach:_ custom cameras grow coverage where public webcams can't,
and are the substrate for the collector product.

### The hub & its installations

The website as the place where the whole project becomes visible — a public face that
shows-don't-tells (live map, leaderboards of the best skies), a private login-gated studio
for rating and model auditing, and physical installations starting with the quality-scaled
kiosk mosaic.

_Why it serves the approach:_ the project only matters if people can see it; the hub is
where product and art are experienced.

### The collector loop

Turning a camera owner into a contributor: daily best frame → personal archive → labels
and frames flowing back to the larger project. Includes operator delivery and the
human-verdict labeling loop.

_Why it serves the approach:_ it closes the flywheel — people get something they love and,
in return, make the model and the planetary portrait better.

## Not working on

- On-device ML as the authoritative judge (the server model stays authoritative; on-device
  `edge_score` only pre-filters).
- Native mobile apps (web + DeviceOrientation APIs only).
- Live video streaming as a primary feature (stills-first; MJPEG reserved for later).
- Public accounts and crowd rating at scale — public is read-only for now; crowd rating is
  deferred, with the ratings schema kept ready to switch it on.
- Globally hiding low-scoring frames (the ordinary is the point; modulate by score instead).

## Marketing

**One-liner:** See where the sky is beautiful right now — the planet's sunrises and
sunsets, rated and mapped in real time.

**Key message:** Webcams everywhere watch alleyways, highways, and parking lots.
Sunrise/Sunset finds the beauty that pokes through — and lets you put a camera in your own
window to collect it.
