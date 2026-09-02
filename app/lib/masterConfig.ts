// Master configuration constants - single source of truth for runtime tuning.
// This file can be imported by both server and client code.
//
// Alternative locations considered:
// - app/config/terminator.ts (more explicit config directory)
// - app/components/Map/lib/constants.ts (co-located with map code)
// - app/lib/types.ts (with type definitions, but types.ts should stay type-only)
// Current location (app/lib/) is standard for shared utilities.

// ---------------------------------------------------------------------------
// Terminator geometry + map search
// ---------------------------------------------------------------------------
export const TERMINATOR_PRECISION_DEG = 12; // Terminator ring precision in degrees
// Higher means less points
// 15 doesn't work
// 14 is the highest that works.
// 13 works
// 11 works

// Base sun altitude used for the terminator ring radius: radius = 90 - sunAltitude
// Keep default at 0 to match current terminator behavior (sun at horizon).
export const TERMINATOR_SUN_ALTITUDE_DEG = -13;
// was 0 and one of the lines was on the exact terminator line
// -10 works when precision is 14 and radius is 11
// -8 showed too much day time

export const SEARCH_RADIUS_DEG = 9; // Search radius per API call in degrees
// 12 doesn't work
// 11 is the widest that works
// 10 works
// 6 works

// West-only offset ring for parallel search/visualization, in degrees.
// 0 = main ring, positive values shift the ring westward from the subsolar geometry.
export const TERMINATOR_RING_OFFSETS_DEG = [0]; //was   0,1.75 * SEARCH_RADIUS_DEG,//was 1,.75

// How recent a custom camera's most-recent snapshot must be for the camera
// to qualify for terminator visibility. Mirrors Windy's "API returned it
// this tick" semantics — custom cams without a fresh capture are
// effectively unobservable and should fall off the map.
// Default 90 min: covers the protocol's 75-min active window + upload buffer.
export const CUSTOM_CAM_FRESHNESS_WINDOW_MINUTES = 90;

// Circle rendering precision: how smooth the circle polygon is (number of points)
// Using SEARCH_RADIUS_DEG ensures the circle detail matches the search area size
export const CIRCLE_RENDERING_PRECISION_DEG = SEARCH_RADIUS_DEG;

// 14, -10, 11 provides the widest coverage
// 12, -8, 9 provides less coverage

// ---------------------------------------------------------------------------
// AI scoring + snapshot capture behavior
// ---------------------------------------------------------------------------
// v4 training data export date. Webcam frames captured after this were NOT in
// v4 training (highest-value new labels); before is the trained-era archive.
// Approximate: exact membership would require the v4 manifest (deferred).
export const V4_TRAINING_CUTOFF = '2026-05-13';
// Kill-switch for AUTOMATIC snapshot capture (cron jobs, manual capture
// endpoint). Set to false to stop bulk saving images to Firebase (saves
// storage costs). AI scoring still runs; only the image-download +
// Firebase-upload step is skipped.
export const SNAPSHOTS_ENABLED = false;

// Kill-switch for USER-TRIGGERED snapshot capture (the rating flow at
// /api/snapshots/capture-and-rate). When true, clicking a rating star
// captures the current webcam image to Firebase alongside the rating —
// the rating action makes the image valuable enough to keep regardless
// of the bulk-capture flag above.
export const SNAPSHOTS_ENABLED_ON_RATING = true;

// Binary classifier threshold used when mapping probability/raw score to
// positive vs negative decisions. 0.55 was derived 2026-08-30 from the
// 200-frame operator-labeled random sample (precision 0.891 / recall 0.774
// for the v5 is_sunset head; the F1 plateau spans 0.45–0.70, so the choice
// is not fragile). The old 0.5 was tuned for v4's quality-threshold head
// under the pre-fix preprocessing — both of those are gone.
export const AI_BINARY_DECISION_THRESHOLD = 0.55;

// Minimum raw score required to treat a webcam as "capture-worthy" for
// snapshot persistence during cron runs.
export const AI_SNAPSHOT_MIN_RAW_SCORE_THRESHOLD = 0.8;

// Legacy rating-space threshold (0-5 scale). Keep this for places that still
// reason in rating units while we transition to raw-score thresholds.
export const AI_SNAPSHOT_MIN_RATING_THRESHOLD = 4.0;
export const AI_SNAPSHOT_RECENT_WINDOW_MINUTES = 30;

