import type { NumberKnob, SettingsSchema, SettingsValues } from '@/app/lib/settings/schema';
import { SOLO_SETTINGS_SCHEMA } from '@/app/lib/solo/settingsSchema';
import { dialsFrom } from '@/app/lib/solo/settingsSchema';
import type { ArrivalEase, Screens, Solo2Dials, Transition, VeilCovers, VeilStyle, VeilTint } from './types';

export const SOLO2_NAMESPACE = 'solo2';

const solo = (key: string) => {
  const knob = SOLO_SETTINGS_SCHEMA.find((k) => k.key === key);
  if (!knob) throw new Error(`solo schema has no ${key}`);
  return knob;
};

/**
 * solo's dials plus the solo2 additions, in the order the rail shows them.
 * Every added dial defaults to solo's behaviour; the exceptions are the
 * fade and the dissolves (decided 2026-09-05) and the camera run (on, the
 * camera-run spec §4.3). The caption dials are not here:
 * they are the shared namespace's (captionSchema.ts), one set for every
 * solo version.
 */
export const SOLO2_SETTINGS_SCHEMA: SettingsSchema = [
  // ---- glass ----
  solo('dwellS'),
  solo('offsetS'),
  {
    key: 'cameraRun', kind: 'boolean', default: true,
    label: 'camera run', section: 'glass',
    description: 'A camera\'s frames are one item in the bin. A dwell plays them oldest to newest, each for an even share of the dwell, dissolving from one to the next. Off: every frame is its own item, as solo does.',
  },
  {
    key: 'transition', kind: 'enum', options: ['cut', 'crossfade', 'dip'], default: 'dip',
    label: 'camera change', section: 'glass',
    description: 'How the screen goes from one camera to another. cut: the new picture simply replaces the old. crossfade: the old picture fades out while the new one fades in on top of it. dip: the old picture fades to black, then the new one fades up from black.',
  },
  { ...(solo('fadeS') as NumberKnob), default: 1.5, label: 'camera change (s)', description: 'How long a crossfade takes, or a dip (down plus up). Ignored by cut.' },
  {
    key: 'sameCameraFadeS', kind: 'number', min: 0, max: 5, step: 0.5, default: 1.5,
    label: 'same camera (s)', section: 'glass',
    description: 'How long one frame of a camera takes to dissolve into the next inside the run, and on a change to a later frame of the camera on glass. Never through black. 0 is a cut.',
  },
  {
    key: 'minStepS', kind: 'number', min: 1, max: 20, step: 0.5, default: 4,
    label: 'shortest frame (s)', section: 'glass',
    description: 'The floor under a run\u2019s frames. A dwell is a budget its frames share: with few enough frames they simply divide it and the dwell stays the dwell. Once the share would fall below this, frames hold here instead and the dwell stretches. At a 20 s dwell that threshold is 5 frames.',
  },
  {
    key: 'runFramesSunset', kind: 'number', min: 1, max: 20, step: 1, default: 8,
    label: 'most frames, sunset', section: 'glass',
    description: 'The longest a sunset timelapse may run. Above the threshold each extra frame adds the shortest-frame time to the dwell, so this dial sets the longest dwell the glass can ever show: 8 frames at a 4 s floor is 32 s.',
  },
  {
    key: 'runFramesOther', kind: 'number', min: 1, max: 20, step: 1, default: 3,
    label: 'most frames, non-sunset', section: 'glass',
    description: 'The same cap for non-sunsets, deliberately lower. At or below the threshold this buys PICTURES, not time: the dwell stays the dwell however many frames play, so a non-sunset can never hold the screen longer than a single still does. Above the threshold it starts stretching like a sunset.',
  },
  {
    key: 'leadS', kind: 'number', min: 0, max: 10, step: 0.5, default: 0,
    label: 'lead (s)', section: 'glass',
    description: 'For this long before each change, the frame on glass slowly pushes in. Stillness means now; motion means change is coming. 0 is off.',
  },
  {
    key: 'leadScale', kind: 'number', min: 1, max: 1.1, step: 0.01, default: 1.03,
    label: 'lead scale', section: 'glass',
    description: 'How far the push goes by the moment of the change. 1.03 is barely felt; 1.10 is a visible zoom.',
  },
  // ---- arrival: what a camera change dips through (its own rail page) ----
  {
    key: 'veilStyle', kind: 'enum', options: ['black', 'crossfade', 'light', 'burn'], default: 'black',
    label: 'the change', section: 'arrival',
    description: 'What a camera change dips through. The sunset screen ends in black under all four; this dial is about what a SUNRISE does instead, because a sunrise fading to black plays the day backwards. black: both screens dip through black, as today. crossfade: the sunrise screen never goes dark, one dawn dissolving into the next. light: the sunrise screen dips through the tint below. burn: the picture itself moves toward its veil — the sunrise blows out into white, the sunset darkens into black.',
  },
  {
    key: 'veilTint', kind: 'enum', options: ['white', 'dawn', 'sky', 'dim'], default: 'dawn',
    label: 'light tint', section: 'arrival',
    description: 'Which light a `light` sunrise dips through. Pure white on a 27-inch panel in a dark room reads as a camera flash; dawn and dim are the room-safe ones. Ignored by the other three.',
  },
  {
    key: 'burnLift', kind: 'number', min: 1, max: 3, step: 0.1, default: 1.6,
    label: 'burn', section: 'arrival',
    description: 'How hard an exposure pushes the picture toward its veil. 1 is a plain dip through white — the picture is covered, never brightened. 1.6 blows the sky out first and the dark ground last, which is what reads as overexposure. Past about 2 the picture is white long before the veil is, and the change looks lopsided again. Ignored unless the change is `burn`.',
  },
  {
    key: 'veilCovers', kind: 'enum', options: ['picture', 'panel'], default: 'picture',
    label: 'veil covers', section: 'arrival',
    description: 'Whether the veil stays inside the picture or floods the black surround with it too. Invisible while the veil is black; it is the light and burn styles that make it a choice.',
  },
  {
    key: 'arrivalEase', kind: 'enum', options: ['linear', 'gentle', 'soft'], default: 'gentle',
    label: 'ease', section: 'arrival',
    description: 'How a dissolve starts and stops — the camera change and the steps inside a run alike. linear moves at one rate throughout, which is what makes a change feel like it snaps in. gentle and soft ramp in and out. Every curve here is symmetric, so the leaving half and the arriving half stay the same shape run opposite ways; an eased arrival against a linear departure lands in a third of the time it left in.',
  },
  solo('showPlace'),
  solo('showScores'),
  solo('showRank'),
  solo('showTally'),
  // ---- bins ----
  solo('ratingFloor'),
  solo('detectionFloor'),
  solo('sunsetFloor'),
  solo('mix'),
  solo('rest'),
  {
    key: 'valleys', kind: 'number', min: 0, max: 3, step: 1, default: 0,
    label: 'valleys per peak', section: 'bins',
    description: 'After each peak (best remaining), this many valleys (lowest eligible, unshown first) before the next peak. 0 is best-first throughout, as solo does.',
  },
  {
    key: 'screens', kind: 'enum', options: ['together', 'alternate'], default: 'together',
    label: 'screens', section: 'bins',
    description: 'Together: both screens peak on the same beat. Alternate: one screen is on a peak while the other is on a valley. Needs valleys ≥ 1.',
  },
  solo('zoneGrace'),
  solo('promoteNew'),
] as const;

/** Typed view of a merged `solo2` values object (mergeSettings output). */
export function dialsFrom2(values: SettingsValues): Solo2Dials {
  return {
    ...dialsFrom(values),
    transition: values.transition as Transition,
    sameCameraFadeS: values.sameCameraFadeS as number,
    leadS: values.leadS as number,
    leadScale: values.leadScale as number,
    cameraRun: values.cameraRun as boolean,
    minStepS: values.minStepS as number,
    runFramesSunset: values.runFramesSunset as number,
    runFramesOther: values.runFramesOther as number,
    veilStyle: values.veilStyle as VeilStyle,
    veilTint: values.veilTint as VeilTint,
    burnLift: values.burnLift as number,
    veilCovers: values.veilCovers as VeilCovers,
    arrivalEase: values.arrivalEase as ArrivalEase,
    valleys: values.valleys as number,
    screens: values.screens as Screens,
  };
}
