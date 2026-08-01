# Gallery Cadence + Cost Monitoring — Design

**Date:** 2026-07-31
**Status:** Approved direction (Option 1 presence-driven cadence + infra changes); spec pending Jesse's review.

## Context

July 2026 Neon bill (~$60) diagnosed via the Neon API. Billing flows through the
Vercel-managed Neon org ("Vercel: Jesse Kauppila Development", `org-little-bonus-02505311`),
which holds four projects. Measured July consumption:

| Project | CU | Hours awake | ≈ cost |
|---|---|---|---|
| sunrise-sunset-webcams (`noisy-leaf-96391119`) | 1 fixed | 300 (40% duty) | ~$45 |
| nwac-observations (`rough-resonance-57753560`) | 0.5 fixed | 235 (32% duty) | ~$17 |
| land_buyback, nextjs-dashboard-postgres | — | 0 | $0 |

Root causes: (a) webcam `*/15` cron + 5-min autosuspend ⇒ 96 wakes/day at a fixed
1 CU; (b) Weather_Web_App crons spread across the hour (`:05`, `:10`, `:20`) ⇒ three
separate nwac wake windows/hour; (c) fixed CU floors higher than the workload needs.
Neon's day-granularity consumption-history API is **Scale-plan gated** — we cannot
get historical daily numbers, so trend data must be snapshotted by us going forward.

New requirement: when the piece shows publicly in a gallery, sunset scoring should
run **every minute**; the rest of the time it should be as cheap as possible.

## Part A — Infra changes (applied 2026-07-31, no code in this repo)

1. **Weather_Web_App cron clustering** (committed `2004e2d`, pushed → auto-deploy):
   `batchUploadLastHourRevised` `5,20 * * * *` → `5 * * * *`; `infoExExport`
   `10 * * * *` → `7 * * * *`. Safe because the batch upload covers a trailing
   2-hour window with an idempotent upsert. One wake window/hour instead of three.
2. **nwac endpoint** → fixed **0.25 CU** (was 0.5).
3. **Webcam main endpoint** (`ep-noisy-scene-adiaxjt6`) → **autoscale 0.25–1 CU**
   (was fixed 1). Cron ticks bill at ~0.25 CU; bursts (and gallery mode) can scale.
4. **Delete stale branch** `pre-renumber-2026-06-12` and its dormant 1–9 CU endpoint.

Items 2–4 execute via `neon-cost-changes.sh` (temporary script, deleted after run).
Expected steady-state: webcams ~$12–18/mo, nwac ~$3–5/mo.

## Part B — Gallery mode: presence-driven scoring cadence

**Principle:** cadence follows the display. No manual switch to forget.

- **New route `POST /api/kiosk/tick`.** Runs one scoring tick (same library the
  `update-cameras` cron uses) **iff** a Redis guard allows it:
  `SET kiosk:tick:lock 1 NX PX 55000` — at most one tick per ~minute globally,
  regardless of how many gallery screens are open. If the lock exists, return
  `{ throttled: true }` without touching Neon.
- **Kiosk pages** (`app/kiosk/sunset`, `app/kiosk/sunrise`) poll the route every
  60s **only while visible** (`document.visibilityState === 'visible'`), with
  jitter so multiple screens don't stampede.
- **Freshness expectations (be explicit in docs/UI):** the tick re-scores and
  re-ranks every minute, but each webcam's image only turns over when its
  upstream refreshes — Windy sources typically every 5–15 min; our Pi cams at
  their snapshot cadence. Every-minute polling catches a fresh frame within a
  minute of it existing; it does not make every frame new.
- **Quiet hours + wake-on-interaction:** browsers don't report display power-off
  (Page Visibility covers tab-hidden only), so a blanked kiosk screen would keep
  polling. Therefore: configurable quiet window (default 01:00–08:00 local,
  URL-overridable e.g. `?quiet=off` / `?quiet=23-9`) during which the kiosk
  stops ticking and renders a dim "dozing" state so the pause is visible. Any
  pointer/touch/key event during quiet hours resumes normal polling for 30 min
  (`KIOSK_WAKE_MINUTES`), then dozes again. Saves roughly $0.25–1/day of
  hot-mode cost across an installation.
- **Manual doze, two independent layers** (kiosk dozes if either is active;
  no touch hardware exists, so no on-screen gesture):
  - **Remote (shared):** doze toggle in the owner-gated Ops drawer tab,
    usable from a phone anywhere → sets/clears a `kiosk:doze` flag in Redis
    via owner-gated `POST /api/kiosk/doze`. Kiosks see it on their next poll
    and fade (~2s). While dozing, a kiosk runs no scoring ticks (zero Neon
    wakes) and only checks a cheap Redis-only `GET /api/kiosk/state` once a
    minute to hear the wake command (~2 Redis commands/min).
  - **Local (per device):** the `d` key toggles doze for THAT page only —
    deliberately local-state-only, since kiosk URLs are public and a shared
    write here would let any visitor doze the gallery. The Argon ONE case
    button maps to this: its stock daemon ignores a short single press
    (double-tap=reboot and 3s+=shutdown are untouched; power-on-from-off is
    case hardware and always works), so a Pi-side
    extension catches the short-press pulse and injects `d` into BOTH
    Chromium windows via xdotool — instant, offline-safe, credential-free.
    Pi work lives in the kiosk setup scripts (GALLERY_DISPLAY), not this app.
  `cursor: none` across kiosk pages. Scheduled doze stays
  wake-on-any-interaction; local/remote doze are sticky until toggled back.
  Note: doze saves database cost only — display *power* is device-level
  (Pi DPMS cron / TV timer / smart plug), a natural companion since a dark
  screen collects no wake interactions.
