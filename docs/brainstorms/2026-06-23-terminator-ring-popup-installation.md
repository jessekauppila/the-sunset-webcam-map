# Terminator Ring — Pop-Up Participatory Installation (Brainstorm)

**Date:** 2026-06-23
**Status:** Exploratory brainstorm. Not yet a spec. Several open questions remain.
**One-liner:** A portable pop-up installation where visitors turn their own phones into
monitors arranged in a ring. The ring stands in for the Earth's terminator (the day/night
line). Each phone shows one of the best sunrises/sunsets currently happening along that line.

---

## The vision

A circular room (set up anywhere, anytime, from a portable kit). Around the perimeter are
shelves/stands. A visitor walks in, scans a QR code, and their **own phone becomes a monitor**
in the ring. The ring as a whole represents the global terminator; each phone stands in for one
section of it, showing the best live sunrise/sunset happening in that part of the world right now.

The defining quality: **participation**. The audience builds the ring. A phone is only lit
while its owner is present, so the ring is alive, partial, and breathing — it fills as people
arrive and flickers as they leave.

### Portability is a hard requirement
This is a **pop-up** — set up quickly at many locations from a portable kit (shelves, QR cards,
maybe power/wifi). No fixed venue. Setup should be fast and repeatable.

### Bring-your-own-device is the point
Visitors use their **own phones**, not a fleet we own. The BYOD constraint is deliberate —
it's the mechanism of participation, not a compromise.

---

## Assignment model: greedy best-available (the key idea)

Phones are NOT assigned to fixed geographic slices. Instead:

1. A phone scans → the server hands it the **highest-quality sunset/sunrise happening right now
   that nobody has claimed yet.**
2. That phone is "placed in the ring" at a position reflecting **where on the terminator that
   sunset actually is.**
3. The next phone gets the **next-best unclaimed** sunset, placed at its position. And so on.
4. As phones join and leave, **each phone's angular share of the ring re-flexes** — with 4
   phones each owns a big arc; with 20 phones each owns a sliver.

**Why this model wins:** every single scanner is *immediately rewarded* with something genuinely
beautiful (greedy-best). It also kills the "dead ocean slice" problem of fixed slices — we never
*assign* a boring/empty section; we always hand out the best remaining light, and the geography
falls out of wherever that light happens to be.

---

## Why this is feasible — it reuses the existing system

The hard part is already built. The existing sunset-webcam-map already produces:
- Geolocated webcams worldwide
- ML quality scoring (`llm_quality`) that ranks frames
- An update cron keeping current frames fresh

So "the best sunset along this part of the terminator right now" is **a query over data we
already generate**, plus terminator math (the terminator position is a pure function of time).
The installation is largely a **new view onto existing data**, not a new data pipeline.

---

## What this DOES add to the build

### 1. Live "ring session" state (the one real new subsystem)
Greedy assignment needs memory: which cameras are currently claimed, by whom, and **releasing a
claim when a phone goes dark** (so its sunset returns to the pool for the next scanner).
- Each phone sends a **heartbeat**; miss a few → claim released → ring rebalances.
- **Upstash Redis (already in the stack) is the natural home for this.**

### 2. Kiosk display page (pure web, no install)
A fullscreen, auto-refreshing page per phone. BYOD reality:
- **Keeping the screen awake: largely solved.** `navigator.wakeLock` works in Chrome/Android
  AND Safari on iOS 16.4+. This was the scary part and is mostly a non-issue on modern phones.
- **True fullscreen: imperfect on iPhone.** iOS Safari doesn't grant the Fullscreen API on
  iPhone (only iPad). Design the station view to look intentional even with Safari's slim
  toolbar visible. No "Add to Home Screen" required (too much friction for a walk-up).
- **Must be a pure URL.** No app install, ever.

**Thematic forgiveness:** with BYOD, a dark phone isn't a bug — it's just a gap in the ring
where nobody's standing. The installation is *allowed* to be partial and alive, which removes
most of the "bulletproof kiosk" requirements.

### 3. Placement guidance
After a phone claims a sunset, the person needs to know **where to stand/place it** in the ring.
The phone screen tells them their slot. (Exact UX is an open question — see below.)

