-- Solo kiosk: close the deploy-window gap in last_shown_slot.
-- (dwell-budget spec §6.1.2)
--
-- RUN THIS AFTER the code that writes last_shown_slot is LIVE, not before.
-- That ordering is the whole point of the file.
--
-- Between the first migration applying and the new code deploying, production
-- runs the old commitAdvance: it writes last_shown_at and knows nothing about
-- last_shown_slot. Every frame drawn in that window is left with a timestamp
-- and a NULL draw number, at roughly three a minute across both feeds.
--
-- What that actually costs, measured against the code rather than assumed:
-- isResting reads only last_shown_slot and treats NULL as never shown, so
-- rest is WAIVED for those rows. It is not a queue jump. Rule 3's first key
-- is compareRecency, which reads last_shown_at, and the old code keeps that
-- accurate — so an affected frame still sorts by how recently it was shown
-- and lands at the BACK of its bin, which is most of what rest would have
-- done. The gap is worth closing; it is not the least-recently-shown
-- regression of 2026-09-05 returning.
--
-- Once the new code is live nothing new is orphaned, and the draw log covers
-- the whole window, so running this as the last step of the deploy closes it
-- to zero. Safe to run repeatedly: it only ever fills NULLs.
--
--   node scripts/apply-migration.mjs database/migrations/20260907_kiosk_bin_last_shown_slot_refill.sql
--   node scripts/apply-migration.mjs database/migrations/20260907_kiosk_bin_last_shown_slot_refill.sql --apply

-- Reads BOTH shapes of draw row, which the first backfill did not.
-- shown_snapshot_ids only exists from 2026-09-06 23:44Z; 3,555 earlier rows
-- have it NULL and were invisible to the array-only version. Falling back to
-- the drawn frame's snapshot_id rescues those, the way listDrawsBetween
-- already reads the log. A frame shown only inside a camera run appears in
-- the array alone, so both sources are needed, not either one.
UPDATE kiosk_bin_entries e
SET last_shown_slot = d.slot
FROM (
  SELECT feed, snapshot_id, max(slot) AS slot
  FROM (
    SELECT feed, unnest(shown_snapshot_ids) AS snapshot_id, slot
    FROM kiosk_draws
    WHERE shown_snapshot_ids IS NOT NULL
    UNION ALL
    SELECT feed, snapshot_id, slot
    FROM kiosk_draws
  ) all_shown
  GROUP BY feed, snapshot_id
) d
WHERE e.feed = d.feed
  AND e.snapshot_id = d.snapshot_id
  AND e.last_shown_at IS NOT NULL
  AND e.last_shown_slot IS NULL;