- **Baseline unchanged:** the `*/15` Vercel cron remains the floor for the public
  site. The cron route also sets the same Redis lock when it runs so a kiosk poll
  right after a cron tick is a no-op.
- **Bundling gotcha:** the route runs ONNX scoring ⇒ must be added to
  `outputFileTracingIncludes` with a route-PATH key (`/api/kiosk/tick`), and
  verified post-deploy via the smoke endpoint's `latencyMs` (working ONNX =
  100–500 ms; 10–20 ms means baseline fallback). `maxDuration: 60` like the cron.
- **Auth/abuse:** route is unauthenticated (a public kiosk page can't hold a
  secret), but the Redis lock caps worst-case abuse at gallery-mode cost
  (~$1–2/day). Acceptable; revisit with a signed kiosk token only if abused.
- **Redis budget:** ≤2 commands/poll × 1440/day worst case ≈ 90k/mo — inside the
  500k quota, and only while a kiosk is actually open.
- **Cost when hot:** DB awake continuously at ~0.25–1 CU ≈ **$0.90–3.50 per
  24h gallery day**; zero extra when no screen is showing.

## Part C — Cost monitoring (Ops panel + snapshots + change log)

### C1. Ops panel v1 — an owner-only tab in the existing drawer (revised 2026-07-31)
Per Jesse's review: no standalone `/ops` page. Ops is a new tab in the
`HomeClient.tsx` drawer, rendered only when the signed-in user is owner (same
conditional-tab pattern as Hard Examples). Data via an owner-gated
`GET /api/admin/ops-stats` route (mirrors existing admin routes) returning the
last ~14 rows of `daily_sunset_stats`.
Signals: fallback %, cache-hit %, webcams_scored, score p50/p90, source_breakdown,
model_version. Inline-SVG sparklines, no new deps.
Components: `app/api/admin/ops-stats/route.ts` (gate + query),
`components/Ops/OpsTab.tsx` (fetch + presentational).

### C2. Provider usage snapshots (replaces the Scale-gated history API)
- Table `provider_usage_daily(day date, project_id text, compute_time_s bigint,
  active_time_s bigint, data_transfer_b bigint, storage_b bigint,
  captured_at timestamptz, PRIMARY KEY (day, project_id))`.
- Once per UTC day (first `update-cameras` tick after midnight; guard = "row for
  today exists?"), call Neon `GET /projects/{id}` for all four org projects and
  upsert the current-period counters. Since counters are month-to-date, daily
  deltas are derived at read time (`value - lag(value)`, reset at month start).
- Env: `NEON_COST_API` added to Vercel project env (server-only). Failure to
  fetch logs a warning and skips — never fails the scoring tick.
- The Ops panel renders compute-hours/day per project from this table.
- Upstash daily command counts: **out of scope** for this build (quota email +
  console cover it); the table schema doesn't preclude adding a provider column later.

### C3. Cost change log
- Table `cost_events(id serial, occurred_on date, sha text, description text)`,
  seeded with: 2026-06-04 cron `*/1→*/15` + Redis-dedup move; 2026-07-31 Part A
  items. Appended manually (SQL or a tiny owner-gated POST) when we ship
  cost-relevant changes.
- Ops panel overlays these as markers on the compute-hours chart — "changed X
  here, curve did Y" is the change-vs-price tracking Jesse asked for.

## Error handling
- Kiosk tick: any scoring error returns 500 but the Redis lock still expires
  naturally (PX), so a bad tick can't wedge the cadence.
- Snapshot fetch: per-project try/catch; partial rows are fine (PK upsert).
- Ops panel: render "no data yet" states; tolerate null-score rows
  (e.g. the 2026-06-03 row).

## Testing (TDD)
- Lock semantics: tick runs when lock acquired, throttles when not, cron sets lock.
- Snapshot: guard skips when today's row exists; upsert shape; delta derivation
  incl. month rollover.
- opsStats: query shape + % math with null rows; StatsPanel render test.
- Kiosk polling hook: fires only when visible, stops on hide; quiet-hours
  suppression incl. windows crossing midnight; interaction wake resumes for
  KIOSK_WAKE_MINUTES then re-dozes.

## Build order
1. C1 ops panel (standalone value, no external deps)
2. C2 snapshots + panel chart (needs `NEON_COST_API` in Vercel env)
3. C3 cost_events + markers
4. Part B gallery tick + kiosk polling (before the next public showing)

## Out of scope
Vercel/Upstash usage APIs; alert automation (console alerts are set manually per
`reference-cost-monitoring-consoles`); any change to the `*/15` baseline cadence.
