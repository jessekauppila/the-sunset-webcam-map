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
  /** The beat, seconds: every frame change lands on a tick of the wall clock at this spacing (beat spec §2.1). One of `BEAT_OPTIONS`. */
  beatS: number;
  /** How many beats a single image holds; a run shorter than this rests on its last frame (spec §2.3). */
  dwellBeats: number;
  /** Beats of veil at a camera change: the burn-down is the first half, the rise the second. 0 only when the transition is a cut. */
  changeBeats: number;
  /** Most frames a sunset run may play; each is one beat. */
  runFramesSunset: number;
  /** Most frames a non-sunset run may play. */
  runFramesOther: number;
  /** Flat: every sunset may play the sunset cap. Rank: a sunset's run sits between the two caps by its rank among the sunsets present. */
  runShape: RunShape;
  /** How much more than the dial the strongest sunset present holds, percent. Sunsets below it get a share by rank. 0 = the dial. */
  dwellBoost: number;
  /** How much less than the dial a non-sunset, and the weakest sunset present, hold, percent. 0 = the dial. */
  dwellTrim: number;
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
  // rendezvous
  /** Both screens land on their best frame on the same tick, when the sunset is good enough (rendezvous spec §3). */
  rendezvous: boolean;
  /** A draw is eligible when its camera's sunset rank clears this: 1 = only the best sunset present, 0 = every sunset. */
  rendezvousRank: number;
}
