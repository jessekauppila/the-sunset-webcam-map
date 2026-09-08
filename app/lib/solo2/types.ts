import type { SoloDials } from '@/app/lib/solo/types';

/** How a sunset's run length is decided: one cap for every sunset, or by its rank among the sunsets present. */
export type RunShape = 'flat' | 'rank';

/** How one frame gives way to the next (spec §4.2). */
export type Transition = 'cut' | 'crossfade' | 'dip';

/** The time part of the caption moved to the solo dials with the caption section; re-exported for older imports. */
export type { TimeStyle } from '@/app/lib/solo/types';

/** What a camera change dips through (arrival-look spec §2). A pair: one look per screen. */
export type VeilStyle = 'black' | 'crossfade' | 'lift' | 'exposure';

/** The tint a `light` sunrise dips through (veil.ts `VEIL_TINTS`). */
export type VeilTint = 'white' | 'dawn' | 'sky' | 'dim';

/** Whether the veil spans the panel or only the picture inside it. */
export type VeilCovers = 'picture' | 'panel';

/** The timing function both halves of every dissolve share (veil.ts `ARRIVAL_EASES`). */
export type ArrivalEase = 'linear' | 'gentle' | 'soft';

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
  /** Flat: every sunset may play the sunset cap. Rank: a sunset's run sits between the two caps by its rank among the sunsets present. */
  runShape: RunShape;
  /** What a camera change dips through; the sunset screen stays black under all of them. */
  veilStyle: VeilStyle;
  /** The tint a `light` sunrise dips through. Ignored by every other style. */
  veilTint: VeilTint;
  /** How far an exposure pushes the picture toward its veil. Ignored unless `burn`. */
  burnLift: number;
  veilCovers: VeilCovers;
  /**
   * The timing function every layer of a dissolve shares — the camera change
   * and the steps inside a run alike. Symmetric by construction so the two
   * halves cannot drift apart (veil.ts).
   */
  arrivalEase: ArrivalEase;
  // bins
  valleys: number;
  screens: Screens;
}
