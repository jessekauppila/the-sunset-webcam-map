import { mergeSettings } from '@/app/lib/settings/schema';
import type { SettingsSchema, SettingsValues } from '@/app/lib/settings/schema';
import type {
  CaptionAlign, CaptionAnchor, CaptionDials, CaptionFont, CaptionLayout, TimeLine, TimeStyle, TitleClean, TitleWeight,
} from './types';

/** The rail section every caption knob sits in. */
export const CAPTION_SECTION = 'caption';

/**
 * The caption dials: the picture's frame on black and the words beneath it.
 *
 * They live in the SHARED settings namespace (sharedSchema.ts spreads them
 * in), not in a version's, because the glass draws one caption whichever
 * solo engine picks the frame. Each version carrying its own copy let the two
 * drift: on 2026-09-05 the live `solo` row said pictureHeight 92 while
 * `solo2` sat at the default 87, so the solo2 studio previewed a caption the
 * glass, running solo, never drew. A stored caption key in a version's row
 * is now unknown to that version's schema and is dropped on merge.
 *
 * Defaults are the values dialled in on the 2026-09-05 mockup. Sizes are
 * glass pixels on a 1920-wide panel; grays are percent of white.
 */
export const CAPTION_SCHEMA: SettingsSchema = [
  {
    key: 'captionLayout', kind: 'enum', options: ['inset', 'overlay'], default: 'inset',
    label: 'layout', section: CAPTION_SECTION,
    description: 'Inset: the picture sits smaller on black with the caption beneath it. Overlay: the picture fills the panel and the caption floats over it.',
  },
  {
    key: 'pictureHeight', kind: 'number', min: 20, max: 100, step: 1, default: 87,
    label: 'picture height (%)', section: CAPTION_SECTION,
    description: 'How tall the inset picture is, as a percent of the panel. It keeps the panel\'s shape and sits centred. Frames arrive at 400 × 224, so the readout beneath says how far the picture is blown up; 1× is pixel-for-pixel. The caption never rises into the picture: one too tall for the caption pushes the caption down, and past what the panel can hold, off it.',
  },
  {
    key: 'pictureTop', kind: 'number', min: 0, max: 12, step: 0.5, default: 4,
    label: 'picture top margin (%)', section: CAPTION_SECTION,
    description: 'Black above the inset picture, as a percent of the panel height.',
  },
  {
    key: 'captionAnchor', kind: 'enum', options: ['panel-bottom', 'under-picture'], default: 'panel-bottom',
    label: 'caption sits', section: CAPTION_SECTION,
    description: 'panel-bottom: the gap above the bottom edge of the panel, but never higher than the gap below the picture. under-picture: the gap below the picture.',
  },
  {
    key: 'captionAlign', kind: 'enum', options: ['picture', 'center', 'panel'], default: 'picture',
    label: 'caption aligned to', section: CAPTION_SECTION,
    description: 'Flush with the picture\'s left edge, centred on the panel, or at the panel\'s left margin.',
  },
  {
    key: 'captionGap', kind: 'number', min: 0, max: 80, step: 2, default: 18,
    label: 'gap (px)', section: CAPTION_SECTION,
    description: 'Space between the caption and whatever it is anchored to.',
  },
  {
    key: 'font', kind: 'enum', options: ['system', 'geist', 'sans', 'serif', 'mono'], default: 'system',
    label: 'font', section: CAPTION_SECTION,
    description: 'system: whatever the Pi has. geist: the site\'s face. sans: Source Sans 3. serif: Source Serif 4. mono: Geist Mono.',
  },
  {
    key: 'titleClean', kind: 'enum', options: ['compass', 'raw', 'comma', 'dot', 'spot'], default: 'compass',
    label: '“›” in titles', section: CAPTION_SECTION,
    description: 'Windy titles read "City › Compass: Spot". compass drops the "› Compass" part; comma / dot keep it with a quieter separator; spot shows only the spot name and moves the city down to the place line; raw shows the title as sent.',
  },
  {
    key: 'titleSize', kind: 'number', min: 10, max: 60, step: 1, default: 21,
    label: 'title size (px)', section: CAPTION_SECTION,
    description: 'The camera name.',
  },
  {
    key: 'titleWeight', kind: 'enum', options: ['300', '400', '500', '600'], default: '300',
    label: 'title weight', section: CAPTION_SECTION,
    description: '300 light, 400 regular, 500 medium, 600 semibold.',
  },
  {
    key: 'titleGray', kind: 'number', min: 40, max: 100, step: 1, default: 71,
    label: 'title gray (%)', section: CAPTION_SECTION,
    description: '100 is white.',
  },
  {
    key: 'placeSize', kind: 'number', min: 8, max: 40, step: 1, default: 17,
    label: 'place size (px)', section: CAPTION_SECTION,
    description: 'The region and country line.',
  },
  {
    key: 'placeGray', kind: 'number', min: 30, max: 100, step: 1, default: 57,
    label: 'place gray (%)', section: CAPTION_SECTION,
    description: '100 is white.',
  },
  {
    key: 'lineGap', kind: 'number', min: 0, max: 24, step: 1, default: 0,
    label: 'line gap (px)', section: CAPTION_SECTION,
    description: 'Extra space between the caption\'s lines.',
  },
  {
    key: 'timeStyle', kind: 'enum', options: ['off', '12h', '12h-there', '24h', 'sun', '12h-sun'], default: '12h-there',
    label: 'time', section: CAPTION_SECTION,
    description: 'The local clock at the camera when the picture was taken (12h → "7:42 pm", 12h-there → "7:42 pm there", 24h → "19:42"), the sun\'s height ("sun 1.2° above the horizon"), or both.',
  },
  {
    key: 'timeLine', kind: 'enum', options: ['own', 'inline'], default: 'own',
    label: 'time placement', section: CAPTION_SECTION,
    description: 'own: the time on its own line under the place. inline: after the place with a middle dot.',
  },
  {
    key: 'timeSize', kind: 'number', min: 8, max: 32, step: 1, default: 12,
    label: 'time size (px)', section: CAPTION_SECTION,
    description: 'The time line.',
  },
  {
    key: 'timeGray', kind: 'number', min: 20, max: 90, step: 1, default: 46,
    label: 'time gray (%)', section: CAPTION_SECTION,
    description: '100 would be white; keep it quieter than the place.',
  },
] as const;

/** Typed view of merged caption values (mergeSettings over CAPTION_SCHEMA). */
export function captionDialsFrom(values: SettingsValues): CaptionDials {
  return {
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

/**
 * A version's merged values with the caption laid over them from the shared
 * namespace (its deviations or its merged values; both sanitize the same, and
 * nothing else in `shared` is a caption key). Every SoloDials a surface draws
 * with goes through this, so the glass, the state route and both studios
 * caption alike. Without `shared` the caption is at its defaults.
 */
export function withCaption(values: SettingsValues, shared?: SettingsValues): SettingsValues {
  return { ...values, ...mergeSettings(CAPTION_SCHEMA, shared) };
}