// ---------------------------------------------------------------------------
// Windy snapshot capture beyond the disagreement queue
// ---------------------------------------------------------------------------
// The cron normally only persists a webcam_snapshots row for Windy frames when
// the two model heads disagree (Hard Examples queue). These toggles widen that
// so the best-of archive + the Best Sunsets leaderboard get real data. Both
// default OFF — each adds a Firebase upload + Neon insert per matching frame
// (cost), so opt in deliberately (cf. the reduce-db-cost work).
//
//   SAVE_HIGH_RATED_SNAPSHOTS — persist frames scoring >= AI_SNAPSHOT_MIN_RATING_THRESHOLD
//                               (cheap: only the good ones; feeds "best sunsets").
//   SAVE_ALL_RATED_SNAPSHOTS  — persist EVERY scored frame (expensive: every tick,
//                               every active webcam — the "bring in everything" switch).
export const SAVE_HIGH_RATED_SNAPSHOTS = true;
export const SAVE_ALL_RATED_SNAPSHOTS = false;

// SAVE_RANDOM_TRICKLE_RATE — the control arm for the two toggles above.
//
// Every other reason a frame enters the archive is model-gated: the heads
// disagree, or the incumbent model scored it highly. That is a feedback loop —
// the archive drifts toward what the incumbent already understands, so each
// generation trains on a distribution its predecessor chose. A uniformly
// sampled trickle, saved regardless of score, keeps an unbiased stream coming
// in as a control against that drift.
// (Roadmap: docs/superpowers/plans/2026-08-30-quality-ceiling-and-labeling-roadmap.md,
// "Same-camera-pool skew" + side item 1.)
//
// 0.02 = 1 in 50. At ~4k scored frames/day that is ~80 extra rows/day — the
// cost is a rounding error against the $0.44/day measured in the ops work, and
// it is deliberately small because an unbiased sample only has to accumulate,
// not keep up. Set to 0 to disable the arm entirely.
//
// Rows are stamped intake_reason='trickle' so the arm stays separable from the
// gated archive; an unlabelable control arm is not a control arm.
export const SAVE_RANDOM_TRICKLE_RATE = 0.02;

// ---------------------------------------------------------------------------
// Hard-example mining — model-disagreement thresholds
// ---------------------------------------------------------------------------
// When the binary classifier and regression head point in opposite directions,
// the cron flags the snapshot for the Hard Examples drawer tab. These
// thresholds (on the 1-5 aiRating scale) govern when the disagreement is
// extreme enough to flag. Tightening them yields a smaller queue; loosening
// yields more triage signal. See ml/OPERATING_GUIDE.md "Retention rules".
export const SUNSET_DISAGREEMENT_HIGH = 3.0;
export const SUNSET_DISAGREEMENT_LOW = 2.0;

// ---------------------------------------------------------------------------
// Model-vs-Claude disagreement (Claude trusted as the reference)
// ---------------------------------------------------------------------------
// The highest-value Hard Examples signal: where the v4 regression head and
// Claude's verdict diverge. Compared against the regression rating (1-5 scale)
// and Claude's NORMALIZED [0,1] llm_quality — NOT the raw 1-5 rating. Per the
// normalized-vs-raw-thresholds learning, 0.75 normalized == "rating >= 4"; a
// raw 4.0 here would be a bug.
//
// CLAUDE_HIGH is also the deadband mechanism: it sits ABOVE the borderline-
// quality band (~0.35-0.55, the ~4.7k frames Claude calls sunsets but rates
// mediocre), so a "miss" only fires when Claude is confident the frame is a
// genuinely good sunset. That keeps borderline-vs-borderline noise out of the
// queue (plan KTD2 deadband).
export const MODEL_VS_CLAUDE_MODEL_LOW = 2.0; // 1-5: model thinks it's poor
export const MODEL_VS_CLAUDE_MODEL_HIGH = 3.5; // 1-5: model thinks it's good
export const MODEL_VS_CLAUDE_CLAUDE_HIGH = 0.6; // [0,1]: Claude confident it's a good sunset

// Max snapshots the disagreement-recompute cron re-derives per run (plan U3b).
// Pure SQL recompute (no image download / ONNX), so this can be generous — it
// runs on its own schedule, isolated from the live-scoring tick budget.
export const DISAGREEMENT_RECOMPUTE_LIMIT = 500;

