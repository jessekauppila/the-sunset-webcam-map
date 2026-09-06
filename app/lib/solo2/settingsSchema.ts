import type { NumberKnob, SettingsSchema, SettingsValues } from '@/app/lib/settings/schema';
import { SOLO_SETTINGS_SCHEMA } from '@/app/lib/solo/settingsSchema';
import { dialsFrom } from '@/app/lib/solo/settingsSchema';
import type { Screens, Solo2Dials, Transition } from './types';

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
    key: 'leadS', kind: 'number', min: 0, max: 10, step: 0.5, default: 0,
    label: 'lead (s)', section: 'glass',
    description: 'For this long before each change, the frame on glass slowly pushes in. Stillness means now; motion means change is coming. 0 is off.',
  },
  {
    key: 'leadScale', kind: 'number', min: 1, max: 1.1, step: 0.01, default: 1.03,
    label: 'lead scale', section: 'glass',
    description: 'How far the push goes by the moment of the change. 1.03 is barely felt; 1.10 is a visible zoom.',
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
    valleys: values.valleys as number,
    screens: values.screens as Screens,
  };
}
