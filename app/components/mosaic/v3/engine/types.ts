/** One loadable frame, with everything the engine needs and nothing else. */
export interface TileInput {
  id: number; // webcamId
  lat: number;
  lng: number;
  srcWidth: number; // natural px of the loaded preview
  srcHeight: number;
  passes: boolean; // gate verdict from readSignal
  score: number | null; // [0,1] quality from readSignal
  sunAltitudeDeg: number | null; // null when the moment is unknown
}

export interface SizedTile extends TileInput {
  width: number;
  height: number;
  pinnedToFloor: boolean; // true for every gate-failer — the fixed directive
}

export interface Row {
  tiles: SizedTile[];
  height: number; // tallest member
  meanLat: number;
}

export interface PlacedRow extends Row {
  centerY: number;
}

export interface PlacedTile extends SizedTile {
  x: number;
  y: number;
}

export interface Layout {
  tiles: PlacedTile[];
  dropped: number[]; // webcamIds removed, last resort only
  scale: number; // 1 = the composition fit without shrinking
  viewport: { width: number; height: number };
}

export type FailedCamPolicy = 'hide' | 'showAtFloor' | 'showIfRoom';
export type SizingCurve = 'linear' | 'easeIn' | 'percentileAmongPassers';
export type ArrangementStrategy = 'anchorRelax' | 'latitudeBands';
export type HorizontalAnchor = 'solarAltitude' | 'order';
export type RowAlign = 'center' | 'justify' | 'west';

/** Every v3 composition knob, resolved to concrete values. */
export interface V3Config {
  // signal
  qualitySource: 'auto' | 'model' | 'llm';
  // visibility
  gateThreshold: number; // [0,1] probability
  failedCamPolicy: FailedCamPolicy;
  maxTiles: number; // 0 = unlimited
  // sizing
  floorPx: number;
  ceilingPx: number;
  curve: SizingCurve;
  scoreFloor: number; // score that renders at floorPx (absolute curves only)
  scoreCeiling: number; // score that renders at ceilingPx (absolute curves only)
  sharedScale: boolean; // adopt one overflow scale across both feeds
  // arrangement
  strategy: ArrangementStrategy;
  bandCount: number;
  horizontalAnchor: HorizontalAnchor;
  rowAlign: RowAlign;
  geographicFidelity: number; // [0,1]
  tileGapPx: number;
  latNorth: number;
  latSouth: number;
  // overlays
  showFeedLabel: boolean;
  showTileRatings: boolean;
  overlayScale: number; // multiplier on readout text size
  showModelReadout: boolean;
}
