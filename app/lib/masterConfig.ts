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

// Circle rendering precision: how smooth the circle polygon is (number of points)
// Using SEARCH_RADIUS_DEG ensures the circle detail matches the search area size
export const CIRCLE_RENDERING_PRECISION_DEG = SEARCH_RADIUS_DEG;

// 14, -10, 11 provides the widest coverage
// 12, -8, 9 provides less coverage

// ---------------------------------------------------------------------------
// AI scoring + snapshot capture behavior
// ---------------------------------------------------------------------------
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
// positive vs negative decisions.
export const AI_BINARY_DECISION_THRESHOLD = 0.5;

// Minimum raw score required to treat a webcam as "capture-worthy" for
// snapshot persistence during cron runs.
export const AI_SNAPSHOT_MIN_RAW_SCORE_THRESHOLD = 0.8;

// Legacy rating-space threshold (0-5 scale). Keep this for places that still
// reason in rating units while we transition to raw-score thresholds.
export const AI_SNAPSHOT_MIN_RATING_THRESHOLD = 4.0;
export const AI_SNAPSHOT_RECENT_WINDOW_MINUTES = 30;

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

// Runtime mode selection:
// - baseline: deterministic metadata-based score
// - onnx: load ONNX artifact and score via onnxruntime
// ONNX creation/export workflow lives in `ml/README.md` ("Export ONNX and verify locally").
// Defaults here are compatibility fallbacks; production/experiment usage should
// set AI_ONNX_*_MODEL_PATH + AI_*_MODEL_VERSION env vars to versioned artifacts.
export const AI_SCORING_MODE_DEFAULT = 'baseline';
export const AI_MODEL_VERSION_DEFAULT = 'baseline-v1';
export const AI_ONNX_MODEL_PATH_DEFAULT =
  'ml/artifacts/models/model.onnx';
export const AI_BINARY_MODEL_VERSION_DEFAULT = 'binary-v1';
export const AI_REGRESSION_MODEL_VERSION_DEFAULT = 'regression-v1';
export const AI_ONNX_BINARY_MODEL_PATH_DEFAULT =
  'ml/artifacts/models/binary_resnet18/model.onnx';
export const AI_ONNX_REGRESSION_MODEL_PATH_DEFAULT =
  'ml/artifacts/models/regression_resnet18/model.onnx';

// ---------------------------------------------------------------------------
// Windy API fetch behavior
// ---------------------------------------------------------------------------
export const WINDY_FETCH_BATCH_SIZE = 5;
export const WINDY_FETCH_DELAY_BETWEEN_BATCHES_MS = 1000;
export const WINDY_FETCH_STAGGER_WITHIN_BATCH_MS = 200;

// ---------------------------------------------------------------------------
// Mosaic sizing behavior
// ---------------------------------------------------------------------------
// Largest image height in mosaic. Set to popup image height parity.
export const MOSAIC_MAX_IMAGE_HEIGHT_PX = 128;
// Smallest image height in mosaic.
export const MOSAIC_MIN_IMAGE_HEIGHT_PX = 26;
// Global scaling strength (1 = baseline behavior).
export const MOSAIC_SIZE_SCALE_STRENGTH = 1;
// Scaling mode for converting score -> size.
// Current supported: 'linear'
export const MOSAIC_SIZE_SCALE_MODE = 'linear';

// ---------------------------------------------------------------------------
// Kiosk display settings (portrait 1080×1920, gallery installation)
// ---------------------------------------------------------------------------
// Tile heights are larger than the default mosaic to fill the taller display.
// Tune these visually using Chrome DevTools at 1080×1920.
export const KIOSK_MOSAIC_MAX_IMAGE_HEIGHT_PX = 180;
export const KIOSK_MOSAIC_MIN_IMAGE_HEIGHT_PX = 32;
// More images than default (90) to fill the extra vertical height.
export const KIOSK_CANVAS_MAX_IMAGES = 120;

// ---------------------------------------------------------------------------
// YouTube cron fetch behavior
// ---------------------------------------------------------------------------
export const YOUTUBE_FETCH_BATCH_SIZE = 5;
export const YOUTUBE_FETCH_DELAY_BETWEEN_BATCHES_MS = 800;
