-- Adaptive terminator widening: persist the sweep telemetry.
--
-- The sweep already reports rings, boxes and per-ring discovery in the cron's
-- JSON response and one log line. Neither survives the tick, so the two
-- questions the feature exists to answer -- "how often did a feed fall under
-- the camera floor" and "what did the extra rings cost in API calls" -- were
-- unanswerable a day later. This is the migration the widening design
-- deferred, now with a concrete consumer: the daily digest email.
--
-- Split deliberately in two:
--   1. daily_sunset_stats gains TICK-level counters. One tick contributes at
--      most 1 to each, so every column reads as "N of today's ticks".
--   2. daily_sweep_ring_stats is RING-level, at most 3 rows a day (offsets
--      0, +15.75, -15.75). Per-ring gate-pass counts live here because the
--      spec's golden-hour risk is exactly a per-ring rate comparison:
--      do frames first seen on the +15.75 ring pass the detection gate at
--      anything like the base ring's rate, or does widening only add tiles
--      the panel will floor?
--
-- Forward-only, idempotent. Apply manually via:
--   psql "$DATABASE_URL" -f database/migrations/20260902_sweep_telemetry.sql

ALTER TABLE daily_sunset_stats
  -- Ticks that ran a sweep at all. The denominator for every column below.
  ADD COLUMN IF NOT EXISTS sweep_ticks                  INTEGER NOT NULL DEFAULT 0,
  -- Ticks that swept at least one escalation ring.
  ADD COLUMN IF NOT EXISTS sweep_escalated_ticks        INTEGER NOT NULL DEFAULT 0,
  -- Ticks that wanted another ring but had spent TERMINATOR_SWEEP_BUDGET_MS.
  ADD COLUMN IF NOT EXISTS sweep_budget_exhausted_ticks INTEGER NOT NULL DEFAULT 0,
  -- Ticks where the feed was under TERMINATOR_CAMERA_FLOOR after the base
  -- ring, i.e. widening was triggered for it.
  ADD COLUMN IF NOT EXISTS sweep_sunrise_thin_ticks     INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sweep_sunset_thin_ticks      INTEGER NOT NULL DEFAULT 0,
  -- Ticks where the feed was STILL under the floor after every ring was
  -- swept. thin > short means widening recovered the feed; thin == short
  -- means it did not, and that is the case worth reading the ring rates for.
  ADD COLUMN IF NOT EXISTS sweep_sunrise_short_ticks    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sweep_sunset_short_ticks     INTEGER NOT NULL DEFAULT 0,
  -- Windy boxes sent, split by what caused them. base is the ~3,000/day
  -- baseline the widening's cost has to be read against; escalation is the
  -- bill this feature adds.
  ADD COLUMN IF NOT EXISTS sweep_base_boxes             INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sweep_escalation_boxes       INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS daily_sweep_ring_stats (
  date                 DATE NOT NULL,                 -- UTC date, matches daily_sunset_stats
  offset_deg           NUMERIC(6,2) NOT NULL,         -- 0, 15.75, -15.75
  rings_swept          INTEGER NOT NULL DEFAULT 0,    -- ticks this ring ran
  boxes_attempted      INTEGER NOT NULL DEFAULT 0,
  -- Empty boxes conflate "no cameras there" with "the call failed", because
  -- fetchWebcamsFor swallows non-OK responses. Rising empty against flat
  -- new_webcams is the signature of an undiscovered Windy quota ceiling --
  -- the second open risk in the widening spec.
  boxes_empty          INTEGER NOT NULL DEFAULT 0,
  -- Cameras this ring was the first in its tick to see.
  new_webcams          INTEGER NOT NULL DEFAULT 0,
  -- Of those cameras, frames that actually reached the ONNX head this tick.
  -- Cache hits are excluded: no verdict was produced for them.
  frames_scored        INTEGER NOT NULL DEFAULT 0,
  frames_gate_passed   INTEGER NOT NULL DEFAULT 0,    -- binary head said sunset
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (date, offset_deg)
);
