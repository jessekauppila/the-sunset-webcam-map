import type { SettingsSchema, SettingsValues } from '@/app/lib/settings/schema';
import { SOLO_SETTINGS_SCHEMA } from '@/app/lib/solo/settingsSchema';
import { dialsFrom } from '@/app/lib/solo/settingsSchema';
import type { Screens, Solo2Dials, TimeStyle, Transition } from './types';

export const SOLO2_NAMESPACE = 'solo2';

const solo = (key: string) => {
  const knob = SOLO_SETTINGS_SCHEMA.find((k) => k.key === key);
  if (!knob) throw new Error(`solo schema has no ${key}`);
  return knob;
};

/**
 * solo's dials plus the solo2 additions, in the order the rail shows them.
 * Every added dial defaults to solo's behaviour except `timeStyle`, which
 * defaults to the 12-hour clock because the time is the point (spec §1).
 */
export const SOLO2_SETTINGS_SCHEMA: SettingsSchema = [
  // ---- glass ----
  solo('dwellS'),
  solo('offsetS'),
  {
    key: 'transition', kind: 'enum', options: ['cut', 'crossfade', 'dip'], default: 'cut',
    label: 'transition', section: 'glass',
    description: 'How a frame gives way to the next. Cut is instant; crossfade dissolves over the fade time; dip goes through black in the same time.',
  },
  { ...solo('fadeS'), description: 'How long a crossfade or dip takes. Ignored by cut.' },
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
  {
    key: 'prelude', kind: 'boolean', default: false,
    label: 'prelude', section: 'glass',
    description: 'Before the chosen frame, show the same camera\'s earlier frames in order, so the sun visibly drops into the picture.',
  },
  {
    key: 'preludeFrames', kind: 'number', min: 1, max: 6, step: 1, default: 3,
    label: 'prelude frames', section: 'glass',
    description: 'At most this many earlier frames. Fewer if the camera has fewer, or if the dwell cannot fit them.',
  },
  {
    key: 'preludeStepS', kind: 'number', min: 0.5, max: 5, step: 0.5, default: 1.5,
    label: 'prelude step (s)', section: 'glass',
    description: 'How long each prelude frame is held. Steps are hard cuts: a time-lapse reads as cuts.',
  },
  solo('showPlace'),
  {
    key: 'timeStyle', kind: 'enum', options: ['off', '12h', '12h-there', '24h', 'sun', '12h-sun'], default: '12h',
    label: 'time', section: 'glass',
    description: 'What follows the place on the caption: the local clock at the camera when the picture was taken (12h → "7:42 pm", 24h → "19:42"), the sun\'s height ("sun 1.2° above the horizon"), or both.',
  },
  solo('showScores'),
  solo('showRank'),
  solo('showTally'),
  // ---- bins ----
  solo('qualityFloor'),
  solo('detectionFloor'),
  solo('sunsetFloor'),
  solo('mix'),
  solo('repeatAllowance'),
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
    leadS: values.leadS as number,
    leadScale: values.leadScale as number,
    prelude: values.prelude as boolean,
    preludeFrames: values.preludeFrames as number,
    preludeStepS: values.preludeStepS as number,
    timeStyle: values.timeStyle as TimeStyle,
    valleys: values.valleys as number,
    screens: values.screens as Screens,
  };
}
