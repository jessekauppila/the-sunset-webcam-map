# Travel Router (GL-X3000 Spitz AX) — Troubleshooting & Provider Handoff

**Date:** 2026-08-05
**Purpose:** Portable context for troubleshooting the kiosk's cellular router and/or
switching data providers in another conversation. Everything another session needs is here.

## The hardware

- **GL.iNet GL-X3000 (Spitz AX)** — 5G cellular router, dual nano-SIM (single standby),
  Wi-Fi 6, 1× 2.5G WAN + 1× GE LAN, 4 detachable cellular antennas, wall-powered
  (12V barrel; can run from USB-C PD with a converter cable). Bought new on Amazon
  ~2026-08-01, sold by GL Technologies, 2-yr warranty, 30-day return window.
- Admin panel: **http://192.168.8.1** (browser, from any device on its wifi).
  Admin password: the one Jesse set (street address of the Vermont place + `!`).
- Wifi SSIDs: `GL-X3000-ced` (2.4G) and `GL-X3000-ced-5G` — still factory names.
  Wifi password: factory, printed on the router's bottom label (`Z43Q9T7PCT`),
  also saved in Jesse's Mac keychain.

## The SIM / plan (current)

- **US Mobile prepaid** physical SIM in slot 1 ($3.99 starter kit from Amazon).
- **Activated on US Mobile's AT&T-based network ("Dark Star")** — confirmed by the
  router's public IP whois (AT&T Mobility) on 2026-08-04. NOT on T-Mobile.
- Plan size/renewal date: check the US Mobile app/site (jesse.kauppila@gmail.com
  account). **A drained or expired prepaid plan is a prime suspect whenever the
  router "works but no internet."**
- Second SIM slot is EMPTY — available for a second carrier + auto-failover.

## Known-good state (what "working" looks like)

As of 2026-08-04 evening: router on, SIM on AT&T network, Mac + phone + kiosk Pi on
its wifi, public IP in AT&T space, production site loading in <1s. The kiosk Pi
(`sunsetdisplay`, Tailscale 100.121.76.80) joins its wifi automatically via
NetworkManager profile `spitz` (bound to SSID `GL-X3000-ced`).

## Troubleshooting ladder (work top-down)

1. **Power**: barrel plug seated, wall outlet live. Front LEDs should light within
   ~30s of power. No LEDs = power supply/outlet problem.
2. **Boot + wifi**: within ~2 min, `GL-X3000-ced` SSID should be visible on a phone.
   No SSID after 3 min → hold the reset pin 4s (reboot). SSID but can't join →
   password is the label one, not the admin one.
3. **Cellular**: join the wifi, open http://192.168.8.1 → Internet page → Cellular.
   Check: SIM detected? Signal bars? "Connected" with an IP? Common failures:
   - *SIM not detected*: reseat SIM 1 (power off first). Nano-SIM, contacts down.
   - *Registered, no data / no internet*: **check US Mobile balance/plan first** —
     prepaid plans lapse silently. Then check APN (US Mobile AT&T network uses APN
     pushed automatically; a manual wrong APN blocks data).
   - *No signal*: antennas finger-tight? Move near a window; check
     coverage at the current address (this failure is location-dependent).
4. **Speed/behavior weirdness after days of uptime**: known platform quirk — set
   scheduled nightly reboot (System → Scheduled Tasks) if not already on.
5. **Data usage check**: router admin panel tracks per-SIM usage; compare against
   the US Mobile plan allowance. The kiosk Pi self-reports its own usage daily
   (ntfy topic `sunset-kiosk-data-jk7x3q` + email digest at 8am).

## Provider-switch context (for the provider conversation)

- **Why the SIM choice matters**: the long-term cheap-unlimited option (Calyx
  Institute Sprout, $500/yr or $150/quarter, SIM-only) is **T-Mobile-network-only**.
  The planned dress rehearsal was to switch this US Mobile line from Dark Star
  (AT&T) to **Light Speed (T-Mobile)** in the US Mobile app (free network transfer)
  and live on it a while at the studio before committing to Calyx.
- **Locations that matter for coverage**: Bellingham WA 98225 (home),
  3273 Blanchard Rd, Bow WA 98232 / downtown Edison (studio/venue — flat Skagit
  farmland but near Blanchard Mountain shadow), 68 West Main St, West Barnet VT
  (future; rural Caledonia County — statewide data says Verizon strongest there,
  T-Mobile thin in rural VT).
- **Router is carrier-agnostic**: unlocked, AT&T & T-Mobile certified, works with
  Verizon-network MVNOs with settings effort. Dual-SIM means two carriers at once
  with failover — e.g., Calyx T-Mobile in slot 1 + small prepaid Verizon-network
  SIM in slot 2 for dead zones.
- **Signal remediation before switching providers**: the X3000 takes external
  antennas — Waveform QuadMini (~$119 omni) or QuadPro (~$250 directional);
  Waveform publishes a GL-X3000-specific guide. Weak signal at one address is an
  antenna problem before it's a carrier problem.

## Dependencies to remember when changing anything

- The **kiosk Pi expects SSID `GL-X3000-ced`** (NetworkManager profile `spitz`).
  Rename the router's SSID or replace the router → update the Pi:
  `sudo nmcli con modify spitz wifi.ssid "<new>" wifi-sec.psk "<new-pw>"` (or add a
  new profile). The Pi also knows Jesse's home wifi ("Antifa Headquarters").
- The Pi is reachable via **Tailscale as `sunsetdisplay` (100.121.76.80)** from
  anywhere, on any network, once it has internet — that's the recovery path.
- The kiosk browsers point at production `sunrisesunset.studio/kiosk/*`; no
  router-specific config in the web app.
