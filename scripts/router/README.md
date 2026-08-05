# GL-X3000 router tooling

CLI + logging for the kiosk's GL.iNet GL-X3000NR cellular router, per the
2026-08-05 router handoff. The kiosk Pi (`sunsetdisplay`, on the router's LAN,
reachable over Tailscale) is the jump host: deploy there, and the Bow
deployment becomes remotely diagnosable.

**No secrets here — this repo is public.** The router admin password lives in
`GLINET_PASSWORD` or `~/.config/glinet/password` (chmod 600) on whatever
machine runs the script. Site addresses, SIM/line details, and the open
registration issue live in the private handoff doc outside this repo.

## Commands

```
python3 glinet.py status [--public] [--json]   # SIM, registration, RSRP/RSRQ/SINR, band, carrier
python3 glinet.py log --db signal.sqlite       # one reading -> SQLite (cron this)
python3 glinet.py report --db signal.sqlite    # p10/median/p90 RSRP+SINR — the carrier-decision data
python3 glinet.py usage                        # per-SIM traffic counters (raw)
python3 glinet.py reboot --yes                 # recovery: full router reboot
python3 glinet.py probe                        # which API methods exist on this firmware
python3 glinet.py raw <object> <method> [json] # exploration passthrough
```

Remote one-liners through the jump host:

```
ssh pi@sunsetdisplay 'python3 ~/router/glinet.py status --public'
ssh pi@sunsetdisplay 'python3 ~/router/glinet.py report --db ~/router/signal.sqlite --days 7'
```

## Deploy

`./deploy-to-pi.sh` — copies the script to the Pi, stores the admin password
there if missing (prompted, never echoed, never in git), and installs a
5-minute cron that logs to `~/router/signal.sqlite` and pages the existing
ntfy topic on up/down transitions.

## Status / caveats (2026-08-05)

- **Not yet validated against live hardware** — built while the router was
  down ("SIM card not registered") and the Pi offline. GL.iNet 4.x method
  names vary by firmware, so `status`/`log` try a candidate list and parse
  whatever answers. **First live session: run `probe`**, then prune
  `STATUS_CANDIDATES`/`USAGE_CANDIDATES` to the methods that exist.
- md5crypt challenge auth is verified against `openssl passwd -1`.
- **Down-alert limitation:** when cellular drops at Bow, the Pi usually loses
  its only uplink, so the "down" ntfy can't escape — you'll reliably get the
  "back up" page and gaps in the log. A true dead-man's switch has to live
  server-side (alert on absence of kiosk traffic to sunrisesunset.studio);
  candidate follow-up, fits the existing daily digest cron.
- Enable the router's own nightly scheduled reboot (System → Scheduled
  Tasks) — known platform quirk: throughput degrades after multi-day uptime.

## Interpreting `report`

| Metric | Good | Usable | Marginal → remediate |
|---|---|---|---|
| RSRP | > -95 dBm | -95 to -105 | < -110 dBm |
| SINR | > 15 dB | 10–15 | < 10 dB |

A week of distribution at the deployment site is evidence; a single reading is
noise. Weak signal is an antenna problem (Waveform QuadMini/QuadPro, external
antenna ports) before it is a carrier problem.
