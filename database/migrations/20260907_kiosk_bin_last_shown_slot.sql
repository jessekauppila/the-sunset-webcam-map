-- Solo kiosk: remember WHICH DRAW a frame was last shown on, not only when.
-- (dwell-budget spec docs/superpowers/specs/2026-09-06-solo2-dwell-budget-design.md §6, §6.1, §6.1.1)
--
-- The `rest` dial is counted in draws. Today the engine recovers a draw
-- number by dividing `last_shown_at` by the dwell length, which works only
-- because every dwell is exactly `dwellS` seconds. Once a dwell is a budget
-- the frames share, that division has no inverse: from a timestamp you
-- cannot tell which draw it was, because the draws in between were not all
-- the same length.
--
-- So rest changes currency. This column is what it is measured in.
--
-- BOTH CURRENCIES COEXIST. `last_shown_at` is NOT replaced and must not be:
-- a slot number has no position in time once the grid is gone, so the
-- timestamp cannot be reconstructed from it. The replay's pre-log fallback
-- compares a row's timestamps against a window start in wall-clock ms, and
-- the timestamp is what the studio and the tape show a human.
--
-- The value here is the SAME counter as `kiosk_draws.slot`, written in the
-- same operation by store.commitAdvance. Two counters that happen to agree
-- would let historical replay misread rest silently.
--
-- Forward-only, idempotent. APPLY BEFORE MERGING the code that reads it:
-- commitAdvance writes this column in an UPDATE that swallows nothing, but a
-- missing column would fail the advance and stall the glass.
--   node scripts/apply-migration.mjs database/migrations/20260907_kiosk_bin_last_shown_slot.sql
--   node scripts/apply-migration.mjs database/migrations/20260907_kiosk_bin_last_shown_slot.sql --apply

ALTER TABLE kiosk_bin_entries ADD COLUMN IF NOT EXISTS last_shown_slot BIGINT;

-- Backfill from the draw log rather than by dividing a timestamp by a dial.
-- kiosk_draws.shown_snapshot_ids records every frame each draw put on glass,
-- so this is the authoritative answer and needs no knowledge of what dwellS
-- was at the time. Bin entries expire at 24 h and the draw log is pruned at
-- 7 days, so every live entry that has ever been shown is covered.
--
-- Rows the log cannot explain keep NULL, which the engine reads as
-- "never shown" — the same as a frame that has genuinely never been drawn.
UPDATE kiosk_bin_entries e
SET last_shown_slot = d.slot
FROM (
  SELECT feed, unnest(shown_snapshot_ids) AS snapshot_id, max(slot) AS slot
  FROM kiosk_draws
  WHERE shown_snapshot_ids IS NOT NULL
  GROUP BY feed, unnest(shown_snapshot_ids)
) d
WHERE e.feed = d.feed
  AND e.snapshot_id = d.snapshot_id
  AND e.last_shown_at IS NOT NULL
  AND e.last_shown_slot IS NULL;

CREATE INDEX IF NOT EXISTS kiosk_bin_entries_last_shown_slot_idx
  ON kiosk_bin_entries (feed, last_shown_slot) WHERE removed_at IS NULL;
