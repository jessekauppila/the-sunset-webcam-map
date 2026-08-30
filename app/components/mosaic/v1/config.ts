import type { CompositionConfig } from './engine/types';

// ---------------------------------------------------------------------------
// v1 composition tunables. These belong to the v1 mosaic alone — editing them
// affects no other version. (Formerly the COMPOSITION_* block in
// masterConfig.ts; moved here when the mosaic went multi-version.)
// ---------------------------------------------------------------------------
export const COMPOSITION_TILE_FLOOR_PX = 100;
export const COMPOSITION_TILE_CEIL_PX = 300;
export const COMPOSITION_UPSCALE_MAX = 1.5;
export const COMPOSITION_LAT_WINDOW: [number, number] = [70, -60];
export const COMPOSITION_MAX_GROWTH = 2.0;
export const COMPOSITION_CULL_OVERFLOW = true;

export const COMPOSITION_CONFIG = {
  floorPx: COMPOSITION_TILE_FLOOR_PX,
  ceilPx: COMPOSITION_TILE_CEIL_PX,
  upscaleMax: COMPOSITION_UPSCALE_MAX,
  latWindow: COMPOSITION_LAT_WINDOW,
  maxGrowth: COMPOSITION_MAX_GROWTH,
  cullOverflow: COMPOSITION_CULL_OVERFLOW,
  padding: 2,
} satisfies CompositionConfig;
