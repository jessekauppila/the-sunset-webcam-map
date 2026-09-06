-- Solo kiosk: one row per draw per screen, the record behind the studio's
-- tape (stages-and-tape spec §4). Written by store.commitAdvance right after
-- the screen-state upsert succeeds, best-effort; read by GET
-- /api/kiosk/solo/state for the last 24 draws, and in windows by the replay
-- (2026-09-06-solo-replay-design.md); pruned by binAdmission.maintainBins
-- after 30 days. A 20 s dwell allows at most 4.3k rows a day per screen, and
-- measured on 2026-09-06 about 2.4k land, since a slot the glass never
-- advanced through logs nothing. Both screens over 30 days is roughly 145k
-- rows, under 30 MB with indexes. (Until 2026-09-06 this read "8.6k rows a
-- day per screen", which was the two-screen total mislabelled.)
--
-- Forward-only, idempotent. The writer and the reader both degrade to
-- nothing when the table is missing, so the glass never depends on it, but
-- APPLY BEFORE MERGING the code: a swallowed insert loses the tape silently.
--   node scripts/apply-migration.mjs database/migrations/20260906_kiosk_draws.sql
--   node scripts/apply-migration.mjs database/migrations/20260906_kiosk_draws.sql --apply

CREATE TABLE IF NOT EXISTS kiosk_draws (
  feed         TEXT        NOT NULL CHECK (feed IN ('sunrise', 'sunset')),
  slot         BIGINT      NOT NULL,
  snapshot_id  BIGINT      NOT NULL,
  shown_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (feed, slot)
);

CREATE INDEX IF NOT EXISTS kiosk_draws_shown_idx ON kiosk_draws (shown_at);
