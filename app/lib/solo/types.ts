export type Feed = 'sunrise' | 'sunset';
export type BinKind = 'sunset' | 'non_sunset';

/**
 * One archived frame waiting in a bin. The unit of the solo kiosk: a camera
 * is only a grouping (spec §2, §3).
 */
export interface BinEntry {
  snapshotId: number;
  webcamId: number;
  bin: BinKind;
  /** ai_regression_score × calibration_multiplier. Null on non-sunset rows. */
  quality: number | null;
  /** ai_binary_score, the raw sunset probability in [0,1]. Never calibrated. */
  detection: number;
  /** Arrived while an older frame from the same camera was already in the bin. */
  isNew: boolean;
  /** Times this frame has been on glass. */
  tally: number;
  /** ms since epoch. Tie-breaker after score. */
  enteredAt: number;
  /** When this frame was last on glass, ms since epoch. Undefined or null = never (rule 2). */
  lastShownAt?: number | null;
}

// ---- caption dials (see lib/solo/caption.ts) ----

/** Overlay: today's look, text over the picture. Inset: picture on black, text beneath. */
export type CaptionLayout = 'overlay' | 'inset';
/** Where the caption block hangs when the layout is inset. */
export type CaptionAnchor = 'panel-bottom' | 'under-picture';
export type CaptionAlign = 'picture' | 'center' | 'panel';
/** The time part of the caption (solo2 spec §4.5). */
export type TimeStyle = 'off' | '12h' | '12h-there' | '24h' | 'sun' | '12h-sun';
/** The time on its own line, or after the place with a middle dot. */
export type TimeLine = 'own' | 'inline';
/** What to do with Windy's "City › Compass: Spot" titles. */
export type TitleClean = 'raw' | 'comma' | 'dot' | 'compass' | 'spot';
export type TitleWeight = '300' | '400' | '500' | '600';
export type CaptionFont = 'system' | 'geist' | 'sans' | 'serif' | 'mono';

/** Every dial in the `solo` namespace, typed. Built by settingsSchema.dialsFrom. */
export interface SoloDials {
  // bins group — change which frame comes next
  qualityFloor: number;
  detectionFloor: number;
  sunsetFloor: number;
  mix: number;
  rest: number;
  promoteNew: boolean;
  zoneGrace: number;
  // glass group — change what the screen draws
  dwellS: number;
  offsetS: number;
  fadeS: number;
  showPlace: boolean;
  showScores: boolean;
  showRank: boolean;
  showTally: boolean;
  // caption group — the picture's frame and the words beneath it.
  // Sizes are glass pixels on a 1920-wide panel; grays are percent of white.
  captionLayout: CaptionLayout;
  pictureHeight: number;
  pictureTop: number;
  captionAnchor: CaptionAnchor;
  captionAlign: CaptionAlign;
  captionGap: number;
  font: CaptionFont;
  titleClean: TitleClean;
  titleSize: number;
  titleWeight: TitleWeight;
  titleGray: number;
  placeSize: number;
  placeGray: number;
  lineGap: number;
  timeStyle: TimeStyle;
  timeLine: TimeLine;
  timeSize: number;
  timeGray: number;
}

/** What one screen remembers between draws (rules 2 and 4). */
export interface ScreenState {
  /** The frame on glass now. Never drawn again immediately (rule 4). */
  lastSnapshotId: number | null;
  /** Consecutive sunset-bin draws since the last non-sunset draw (rule 2). */
  sunsetStreak: number;
}
