import type { SettingsSchema, SettingsValues } from '@/app/lib/settings/schema';
import type {
  CaptionAlign, CaptionAnchor, CaptionFont, CaptionLayout, SoloDials, TimeLine, TimeStyle, TitleClean, TitleWeight,
} from './types';

export const SOLO_NAMESPACE = 'solo';

/**
 * Every solo dial. Three sections, and the studio colours them differently:
 * 'glass' changes what the screen draws, 'bins' changes which frame comes
 * next (spec §6.4), 'caption' is the picture's frame and the words beneath
 * it. Defaults ARE the behaviour with no settings row.
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
  // ---- caption ----
  // Defaults are the values dialled in on the 2026-09-05 mockup. Sizes are
  // glass pixels on a 1920-wide panel; grays are percent of white.
  {
    key: 'captionLayout', kind: 'enum', options: ['inset', 'overlay'], default: 'inset',
    label: 'layout', section: 'caption',
    description: 'Inset: the picture sits smaller on black with the caption beneath it. Overlay: the picture fills the panel and the caption floats over it.',
  },
  {
    key: 'pictureHeight', kind: 'number', min: 60, max: 100, step: 1, default: 87,
    label: 'picture height (%)', section: 'caption',
    description: 'How tall the inset picture is, as a percent of the panel. It keeps the panel\'s shape and sits centred.',
  },
  {
    key: 'pictureTop', kind: 'number', min: 0, max: 12, step: 0.5, default: 4,
    label: 'picture top margin (%)', section: 'caption',
    description: 'Black above the inset picture, as a percent of the panel height.',
  },
  {
    key: 'captionAnchor', kind: 'enum', options: ['panel-bottom', 'under-picture'], default: 'panel-bottom',
    label: 'caption sits', section: 'caption',
    description: 'panel-bottom: the gap above the bottom edge of the panel. under-picture: the gap below the picture.',
  },
  {
    key: 'captionAlign', kind: 'enum', options: ['picture', 'center', 'panel'], default: 'picture',
    label: 'caption aligned to', section: 'caption',
    description: 'Flush with the picture\'s left edge, centred on the panel, or at the panel\'s left margin.',
  },
  {
    key: 'captionGap', kind: 'number', min: 0, max: 80, step: 2, default: 18,
    label: 'gap (px)', section: 'caption',
    description: 'Space between the caption and whatever it is anchored to.',
  },
  {
    key: 'font', kind: 'enum', options: ['system', 'geist', 'sans', 'serif', 'mono'], default: 'system',
    label: 'font', section: 'caption',
    description: 'system: whatever the Pi has. geist: the site\'s face. sans: Source Sans 3. serif: Source Serif 4. mono: Geist Mono.',
  },
  {
    key: 'titleClean', kind: 'enum', options: ['compass', 'raw', 'comma', 'dot', 'spot'], default: 'compass',
    label: '“›” in titles', section: 'caption',
    description: 'Windy titles read "City › Compass: Spot". compass drops the "› Compass" part; comma / dot keep it with a quieter separator; spot shows only the spot name and moves the city down to the place line; raw shows the title as sent.',
  },
  {
    key: 'titleSize', kind: 'number', min: 10, max: 60, step: 1, default: 21,
    label: 'title size (px)', section: 'caption',
    description: 'The camera name.',
  },
  {
    key: 'titleWeight', kind: 'enum', options: ['300', '400', '500', '600'], default: '300',
    label: 'title weight', section: 'caption',
    description: '300 light, 400 regular, 500 medium, 600 semibold.',
  },
  {
    key: 'titleGray', kind: 'number', min: 40, max: 100, step: 1, default: 71,
    label: 'title gray (%)', section: 'caption',
    description: '100 is white.',
  },
  {
    key: 'placeSize', kind: 'number', min: 8, max: 40, step: 1, default: 17,
    label: 'place size (px)', section: 'caption',
    description: 'The region and country line.',
  },
  {
    key: 'placeGray', kind: 'number', min: 30, max: 100, step: 1, default: 57,
    label: 'place gray (%)', section: 'caption',
    description: '100 is white.',
  },
  {
    key: 'lineGap', kind: 'number', min: 0, max: 24, step: 1, default: 0,
    label: 'line gap (px)', section: 'caption',
    description: 'Extra space between the caption\'s lines.',
  },
  {
    key: 'timeStyle', kind: 'enum', options: ['off', '12h', '12h-there', '24h', 'sun', '12h-sun'], default: '12h-there',
    label: 'time', section: 'caption',
    description: 'The local clock at the camera when the picture was taken (12h → "7:42 pm", 12h-there → "7:42 pm there", 24h → "19:42"), the sun\'s height ("sun 1.2° above the horizon"), or both.',
  },
  {
    key: 'timeLine', kind: 'enum', options: ['own', 'inline'], default: 'own',
    label: 'time placement', section: 'caption',
    description: 'own: the time on its own line under the place. inline: after the place with a middle dot.',
  },
  {
    key: 'timeSize', kind: 'number', min: 8, max: 32, step: 1, default: 12,
    label: 'time size (px)', section: 'caption',
    description: 'The time line.',
  },
  {
    key: 'timeGray', kind: 'number', min: 20, max: 90, step: 1, default: 46,
    label: 'time gray (%)', section: 'caption',
    description: '100 would be white; keep it quieter than the place.',
  },
] as const;

/** Typed view of a merged `solo` values object (mergeSettings output). */
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
    captionLayout: values.captionLayout as CaptionLayout,
    pictureHeight: values.pictureHeight as number,
    pictureTop: values.pictureTop as number,
    captionAnchor: values.captionAnchor as CaptionAnchor,
    captionAlign: values.captionAlign as CaptionAlign,
    captionGap: values.captionGap as number,
    font: values.font as CaptionFont,
    titleClean: values.titleClean as TitleClean,
    titleSize: values.titleSize as number,
    titleWeight: values.titleWeight as TitleWeight,
    titleGray: values.titleGray as number,
    placeSize: values.placeSize as number,
    placeGray: values.placeGray as number,
    lineGap: values.lineGap as number,
    timeStyle: values.timeStyle as TimeStyle,
    timeLine: values.timeLine as TimeLine,
    timeSize: values.timeSize as number,
    timeGray: values.timeGray as number,
  };
}
