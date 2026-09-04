# Opening Night Runbook — show day 2026-09-12

What has to be true on the glass by the evening of the twelfth, the order to
make it true, and what to read each day so nothing blanks when the doors open.

Live tracker (checkboxes, countdown): https://claude.ai/code/artifact/810a7c67-4846-4021-b0d1-68fc7be3d0f5
Implementation plan for the feature this depends on:
`docs/superpowers/plans/2026-09-03-pool-retention.md`

Every measurement here was read from production on 2026-09-03.

## Where things stand (2026-09-03, evening)

| | |
| --- | --- |
| Quota gate, first full UTC day over 22,300 | **CLEAR** — 27,600 boxes, zero non-OK, land probe populated (20:52Z) |
| `sweep_force_day_ring` | **OFF**, merged in #119, flips at runtime |
| Pool memory between ticks | **NONE** — one bad tick empties both panels (see the plan) |
| Natural escalation | 118 sunrise-thin ticks, all recovered; day ring passed the gate at 14.0% vs 6.8% base |
| Merged today | #119 pool coverage phase 1, #120 mosaic v3, #121 studio rail, #122 v3 dials 8×240 |

## The nine days

Pacific first, UTC beside it. The show runs in the freshest hours of the UTC day.

### Thu Sep 3 — today
- Done: #119–#122 merged. Gate read CLEAR past 22,300. Retention plan written.
- Empty-box alarm closed: partial days plus silent 400s, not a quota.

### Fri Sep 4 — build day
- Build day was actually Thu Sep 3: Tasks 1–6 were implemented and reviewed
  on `feat/pool-retention`. Fri Sep 4 is now PR, merge, deploy, verify.
- Verify on the next tick: `retention.held` is false; the active pool exceeds the
  per-tick camera count by roughly the 20-minute grace (about 15–20 cameras).
- Apply `20260904_sweep_hold.sql` before merging Tasks 5–6.

### Sat Sep 5 — preview opens
- Slow the kiosk tick to two minutes so the ring can go on without widening the
  call envelope: `KIOSK_TICK_INTERVAL_MS` 60,000 → 120,000 and
  `KIOSK_TICK_LOCK_TTL_MS` 55,000 → 115,000, with a test pinning lock < interval.
- Write the `cost_events` row, then `node scripts/set-runtime-flag.mjs
  sweep_force_day_ring on --apply`. Verify two rings in the next tick's
  `🛰️ terminator sweep:` line.
- Run the gate check. Expect boxes per day near 27,600, the proven figure.

### Sun Sep 6 – Tue Sep 9 — preview window
- Gate check once a day. Read the digest: held ticks, failed boxes, boxes per
  gate-passed frame per ring.
- Look at the glass with the widened pool. This is the preview.
- Any 429, 403, or land boxes at zero: flag off, note it in `cost_events`, keep
  going. Retention keeps the pool live either way.

### Wed Sep 10 — configuration freeze
- Rings, tick cadence, and flag state stay as they are from here. Live images
  keep flowing; the freeze is on configuration, not on content.
- Decide from five preview days whether the ring stays on.
- Merge the kiosk runbook PR (it carries `fix/kiosk-reload-verification`, which ran end to end on the Pi 2026-09-04). Procedure: `docs/ops/pushing-an-update-to-the-glass.md`.

### Thu Sep 11 — rehearsal
- Run the kiosk exactly as it will run. Run `scripts/pi/kiosk-doctor.sh` on the Pi.
- Gate check hourly from the afternoon.

### Fri Sep 12 — show
- Evening PDT is 02:00–05:00Z on Sep 13. The UTC day resets at 17:00 PDT, so
  any daily quota is at its freshest during the show.
- Gate check hourly. On HOLD: flag off, instant. Retention keeps every camera
  live for twenty minutes past its last sighting, and holds the whole pool
  through an outage.
- Nothing else changes today.

## The work

### Pool retention — built, on feat/pool-retention, PR pending
- [x] Task 1 · the two constants (20-minute grace, half-failed hold ratio)
- [x] Task 2 · grace in deactivation, both branches
- [x] Task 3 · sweep-hold assessment (no boxes / nothing found / half failed)
- [x] Task 4 · wire into the tick; `retention` in the response — **ship gate**
- [x] Task 5 · count held ticks (migration, sweep stats, digest summary)
- [x] Task 6 · digest clause

### Preview at a proven call rate — not started
- [ ] Kiosk tick to two minutes (one-constant PR plus the lock TTL and a pin test)
- [ ] `cost_events` row, then flip the flag on; verify two rings next tick
- [ ] Five clean preview days (digest each morning, gate check each day)

### Gate checks — ready
- [x] First full day over 22,300 read CLEAR (Sep 3, 20:52Z)
- [ ] First day with the ring on read CLEAR (the doubled rate is unprobed until then)
- [ ] Hourly reads on the eleventh and twelfth
- [x] Gate check rebuilt into `scripts/windy-gate-check.mjs` after the scratchpad copy was lost

### Open risks on the glass — confirm
- [x] `fix/kiosk-reload-verification`: ran on the Pi 2026-09-04 (`--sync --reload`, 2 of 2 windows); lands with the kiosk runbook PR
- [ ] Mosaic v3 on the actual panels: #120 and #122 merged; confirm the band scale on the glass, not the studio
- [ ] Kiosk Pi reachable and rendering `main` (Deploy copies settings rows only; the Pi renders `main`)
- [ ] Two known limits of retention (final review 2026-09-03): the hold is
      global while deactivation is per-feed, so a one-feed Windy failure under
      the 50% ratio is bounded only by the 20-minute grace; and a held tick
      also retains a stale Pi camera until the next healthy tick. If a panel
      drains while `retention.held` is false, read `rings[].failedByStatus`
      in the tick log before suspecting the pool.

## The envelope

No daily cap observed at 27,600 Windy calls per UTC day on this key. The
22,300 figure was a projection of a two-minute cron cadence in the
camera-refresh cost spec, never a measured limit. Windy documents no quota and
no status code for one, but sells an unrestricted professional tier, so a
free-tier cap is still possible. A monthly cap cannot be excluded before
October. The doubled rate of the forced ring has not been probed, which is why
the preview slows the kiosk first.

## The gate check

Read-only: database, Vercel logs, six Windy calls. Prints a VERDICT line.
HOLD on any 429 or 403, a non-OK probe, or land boxes returning empty. CLEAN
only once the day has crossed the figure.

Run from the repo root:

```bash
node scripts/windy-gate-check.mjs
```

What it does, so it can be rebuilt if the scratchpad is gone:
1. `daily_sunset_stats` for today: base + escalation boxes vs 22,300; `runtime_flags.sweep_force_day_ring`.
2. `vercel logs --environment production --no-branch --since 5h --limit 500 --query "API error" --json`, dedupe by request id, histogram the status codes.
3. The same without `--query`, `--since 1h`: sweeps running, boxes attempted, cameras found.
4. Six clusters calls at radius 11: Alps, central Europe, US northeast, Japan, mid-Pacific, Southern Ocean. Land boxes at zero with ocean at zero is the 200-empty quota shape.
