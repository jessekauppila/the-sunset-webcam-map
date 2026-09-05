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
  /** Dissolve length between two frames of the same camera: prelude steps, and a same-camera change. 0 is a cut. */
  sameCameraFadeS: number;
  leadS: number;
  leadScale: number;
  prelude: boolean;
  preludeFrames: number;
  preludeStepS: number;
  // bins
  valleys: number;
  screens: Screens;
}
