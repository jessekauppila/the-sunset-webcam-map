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
}

/** Every dial in the `solo` namespace, typed. Built by settingsSchema.dialsFrom. */
export interface SoloDials {
  // bins group — change which frame comes next
  qualityFloor: number;
  detectionFloor: number;
  sunsetFloor: number;
  mix: number;
  repeatAllowance: number;
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
}

/** What one screen remembers between draws (rules 2 and 4). */
export interface ScreenState {
  /** The frame on glass now. Never drawn again immediately (rule 4). */
  lastSnapshotId: number | null;
  /** Consecutive sunset-bin draws since the last non-sunset draw (rule 2). */
  sunsetStreak: number;
}
