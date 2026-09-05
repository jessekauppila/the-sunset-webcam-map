import type { SoloDials } from '@/app/lib/solo/types';

/** How one frame gives way to the next (spec §4.2). */
export type Transition = 'cut' | 'crossfade' | 'dip';

/** The trailing item of the caption's second line (spec §4.5). */
export type TimeStyle = 'off' | '12h' | '12h-there' | '24h' | 'sun' | '12h-sun';

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
  transition: Transition;
  leadS: number;
  leadScale: number;
  prelude: boolean;
  preludeFrames: number;
  preludeStepS: number;
  timeStyle: TimeStyle;
  // bins
  valleys: number;
  screens: Screens;
}
