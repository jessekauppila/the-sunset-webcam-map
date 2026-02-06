// Configuration constants - single source of truth for terminator search parameters
// This file can be imported by both server and client code
// 
// Alternative locations considered:
// - app/config/terminator.ts (more explicit config directory)
// - app/components/Map/lib/constants.ts (co-located with map code)
// - app/lib/types.ts (with type definitions, but types.ts should stay type-only)
// Current location (app/lib/) is standard for shared utilities
export const TERMINATOR_PRECISION_DEG = 15; // Terminator ring precision in degrees
//Higher means less points
// 13 works
// 11 works
export const SEARCH_RADIUS_DEG = 12; // Search radius per API call in degrees
// 10 works
// 6 works
// Circle rendering precision: how smooth the circle polygon is (number of points)
// Using SEARCH_RADIUS_DEG ensures the circle detail matches the search area size
export const CIRCLE_RENDERING_PRECISION_DEG = SEARCH_RADIUS_DEG;