// Widens the per-tick cron backfill from custom-cam-only to the FULL webcam
// archive (~33k historical Windy frames). Default false: the cron keeps doing
// only the cheap custom-cam top-up it always has. The one-time 33k drain runs
// via the standalone runner (scripts/backfill-archive-scores.ts), which scores
// all sources regardless of this flag. Flip true to let the cron also chip at
// the archive between runner passes / for steady-state once drained.
export const ARCHIVE_BACKFILL_ENABLED = false;

// ---------------------------------------------------------------------------
// Snapshot cleanup gate
// ---------------------------------------------------------------------------
// Hard kill-switch for /api/snapshots/cleanup. Default OFF — even though no
// cron currently schedules cleanup (vercel.json only schedules
// /api/cron/update-cameras), this flag guarantees that a future schedule or
// a manual POST cannot delete snapshots without an explicit code change.
//
// Even when CLEANUP_ENABLED = true, the endpoint still excludes:
//   1. Snapshots with any webcam_snapshot_ratings row (rating OR verdict)
//   2. Snapshots flagged by the cron as model_disagreement_kind != NULL
//   3. (Future) is_window_winner = true once Phase 2 winner-selection ships
//
// History: this flag was added on 2026-06-02 after the audit discovered the
// cleanup endpoint would delete star-rated snapshots indiscriminately. We
// had ~33k snapshots in the archive at the time; nothing had been auto-
// deleted because no cron was scheduled. Flipping CLEANUP_ENABLED = true
// does NOT make cleanup start happening — it only stops returning early.
export const CLEANUP_ENABLED = false;

// ---------------------------------------------------------------------------
// Snapshot queue progress semantics
// ---------------------------------------------------------------------------
// "Rated" progress in the Unrated Queue uses a GLOBAL definition:
// rated_count = COUNT(DISTINCT snapshot_id) in webcam_snapshot_ratings.
// This is not session-specific and reflects archive-wide ranking coverage.
export const SNAPSHOT_QUEUE_PROGRESS_RATED_SCOPE =
  'global_distinct_snapshot';

// "Unrated queue" membership remains SESSION-specific:
// snapshots where the current user_session_id has no rating row.
// This lets queue assignment stay personal while progress stays global.
export const SNAPSHOT_QUEUE_UNRATED_SCOPE = 'session_specific';

// ONNX creation/export workflow lives in `ml/README.md` ("Export ONNX and verify locally").
// Defaults are the SHIPPING PAIR (decided 2026-08-30 on the operator-labeled
// random sample — see docs/superpowers/plans/2026-08-29-two-scale-model-STATE.md):
//   detection  = v5_binary_gold        (is_sunset head, F1 0.816 vs operator)
//   quality    = v5_quality_sunsets_only retrain (Pearson 0.820 vs operator)
// They compose: detection gates whether a frame counts as a sunset; quality
// (trained ONLY on operator-confirmed sunsets) sizes/ranks it. The quality
// score of a frame the gate rejects is extrapolation — display code must
// check binaryIsSunset before treating aiRating as a sunset quality.
// AI_ONNX_*_MODEL_PATH + AI_*_MODEL_VERSION env vars still override, but the
// preferred deploy is to keep prod env UNSET and let these defaults pin the
// pair (next.config.ts outputFileTracingIncludes must list the same dirs).
export const AI_MODEL_VERSION_DEFAULT = 'baseline-v1';
export const AI_ONNX_MODEL_PATH_DEFAULT =
  'ml/artifacts/models/model.onnx';
export const AI_BINARY_MODEL_VERSION_DEFAULT =
  '20260829_062437_v5_binary_gold';
export const AI_REGRESSION_MODEL_VERSION_DEFAULT =
  '20260830_190519_v5_quality_llm_backbone_finetune';
export const AI_ONNX_BINARY_MODEL_PATH_DEFAULT =
  'ml/artifacts/models/binary_resnet18/20260829_062437_v5_binary_gold/model.onnx';
export const AI_ONNX_REGRESSION_MODEL_PATH_DEFAULT =
  'ml/artifacts/models/regression_resnet18/20260830_190519_v5_quality_llm_backbone_finetune/model.onnx';

// ---------------------------------------------------------------------------
// Windy API fetch behavior
// ---------------------------------------------------------------------------
export const WINDY_FETCH_BATCH_SIZE = 5;
export const WINDY_FETCH_DELAY_BETWEEN_BATCHES_MS = 1000;
export const WINDY_FETCH_STAGGER_WITHIN_BATCH_MS = 200;

