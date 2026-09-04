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

export interface PlacedTile extends SizedTile {
  x: number;
  y: number;
}

export interface Layout {
  tiles: PlacedTile[];
  /**
   * Overflow casualties ONLY (spec §5.6). Tiles the operator's own visibility
   * policy removed were configured away, and tiles the band pass evicted lost
   * a fight — three different mechanisms, three different numbers, so the
   * setup overlay can say which one removed a camera.
   */
  dropped: number[];
  /** Band-eviction casualties: placed, outranked, not drawn. */
  evicted: number[];
  scale: number; // 1 = the composition fit without shrinking
  viewport: { width: number; height: number };
}

export type FailedCamPolicy = 'hide' | 'showAtFloor' | 'showIfRoom';
export type SizingCurve = 'linear' | 'easeIn' | 'percentileAmongPassers';

/**
 * How the fixed band grid meets the panel edges.
 *
 * `full` divides the whole panel, so the outermost band centres sit half a
 * band from each edge and a tall tile there overhangs. `inset` holds the grid
 * back by half a ceiling tile at each edge so nothing overhangs, at the cost
 * of a tighter band pitch. Kept as a dial rather than a decision because the
 * trade is a judgement about the wall, not a correctness question.
 */
export type BandGrid = 'full' | 'inset';

/** Every v3 composition knob, resolved to concrete values. */
export interface V4Config {
  // signal
  qualitySource: 'auto' | 'model' | 'llm';
  // visibility
  gateThreshold: number; // [0,1] probability
  failedCamPolicy: FailedCamPolicy;
  maxTiles: number; // 0 = unlimited
  missGraceCycles: number; // cycles a missing camera is held before its tile leaves
  // sizing
  floorPx: number;
  ceilingPx: number;
  curve: SizingCurve;
  scoreFloor: number; // score that renders at floorPx (absolute curves only)
  scoreCeiling: number; // score that renders at ceilingPx (absolute curves only)
  exitTaperDeg: number; // degrees inside the exit edge over which a passer shrinks to the floor; 0 disables
  sharedScale: boolean; // adopt one overflow scale across both feeds
  // arrangement — bands vertically, solar altitude horizontally, both absolute
  bandCount: number;
  bandGrid: BandGrid;
  tileGapPx: number;
  latNorth: number;
  latSouth: number;
  axisNightEdgeDeg: number;
  axisDayEdgeDeg: number;
  // eviction
  hysteresisMargin: number;
  minDwellMs: number;
  // overlays
  showFeedLabel: boolean;
  showTileRatings: boolean;
  overlayScale: number; // multiplier on readout text size
  showModelReadout: boolean;
  showCentreLine: boolean;
}
