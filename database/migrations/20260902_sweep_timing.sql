-- Sweep timing: the one cost signal with a unit.
--
-- The sweep telemetry already answers "how many boxes" and "did the frames
-- pass the gate". It cannot answer "what did widening cost", because Windy
-- publishes no price, no rate limit and no quota headers -- a box count is
-- not money. Function wall-clock is, and it is also what actually runs out
-- against TERMINATOR_SWEEP_BUDGET_MS.
--
-- BIGINT: a day of ticks summing tens of seconds each stays far inside
-- INTEGER, but these are additive counters with no natural ceiling and the
-- cost of the wider type here is nil.
--
-- Forward-only, idempotent. Apply via:
--   node scripts/apply-migration.mjs database/migrations/20260902_sweep_timing.sql --apply

ALTER TABLE daily_sunset_stats
  -- Wall clock the base ring spent, summed over today's ticks.
  ADD COLUMN IF NOT EXISTS sweep_base_ms       BIGINT NOT NULL DEFAULT 0,
  -- Wall clock widening added, summed over today's ticks. Read against
  -- sweep_base_ms, this is the widening's marginal compute cost.
  ADD COLUMN IF NOT EXISTS sweep_escalation_ms BIGINT NOT NULL DEFAULT 0;

ALTER TABLE daily_sweep_ring_stats
  ADD COLUMN IF NOT EXISTS elapsed_ms BIGINT NOT NULL DEFAULT 0;
