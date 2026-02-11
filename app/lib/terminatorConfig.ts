// Configuration constants - single source of truth for terminator search parameters
// This file can be imported by both server and client code
// 
// Alternative locations considered:
// - app/config/terminator.ts (more explicit config directory)
// - app/components/Map/lib/constants.ts (co-located with map code)
// - app/lib/types.ts (with type definitions, but types.ts should stay type-only)
// Current location (app/lib/) is standard for shared utilities
export const TERMINATOR_PRECISION_DEG = 12; // Terminator ring precision in degrees
//Higher means less points
//15 doesn't work
//14 is the highest that works. 
// 13 works
// 11 works
// Base sun altitude used for the terminator ring radius: radius = 90 - sunAltitude
// Keep default at 0 to match current terminator behavior (sun at horizon).
export const TERMINATOR_SUN_ALTITUDE_DEG = -13;
//was 0 and one of the lines was on the exact terminator line
//-10 works when precision is 14 and radius is 11
// -8 showed too much day time
export const SEARCH_RADIUS_DEG = 9; // Search radius per API call in degrees
//12 doesn't work
//11 is the widest that works
// 10 works
// 6 works
// West-only offset ring for parallel search/visualization, in degrees.
// 0 = main ring, positive values shift the ring westward from the subsolar geometry.
export const TERMINATOR_RING_OFFSETS_DEG = [0, 1.75 * SEARCH_RADIUS_DEG];
// Circle rendering precision: how smooth the circle polygon is (number of points)
// Using SEARCH_RADIUS_DEG ensures the circle detail matches the search area size
export const CIRCLE_RENDERING_PRECISION_DEG = SEARCH_RADIUS_DEG;

// AI snapshot capture settings (shared constants for cron behavior)
export const AI_SNAPSHOT_MIN_RATING_THRESHOLD = 4.0;
export const AI_SNAPSHOT_RECENT_WINDOW_MINUTES = 30;

//14, -10, 11 provides the widest covera
//12, -8, 9 provides less coverage