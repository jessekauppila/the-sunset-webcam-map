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
export const TERMINATOR_RING_OFFSETS_DEG = [
  0,
  1.75 * SEARCH_RADIUS_DEG,
];

// Circle rendering precision: how smooth the circle polygon is (number of points)
// Using SEARCH_RADIUS_DEG ensures the circle detail matches the search area size
export const CIRCLE_RENDERING_PRECISION_DEG = SEARCH_RADIUS_DEG;

// 14, -10, 11 provides the widest coverage
// 12, -8, 9 provides less coverage

// ---------------------------------------------------------------------------
// AI scoring + snapshot capture behavior
// ---------------------------------------------------------------------------
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

// Runtime mode selection:
// - baseline: deterministic metadata-based score
// - onnx: load ONNX artifact and score via onnxruntime
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
// YouTube cron fetch behavior
// ---------------------------------------------------------------------------
export const YOUTUBE_FETCH_BATCH_SIZE = 5;
export const YOUTUBE_FETCH_DELAY_BETWEEN_BATCHES_MS = 800;
