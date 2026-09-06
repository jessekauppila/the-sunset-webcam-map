import { mergeSettings } from '@/app/lib/settings/schema';
import type { SettingsSchema, SettingsValues } from '@/app/lib/settings/schema';
import { CAPTION_SCHEMA, captionDialsFrom } from './captionSchema';
import type { SoloDials } from './types';

export const SOLO_NAMESPACE = 'solo';

/**
 * Every dial in the `solo` namespace. Two sections, and the studio colours
 * them differently: 'glass' changes what the screen draws, 'bins' changes
 * which frame comes next (spec §6.4). The caption dials are the shared
 * namespace's (captionSchema.ts), so every solo version draws one caption.
 * Defaults ARE the behaviour with no settings row.
 */
export const SOLO_SETTINGS_SCHEMA: SettingsSchema = [
  // ---- glass ----
  {
    key: 'dwellS', kind: 'number', min: 5, max: 60, step: 1, default: 20,
    label: 'dwell (s)', section: 'glass',
    description: 'How long a frame stays on one screen.',
  },
  {
    key: 'offsetS', kind: 'number', min: 0, max: 30, step: 1, default: 10,
    label: 'offset (s)', section: 'glass',
    description: 'How far the sunset clock runs behind the sunrise clock, so the two screens never change together.',
  },
  {
    key: 'fadeS', kind: 'number', min: 0, max: 10, step: 0.5, default: 0,
    label: 'fade (s)', section: 'glass',
    description: 'Crossfade at each change. 0 is a hard cut.',
  },
  {
    key: 'showPlace', kind: 'boolean', default: true,
    label: 'place + country', section: 'glass',
    description: 'Caption the frame with the camera name, region and country. The caption dials say how.',
  },
  {
    key: 'showScores', kind: 'boolean', default: false,
    label: 'scores', section: 'glass',
    description: 'Show q (quality 0–1) and d (detection probability 0–1) on glass.',
  },
  {
    key: 'showRank', kind: 'boolean', default: false,
    label: 'bin rank', section: 'glass',
    description: 'Show where this frame sits in its bin.',
  },
  {
    key: 'showTally', kind: 'boolean', default: false,
    label: 'shown tally', section: 'glass',
    description: 'Show how many times this frame has been on glass.',
  },
  // ---- bins ----
  {
    key: 'qualityFloor', kind: 'number', min: 0, max: 1, step: 0.05, default: 0.55,
    label: 'quality floor (sunsets)', section: 'bins',
    description: 'A sunset-bin frame needs at least this quality to be eligible.',
  },
  {
    key: 'detectionFloor', kind: 'number', min: 0, max: 1, step: 0.05, default: 0.3,
    label: 'detection floor (non-sunsets)', section: 'bins',
    description: 'A non-sunset frame needs at least this detection probability to be eligible. Raise it to shrink that bin.',
  },
  {
    key: 'sunsetFloor', kind: 'number', min: 0, max: 12, step: 1, default: 6,
    label: 'sunset floor', section: 'bins',
    description: 'While at least this many sunsets wait in the current tier, the queue is sunsets only. 0 = sunsets only within a tier; unshown non-sunsets still come before a sunset that has used its repeat allowance. To never show non-sunsets, set the detection floor to 1.',
  },
  {
    key: 'mix', kind: 'number', min: 1, max: 6, step: 1, default: 2,
    label: 'mix (sunsets per non-sunset)', section: 'bins',
    description: 'Below the sunset floor: this many sunsets between each non-sunset.',
  },
  {
    key: 'rest', kind: 'number', min: 0, max: 12, step: 1, default: 4,
    label: 'rest (draws)', section: 'bins',
    description: 'Draws a frame sits out after it has been on glass, in either bin. 0 = only never twice in a row.',
  },
  {
    key: 'zoneGrace', kind: 'number', min: 0, max: 5, step: 1, default: 2,
    label: 'zone grace (pulls)', section: 'bins',
    description: 'A camera outside the sweep zone stays in the bins for this many cron pulls before its frames are removed.',
  },
  {
    key: 'promoteNew', kind: 'boolean', default: true,
    label: 'promote new frames', section: 'bins',
    description: 'A newer frame from a camera already in the bin gets +0.10 on its score until first shown.',
  },
] as const;

/**
 * Typed view of a merged `solo` values object (mergeSettings output), with
 * the caption read from the same object. Surfaces pass `withCaption(values,
 * shared)` so the caption is the shared namespace's; without those keys the
 * caption sits at its defaults (the engine never draws, and tests build
 * dials from `schemaDefaults(SOLO_SETTINGS_SCHEMA)`).
 */
export function dialsFrom(values: SettingsValues): SoloDials {
  return {
    qualityFloor: values.qualityFloor as number,
    detectionFloor: values.detectionFloor as number,
    sunsetFloor: values.sunsetFloor as number,
    mix: values.mix as number,
    rest: values.rest as number,
    promoteNew: values.promoteNew as boolean,
    zoneGrace: values.zoneGrace as number,
    dwellS: values.dwellS as number,
    offsetS: values.offsetS as number,
    fadeS: values.fadeS as number,
    showPlace: values.showPlace as boolean,
    showScores: values.showScores as boolean,
    showRank: values.showRank as boolean,
    showTally: values.showTally as boolean,
    ...captionDialsFrom(mergeSettings(CAPTION_SCHEMA, values)),
  };
}
