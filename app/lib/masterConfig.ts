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

// Search radius per Windy API call, in degrees. The query box spans
// 2 x this value, and Windy's clusters endpoint caps the north-south span
// at 22.5 degrees on zoom 4 (and rejects zoom < 4), so 11.25 is a hard
// ceiling. Verified live 2026-09-02; guarded by masterConfig.test.ts.
export const SEARCH_RADIUS_DEG = 11;

// Per-feed camera count below which that feed sweeps an extra ring. Chosen
// against a single observation (4 sunrise, 21 sunset on 2026-09-02); expect
// to tune it once the sweep telemetry has a few days of history.
export const TERMINATOR_CAMERA_FLOOR = 15;

// Extra rings to sweep when a feed is under the floor, tried in this order.
// radius = 90 - (sunAltitude + offset), so POSITIVE MOVES TOWARD DAY: +15.75
// puts the ring near +2.75 degrees solar altitude (golden hour, which the base
// ring at -13 misses entirely), and -15.75 puts it near -28.75 (deep night,
// where the detection gate floors the frames anyway). Day side first.
//
// The magnitude is EMPIRICAL, not derived. Measured 2026-09-02 at
// SEARCH_RADIUS_DEG = 11: a 3-degree offset returned 26-35% cameras the base
// ring had not seen, for a full ring's worth of API calls; 15.75 returned
// 92-100%. Note 15.75 is well under the 22-degree box span, so these rings'
// query boxes DO overlap the base ring's — overlap is not what predicts
// yield here, and no inequality against SEARCH_RADIUS_DEG substitutes for a
// live measurement of a new offset.
export const TERMINATOR_WIDEN_OFFSETS_DEG = [15.75, -15.75] as const;

// The solar-altitude range the terminator sweep actually gathers under the
// CURRENT configuration. This is the one contract between the pool and the
// display: a camera the sweep found must have somewhere on the panel to be,
// and `app/components/mosaic/v3/engine/axis.test.ts` asserts the mosaic's
// default display window covers this range.
//
// "Current configuration", not "every ring that exists". The escalation rings
// in TERMINATOR_WIDEN_OFFSETS_DEG only fire when a feed falls under
// TERMINATOR_CAMERA_FLOOR, so they are NOT counted here, and today the value
// is the base ring alone. Counting rings that rarely sweep would squeeze
// every ordinary night into the middle of the panel for a case that seldom
// fires -- the same reasoning the v2 axis comment already records.
//
// This is what the sweep gathers in the overwhelming common case, NOT a
// ceiling it can never exceed. Escalation is unobserved, not impossible:
// sweep_escalated_ticks was 0 across 2026-09-02 and 2026-09-03, but a feed
// dropping under TERMINATOR_CAMERA_FLOOR would still fire it, and the pool
// would briefly hold cameras out to +13.75. Those clamp to the panel's day
// edge, which is the behaviour the v2 axis comment already argues for.
//
// The pool-coverage lane owns this value and must widen it IN THE SAME COMMIT
// that turns a ring on routinely. That is what makes the axis test a
// tripwire: widening coverage fails it, and the failure is the reminder to
// move axisDayEdgeDeg with it. A value that already describes rings nobody
// sweeps fires the alarm on day one and then means nothing.
export const TERMINATOR_POOL_COVERAGE_DEG = {
  min: TERMINATOR_SUN_ALTITUDE_DEG - SEARCH_RADIUS_DEG,
  max: TERMINATOR_SUN_ALTITUDE_DEG + SEARCH_RADIUS_DEG,
} as const;

// Wall-clock budget for the whole terminator sweep (base ring + any
// escalation rings), in milliseconds. The scoring loop that follows needs
// the remaining tick more than the pool needs extra cameras, so escalation
// rings are the first thing sacrificed on a slow tick. Chosen against a
// single observation (half of the 50s tick deadline, 2026-09-02); expect to
// tune it once the sweep telemetry has a few days of history.
export const TERMINATOR_SWEEP_BUDGET_MS = 25_000;

// In-process deadline for one update-cameras tick, after which the scoring
// loop stops starting batches. Lives here rather than in the route so its
// relationship to TERMINATOR_SWEEP_BUDGET_MS is a guarded invariant instead of
// a comment: the sweep may burn its budget before the escalation loop stops,
// and the scoring loop needs at least as long again. masterConfig.test.ts
// pins TERMINATOR_SWEEP_BUDGET_MS * 2 <= TICK_DEADLINE_MS.
//
// The route's `maxDuration` stays a literal there: Next.js reads it by static
// analysis of the route module and an imported constant is not guaranteed to
// resolve. Raising this means raising that too.
export const TICK_DEADLINE_MS = 50_000;

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

// Documented maximum for the YouTube Data API v3 `locationRadius` search
// parameter. Anything larger is rejected, and the caller swallows a non-OK
// response as an empty result, so breaching this yields silent zeroes rather
// than an error.
//
// This is a DIFFERENT ceiling from Windy's 22.5-degree box-span cap, even
// though the YouTube cron derives its radius from SEARCH_RADIUS_DEG. Widening
// SEARCH_RADIUS_DEG for Windy (9 -> 11 on 2026-09-02) pushed the derived
// YouTube radius from 999 km to 1221 km, past this cap. Keep the two ceilings
// separate: one constant must never be silently load-bearing for both APIs.
// The YouTube call site clamps against this; guarded by masterConfig.test.ts.
export const YOUTUBE_MAX_LOCATION_RADIUS_KM = 1000;

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
