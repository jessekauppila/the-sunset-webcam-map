import type { SettingsSchema, SettingsValues } from '@/app/lib/settings/schema';
import { SOLO_SETTINGS_SCHEMA } from '@/app/lib/solo/settingsSchema';
import { dialsFrom } from '@/app/lib/solo/settingsSchema';
import { BEAT_OPTIONS } from './plan';
import type { ArrivalEase, RunShape, Screens, Solo2Dials, Transition, VeilCovers, VeilStyle, VeilTint } from './types';

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
  {
    key: 'beat', kind: 'enum', options: BEAT_OPTIONS.map(String), default: '4',
    label: 'beat (s)', section: 'glass',
    description: 'The tick both screens change frames on: seconds 0, 4, 8 \u2026 of every minute at 4. A frame of a run holds one beat; a still holds the dwell below; a camera change holds the change below. Only divisors of a minute, so the grid never drifts from the clock. Both screens read the same clock, so nothing has to be told.',
  },
  {
    key: 'dwellBeats', kind: 'number', min: 1, max: 10, step: 1, default: 3,
    label: 'still (beats)', section: 'glass',
    description: 'How many beats a single image holds \u2014 3 beats at a 4 s beat is 12 s. A run with fewer frames than this rests the remainder on its last frame, the picture it arrived at; a longer run simply takes more beats. The rate never changes.',
  },
  {
    key: 'cameraRun', kind: 'boolean', default: true,
    label: 'camera run', section: 'glass',
    description: 'A camera\'s frames are one item in the bin. A dwell plays them oldest to newest, each for an even share of the dwell, dissolving from one to the next. Off: every frame is its own item, as solo does.',
  },
  {
    key: 'runFramesSunset', kind: 'number', min: 1, max: 20, step: 1, default: 8,
    label: 'most frames, sunset bin', section: 'glass',
    description: 'Both screens. The longest a sunset timelapse may run, in frames; each frame is one beat, so 8 frames at a 4 s beat is 32 s plus the change.',
  },
  {
    key: 'runFramesOther', kind: 'number', min: 1, max: 20, step: 1, default: 3,
    label: 'most frames, non-sunset bin', section: 'glass',
    description: 'Both screens. The same cap for non-sunsets, deliberately lower. A non-sunset run shorter than the still rests on its last frame like any other, so this dial buys pictures inside the still before it buys time.',
  },
  {
    key: 'runShape', kind: 'enum', options: ['rank', 'flat'], default: 'rank',
    label: 'sunset run length', section: 'glass',
    description: 'rank: a sunset\u2019s run is measured against the other sunsets on offer. The best one present plays the whole sunset cap, the weakest plays no longer than a non-sunset, and the rest sit between, so a strong sunset buys screen time and a grey one gives it back. flat: every sunset may play the whole cap, whatever else is present.',
  },
  {
    key: 'dwellBoost', kind: 'number', min: 0, max: 100, step: 5, default: 25,
    label: 'best sunset holds longer (%)', section: 'glass',
    description: 'How much longer than the still the strongest sunset present holds, percent, rounded to whole beats; sunsets below it get a share by rank, down to the trim at the bottom. At 3 beats and 25% the best sunset on offer holds 4. 0 = the still.',
  },
  {
    key: 'dwellTrim', kind: 'number', min: 0, max: 50, step: 5, default: 25,
    label: 'grey frame holds shorter (%)', section: 'glass',
    description: 'How much shorter than the still a non-sunset holds, and the weakest sunset present with it, percent, rounded to whole beats, never below one. 0 = the still.',
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
  // ---- change: everything about one picture giving way to the next (its own rail page) ----
  {
    key: 'transition', kind: 'enum', options: ['cut', 'crossfade', 'dip'], default: 'dip',
    label: 'camera change', section: 'arrival',
    description: 'The gesture, for both screens. cut: the new picture simply replaces the old. crossfade: the old picture fades out while the new one fades in on top of it. dip: the old picture fades away into a veil, then the new one fades up out of it. Only `dip` reads the veil dial below — the other two are already not ending in darkness.',
  },
  {
    key: 'changeBeats', kind: 'number', min: 1, max: 2, step: 1, default: 1,
    label: 'camera change (beats)', section: 'arrival',
    description: 'How many beats a camera change takes. One beat: the old picture burns down into the veil over the first half and the new one rises over the second, and frame 1 then holds a whole beat of its own. Ignored by cut, which changes on the tick.',
  },
  {
    key: 'veilStyle', kind: 'enum', options: ['black', 'crossfade', 'lift', 'exposure'], default: 'black',
    label: 'sunrise change', section: 'arrival',
    description: 'What a camera change dips through, on a `dip`. The SUNSET screen ends in black under all four; this dial is about what a sunrise does instead, because a sunrise fading to black plays the day backwards. black: both screens dip through black, as today. crossfade: the sunrise screen never goes dark, one dawn dissolving straight into the next. lift: the sunrise screen dips through the tint below. exposure: the picture itself moves toward its veil — the sunrise blows out into white, the sunset darkens into black.',
  },
  {
    key: 'veilTint', kind: 'enum', options: ['white', 'dawn', 'sky', 'dim'], default: 'dawn',
    label: 'lift tint', section: 'arrival',
    description: 'Which light a `lift` sunrise dips through. Pure white on a 27-inch panel in a dark room reads as a camera flash; dawn and dim are the room-safe ones. Ignored by the other three.',
  },
  {
    key: 'burnLift', kind: 'number', min: 1, max: 3, step: 0.1, default: 1.6,
    label: 'burn', section: 'arrival',
    description: 'How hard an exposure pushes the picture toward its veil. 1 is a plain dip through white — the picture is covered, never brightened. 1.6 blows the sky out first and the dark ground last, which is what reads as overexposure. Past about 2 the picture is white long before the veil is, and the change looks lopsided again. Ignored unless the sunrise change is `exposure`.',
  },
  {
    key: 'veilCovers', kind: 'enum', options: ['picture', 'panel'], default: 'picture',
    label: 'veil covers', section: 'arrival',
    description: 'Whether the veil stays inside the picture or floods the black surround with it too. Invisible while the veil is black; it is the light and burn styles that make it a choice.',
  },
  {
    key: 'sameCameraFadeS', kind: 'number', min: 0, max: 5, step: 0.5, default: 1.5,
    label: 'same camera (s)', section: 'arrival',
    description: 'How long one frame of a camera takes to dissolve into the next inside the run, and on a change to a later frame of the camera on glass. Never through black. 0 is a cut. Capped at half a beat inside a run, so at a 4 s beat nothing above 2 reaches the glass.',
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
  // ---- rendezvous ----
  {
    key: 'rendezvous', kind: 'boolean', default: false,
    label: 'rendezvous', section: 'rendezvous',
    description: 'Both screens land on their best frame on the same tick. A screen drawing a sunset with a peak announces the tick its peak will land on; the other screen fits to it by dropping frames from its climb or by letting the run that is ending play on. Nothing holds and the rate never changes. Off: the screens drift.',
  },
  {
    key: 'rendezvousWindow', kind: 'number', min: 1, max: 8, step: 1, default: 4,
    label: 'choice window', section: 'rendezvous',
    description: 'How many cameras deep into the queue the rendezvous may choose when it has a landing to meet. 1 means it never chooses, so the rotation is strict and the screens meet only when the camera next in line happens to be able to. Higher means more meetings and more repetition, because the cameras with the longest climbs are the easiest to land on a given tick.',
  },
  {
    key: 'rendezvousGood', kind: 'number', min: 0, max: 1, step: 0.05, default: 0.75,
    label: 'a good meeting', section: 'rendezvous',
    description: 'A meeting counts as good at or above this pair rank — the lower of the two cameras\' ranks among the sunsets present. A label for the studio and the replay: it does not decide whether meetings happen, so it can sit high without starving them.',
  },
  {
    key: 'rendezvousRest', kind: 'number', min: 0, max: 8, step: 1, default: 0,
    label: 'rest after a meeting', section: 'rendezvous',
    description: 'How many of this screen\'s runs pass after a meeting before it will announce another landing. A ceiling on how often the screens meet; 0 is off. It never stops a screen meeting a landing the other one has already announced.',
  },
] as const;

/** Typed view of a merged `solo2` values object (mergeSettings output). */
export function dialsFrom2(values: SettingsValues): Solo2Dials {
  return {
    ...dialsFrom(values),
    beatS: Number(values.beat),
    dwellBeats: values.dwellBeats as number,
    changeBeats: values.changeBeats as number,
    // Derived, so every consumer of SoloDials still reads seconds (beat spec §2.2).
    dwellS: (values.dwellBeats as number) * Number(values.beat),
    fadeS: (values.changeBeats as number) * Number(values.beat),
    offsetS: 0,
    transition: values.transition as Transition,
    sameCameraFadeS: values.sameCameraFadeS as number,
    leadS: values.leadS as number,
    leadScale: values.leadScale as number,
    cameraRun: values.cameraRun as boolean,
    runFramesSunset: values.runFramesSunset as number,
    runFramesOther: values.runFramesOther as number,
    runShape: values.runShape as RunShape,
    dwellBoost: values.dwellBoost as number,
    dwellTrim: values.dwellTrim as number,
    veilStyle: values.veilStyle as VeilStyle,
    veilTint: values.veilTint as VeilTint,
    burnLift: values.burnLift as number,
    veilCovers: values.veilCovers as VeilCovers,
    arrivalEase: values.arrivalEase as ArrivalEase,
    valleys: values.valleys as number,
    screens: values.screens as Screens,
    rendezvous: values.rendezvous as boolean,
    rendezvousWindow: values.rendezvousWindow as number,
    rendezvousGood: values.rendezvousGood as number,
    rendezvousRest: values.rendezvousRest as number,
  };
}
