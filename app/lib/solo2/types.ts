import type { SoloDials } from '@/app/lib/solo/types';

/** How one frame gives way to the next (spec §4.2). */
export type Transition = 'cut' | 'crossfade' | 'dip';

/** The time part of the caption moved to the solo dials with the caption section; re-exported for older imports. */
export type { TimeStyle } from '@/app/lib/solo/types';

/** Whether the two screens peak on the same beat or opposite ones (spec §3). */
export type Screens = 'together' | 'alternate';

/** What a draw is inside a bar: beat 0 is the peak, the rest are valleys. */
export type Role = 'peak' | 'valley';

/**
 * Every dial in the `solo2` namespace. A superset of solo's, so every helper
 * that takes SoloDials accepts these. Built by settingsSchema.dialsFrom2.
 */
export interface Solo2Dials extends SoloDials {
  // glass
  /** Between cameras (spec §4.2). The same camera always dissolves. */
  transition: Transition;
  /** Dissolve length between two frames of the same camera inside a run, and on a same-camera change. 0 is a cut. */
  sameCameraFadeS: number;
  leadS: number;
  leadScale: number;
  /** A camera's frames are one item in the bin; a dwell plays them oldest to newest (camera-run spec §2). */
  cameraRun: boolean;
  /**
   * The shortest a single frame of a run may hold, seconds — the floor of the
   * budget rule (dwell-budget spec §3). Below `n* = floor(dwellS / minStepS)`
   * frames the budget is simply divided more finely and the dwell stays
   * `dwellS`; above it the dwell stretches rather than the frames shrinking.
   */
  minStepS: number;
  /** Most frames a sunset run may play. Its cap sets the longest possible dwell. */
  runFramesSunset: number;
  /**
   * Most frames a non-sunset run may play. Kept below `n*` by default, which
   * makes the floor a sunset-only mechanism: below the threshold this dial
   * buys pictures, never screen time (spec §4.1).
   */
  runFramesOther: number;
  // bins
  valleys: number;
  screens: Screens;
}
