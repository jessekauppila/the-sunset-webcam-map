export interface TileInput {
  id: number; // webcamId
  lat: number;
  lng: number;
  srcWidth: number; // natural px of the loaded preview image
  srcHeight: number;
  score: number | null; // from getQualityScore
}

export interface SizedTile extends TileInput {
  percentile: number; // 0..1
  width: number; // laid-out px
  height: number;
}

export interface CompositionConfig {
  floorPx: number; // COMPOSITION_TILE_FLOOR_PX
  ceilPx: number; // COMPOSITION_TILE_CEIL_PX
  upscaleMax: number; // COMPOSITION_UPSCALE_MAX
  latWindow: [number, number]; // [northLat, southLat] e.g. [70, -60]
  maxGrowth: number; // COMPOSITION_MAX_GROWTH
  cullOverflow: boolean; // COMPOSITION_CULL_OVERFLOW
  padding: number; // px between tiles
}

export interface PlacedTile extends SizedTile {
  x: number;
  y: number;
}

export interface Layout {
  tiles: PlacedTile[];
  dropped: number[]; // webcamIds culled by overflow
  viewport: { width: number; height: number };
}
