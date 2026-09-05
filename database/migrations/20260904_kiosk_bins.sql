-- Solo kiosk bins (spec: docs/superpowers/specs/2026-09-04-solo-kiosk-design.md §5).
--
-- kiosk_bin_entries: one row per (feed, archived frame) waiting to be shown on
-- the solo kiosk, or shown and waiting to be shown again. Written by the cron
-- (admission, zone removal) and by POST /api/kiosk/solo/advance (tally).
-- Removed rows stay for 48 h so the studio can show what left and why.
--
-- kiosk_screen_state: two rows, what each screen is drawing right now and the
-- schedule slot it was drawn for, so a second advance in the same slot is a
-- no-op.
--
-- Forward-only, idempotent. Apply manually via:
--   node scripts/apply-migration.mjs database/migrations/20260904_kiosk_bins.sql
--   node scripts/apply-migration.mjs database/migrations/20260904_kiosk_bins.sql --apply

CREATE TABLE IF NOT EXISTS kiosk_bin_entries (
  id                 BIGSERIAL PRIMARY KEY,
  feed               TEXT NOT NULL CHECK (feed IN ('sunrise', 'sunset')),
  bin                TEXT NOT NULL CHECK (bin IN ('sunset', 'non_sunset')),
  snapshot_id        BIGINT NOT NULL REFERENCES webcam_snapshots(id) ON DELETE CASCADE,
  webcam_id          INTEGER NOT NULL REFERENCES webcams(id) ON DELETE CASCADE,
  quality            REAL,
  detection          REAL NOT NULL,
  is_new             BOOLEAN NOT NULL DEFAULT false,
  tally              INTEGER NOT NULL DEFAULT 0,
  entered_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  first_shown_at     TIMESTAMPTZ,
  last_shown_at      TIMESTAMPTZ,
  out_of_zone_polls  INTEGER NOT NULL DEFAULT 0,
  removed_at         TIMESTAMPTZ,
  removed_reason     TEXT CHECK (removed_reason IN ('left_zone', 'expired', 'manual')),
  UNIQUE (feed, snapshot_id)
);

CREATE INDEX IF NOT EXISTS kiosk_bin_entries_active_idx
  ON kiosk_bin_entries (feed, bin) WHERE removed_at IS NULL;

CREATE INDEX IF NOT EXISTS kiosk_bin_entries_entered_idx
  ON kiosk_bin_entries (entered_at);

CREATE TABLE IF NOT EXISTS kiosk_screen_state (
  feed                 TEXT PRIMARY KEY CHECK (feed IN ('sunrise', 'sunset')),
  current_snapshot_id  BIGINT REFERENCES webcam_snapshots(id) ON DELETE SET NULL,
  shown_since          TIMESTAMPTZ,
  slot                 BIGINT,
  sunset_streak        INTEGER NOT NULL DEFAULT 0,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE webcam_snapshots
  DROP CONSTRAINT IF EXISTS webcam_snapshots_intake_reason_check;

ALTER TABLE webcam_snapshots
  ADD CONSTRAINT webcam_snapshots_intake_reason_check
  CHECK (intake_reason IN (
    'disagreement', 'high_rated', 'trickle', 'all_rated', 'scene_capture',
    'operator_label', 'kiosk_bin'
  ));