### 4. Physical kit + printable QR set + one-page setup sheet
Shelves/stands, laminated QR card(s), and a repeatable setup procedure.

---

## Proposed technical shape (draft)

Essentially a small set of additions to the existing web app:

- **`/ring/join`** (or a single QR target) — entry point a scan lands on. Talks to the ring
  session, claims the best unclaimed sunset, returns the phone's assigned camera + ring slot.
- **`/ring/station`** — the fullscreen, wake-locked, auto-refreshing display for the claimed
  camera, plus heartbeat + placement guidance.
- **Ring session service** — Redis-backed: claimed-camera set, heartbeats, release-on-timeout,
  recompute even spacing on join/leave.
- **Terminator-slice query** — reuses existing ranking to find best current frames; orders
  claimed cameras along the terminator.
- **Printable QR card set + setup sheet** — the physical kit deliverable.

---

## Open questions / decisions not yet made

### Q1 — Position model: true-geographic vs rank-ordered even spacing
- **(A) True-geographic:** each phone sits at its camera's *actual* angle on the terminator.
  Authentic, but with few phones they bunch wherever tonight's light clusters — ring looks lopsided.
- **(B) Rank-ordered even spacing (leaning toward this):** sort claimed cameras by position along
  the terminator, then distribute evenly around the physical ring. Still geographically *ordered*
  (walking the room still walks west→east along the day/night line), always visually balanced,
  and "angle each owns" cleanly = 360°/N.
- **Current lean: B.** Honors "walk the room = walk the terminator," makes "angle flexes with
  phone count" literally true and trivial to compute, and never looks broken at low turnout.
  *Not yet confirmed by Jesse.*

### Q2 — How does a phone know *where* to physically go?
If positions re-flex as people join/leave, we can't keep asking people to physically move.
Candidate approaches (undecided):
- Phone shows a clock/compass angle ("you're at the 4 o'clock position") and people self-organize.
- Numbered/lettered shelves; the phone tells you which shelf to take.
- Sunrise-half vs sunset-half of the room as a coarse split, finer ordering within.

### Q3 — What is the QR, exactly?
- A single QR everyone scans → server assigns the next slot dynamically (simplest; matches greedy
  model), OR
- Per-shelf QR codes encoding a physical position (more like the fixed-slice idea).
- The greedy model points toward **one shared QR**, with placement decided *after* assignment.

### Q4 — Sunrise AND sunset, or sunsets only?
The terminator has both a sunrise edge and a sunset edge. Showing both makes the ring a complete
day/night line. Showing only sunsets is simpler. Undecided.

### Q5 — Connectivity / power for the pop-up kit
BYOD phones need internet. Venue wifi? A portable hotspot in the kit? Phones drain fast on a
wake-locked bright screen — do shelves offer charging? Affects the kit design.

### Q6 — Where is the boundary of v1?
Possible v1 = "the web app can turn any phone into a greedy-assigned, wake-locked ring station,
demoed on a handful of phones on a table." Physical room, many shelves, polished kit = later.
*Scope not yet locked.*

---

## Relationship to existing work
- Echoes the **streamlined-deployment** instinct (make setup trivial for non-technical people),
  but pointed at *displays* instead of *cameras*. BYOD displays are simpler than installed
  cameras — no untrusted hardware, no per-recipient config, just a URL.
- Reuses the existing **ML ranking** (`llm_quality`) and **update cron**.
- Reuses **Upstash Redis** for live session state.

---

## Suggested next steps (pick one — Jesse unsure where to go)
1. **Lock scope of v1** (Q6) — decide how much is "software prototype on a few phones" vs "full
   pop-up kit." Everything else gets easier once this is set.
2. **Resolve the position/placement model** (Q1 + Q2) — the core interaction.
3. **Spike the greedy assignment + ring session** in Redis as the riskiest new subsystem.
4. **Spike the kiosk display page** (wake lock + fullscreen-ish + auto-refresh) on a real iPhone
   and Android to confirm the BYOD experience feels good.
5. Once scope + position model are settled, promote this brainstorm into a formal design spec.