// ---------------------------------------------------------------------------
// YouTube cron fetch behavior
// ---------------------------------------------------------------------------
export const YOUTUBE_FETCH_BATCH_SIZE = 5;
export const YOUTUBE_FETCH_DELAY_BETWEEN_BATCHES_MS = 800;

// ---------------------------------------------------------------------------
// Ops tab (owner-only cost/health panel in the drawer)
// ---------------------------------------------------------------------------
// How many daily_sunset_stats rows the Ops tab shows. Two weeks reads well as
// sparklines; the query is one cheap indexed scan on the PK.
export const OPS_STATS_DAYS = 14;

// Rough Neon usage rate for the digest email's dollar estimate. The invoice
// of record is Vercel; this exists so the email can say "~$14 so far" without
// an extra API. Update if Neon/Vercel repricing makes it drift.
export const NEON_COST_PER_CU_HOUR = 0.14;
// Days of history in the daily digest email's inline bar chart.
export const DIGEST_LOOKBACK_DAYS = 14;
// How far back the Ops usage chart reaches. 60 days spans two billing cycles
// so month-rollover deltas are visible and testable.
export const PROVIDER_USAGE_LOOKBACK_DAYS = 60;

// Neon projects in the Vercel-managed org whose month-to-date usage counters
// the cron snapshots daily into provider_usage_daily. Project ids are not
// secrets (the API key NEON_COST_API is, and lives only in env).
export const NEON_USAGE_PROJECT_IDS = [
  'noisy-leaf-96391119', // sunrise-sunset-webcams (this app)
  'rough-resonance-57753560', // nwac-observations (Weather_Web_App)
  'holy-shadow-28821259', // land_buyback (idle)
  'small-tree-05551811', // nextjs-dashboard-postgres (idle)
];

// ---------------------------------------------------------------------------
// Kiosk gallery mode (presence-driven scoring cadence + doze)
// ---------------------------------------------------------------------------
// Tick lock TTL: slightly under the 60s poll interval so the next poll can
// re-acquire even if clocks drift. One global lock = at most ~1 tick/minute
// regardless of how many kiosk screens are open.
export const KIOSK_TICK_LOCK_TTL_MS = 55_000;
// Quiet hours default: gallery-local hours during which the kiosk dozes
// (no scoring ticks). Override per install with ?quiet=off or ?quiet=23-9.
export const KIOSK_QUIET_DEFAULT = '1-8';
// How long one interaction keeps a quiet-hours kiosk awake.
export const KIOSK_WAKE_MINUTES = 30;
// Poll cadences (tick + doze-state check). Two cheap requests per minute.
export const KIOSK_TICK_INTERVAL_MS = 60_000;

// ---------------------------------------------------------------------------
// Geographic mosaic composition tunables live with their version:
// app/components/mosaic/<version>/config.ts. Each mosaic version owns its
// own constants so tuning one never disturbs another.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Per-camera calibration (tempering prior)
// Spec: docs/superpowers/specs/2026-08-31-per-camera-calibration-design.md
//
// A bounded multiplier on the TILE/QUALITY signal only. It must never move the
// detection verdict — passesGate does not read any of these.
// ---------------------------------------------------------------------------

// Recurrence bar: one bad frame is noise. Same standard that caught three
// non-replicating detection "wins".
export const CALIBRATION_MIN_EVENTS = 3;
export const CALIBRATION_MIN_DAYS = 2;

// Smoothing prior, so a camera with 3 false-shows out of 3 N frames does not
// slam straight to the floor.
export const CALIBRATION_PRIOR_K = 2;

// MAX_TEMPER 0.5 was chosen because it DOMINATES 0.65: identical benefit
// (8 big false-shows fixed) at 60% less harm (10 genuine >=4 frames demoted
// vs 25). Lower to 0.35 to back off; that needs no other change.
export const CALIBRATION_MAX_TEMPER = 0.5;
export const CALIBRATION_MIN_MULTIPLIER = 0.5;

// Decay shapes MAGNITUDE; the window governs ELIGIBILITY. Both are needed:
// with an undecayed recurrence bar a camera could never fully heal.
export const CALIBRATION_HALF_LIFE_DAYS = 90;
export const CALIBRATION_WINDOW_DAYS = 365;
