import { mergeSettings } from '@/app/lib/settings/schema';
import type { SettingsSchema, SettingsValues } from '@/app/lib/settings/schema';
import type {
  CaptionAlign, CaptionDials, CaptionFont, CaptionLayout, TimeLine, TimeStyle, TitleClean, TitleWeight,
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
    description: 'How tall the inset picture is, as a percent of the panel. It keeps the panel\'s shape and stays locked on the panel\'s centre. Frames arrive at 400 × 224, so the readout beneath says how far the picture is blown up; 1× is pixel-for-pixel. The caption hangs the gap below the picture; set too tall, it leaves the panel, and the preview shows that.',
  },
  {
    key: 'pictureShift', kind: 'number', min: -15, max: 15, step: 1, default: 0,
    label: 'nudge up / down (%)', section: CAPTION_SECTION,
    description: 'Moves the picture and its caption together, as a percent of the panel\'s height: negative up, positive down. The gap between them does not change, so the pair balances on the panel as one block. Inset only; overlay fills the panel.',
  },
  {
    key: 'captionAlign', kind: 'enum', options: ['picture', 'center', 'panel'], default: 'picture',
    label: 'caption aligned to', section: CAPTION_SECTION,
    description: 'Flush with the picture\'s left edge, centred on the panel, or at the panel\'s left margin.',
  },
  {
    key: 'captionGap', kind: 'number', min: 0, max: 80, step: 2, default: 18,
    label: 'gap (px)', section: CAPTION_SECTION,
    description: 'Space between the bottom of the picture and the caption.',
  },
  {
    key: 'feedPrefix', kind: 'boolean', default: true,
    label: 'screen name', section: CAPTION_SECTION,
    description: 'Begin the title with the screen\'s name: "Sunrise: " on the left screen, "Sunset: " on the right.',
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
    key: 'titleGray', kind: 'number', min: 0, max: 100, step: 1, default: 71,
    label: 'title gray (%)', section: CAPTION_SECTION,
    description: '100 is white.',
  },
  {
    key: 'placeSize', kind: 'number', min: 8, max: 40, step: 1, default: 17,
    label: 'place size (px)', section: CAPTION_SECTION,
    description: 'The region and country line.',
  },
  {
    key: 'placeGray', kind: 'number', min: 0, max: 100, step: 1, default: 57,
    label: 'place gray (%)', section: CAPTION_SECTION,
    description: '100 is white.',
  },
  {
    key: 'lineGap', kind: 'number', min: 0, max: 24, step: 1, default: 0,
    label: 'line gap (px)', section: CAPTION_SECTION,
    description: 'Extra space above every caption line after the first.',
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
    key: 'timeGap', kind: 'number', min: 0, max: 60, step: 1, default: 0,
    label: 'time gap (px)', section: CAPTION_SECTION,
    description: 'Extra space above the time line only, on top of the line gap, so the time can sit apart from the title and the place instead of evenly under them. Nothing when the time is inline.',
  },
  {
    key: 'timeSize', kind: 'number', min: 8, max: 32, step: 1, default: 12,
    label: 'time size (px)', section: CAPTION_SECTION,
    description: 'The time line.',
  },
  {
    key: 'timeGray', kind: 'number', min: 0, max: 90, step: 1, default: 46,
    label: 'time gray (%)', section: CAPTION_SECTION,
    description: '100 would be white; keep it quieter than the place.',
  },
] as const;

/**
 * The three title / place / time dials the studio can drive as one, per
 * group. Editing state, not glass state: the caption draws from three
 * independent numbers whether or not the studio was linking them, so nothing
 * about a link is stored or deployed.
 */
export const LINKED_CAPTION_KEYS = {
  size: ['titleSize', 'placeSize', 'timeSize'],
  gray: ['titleGray', 'placeGray', 'timeGray'],
} as const;

export type LinkedCaptionGroup = keyof typeof LINKED_CAPTION_KEYS;

/** Which linked group a caption key belongs to, or null for the rest of them. */
export function linkedCaptionGroup(key: string): LinkedCaptionGroup | null {
  for (const group of Object.keys(LINKED_CAPTION_KEYS) as LinkedCaptionGroup[]) {
    if ((LINKED_CAPTION_KEYS[group] as readonly string[]).includes(key)) return group;
  }
  return null;
}

const CAPTION_KNOBS = new Map(CAPTION_SCHEMA.map((k) => [k.key, k]));

/**
 * What the other two dials of a linked group become when one of them moves
 * from its value in `values` to `next`. Sizes are pixels, so they scale by
 * the same ratio and the hierarchy between the three lines survives a drag;
 * grays are already percents of white, so they shift by the same number of
 * points and the contrast steps between the lines survive one. Each result is
 * rounded and clamped into its own dial's range, so a line that reaches an
 * end stops there while the others keep moving — dragging back does not
 * restore it, which is what a slider that has hit its floor should do.
 */
export function linkedCaptionValues(
  group: LinkedCaptionGroup, changed: string, next: number, values: SettingsValues,
): Record<string, number> {
  const out: Record<string, number> = {};
  const from = Number(values[changed]);
  if (!Number.isFinite(from) || !Number.isFinite(next) || from === next) return out;
  for (const key of LINKED_CAPTION_KEYS[group]) {
    if (key === changed) continue;
    const knob = CAPTION_KNOBS.get(key);
    const was = Number(values[key]);
    if (!knob || knob.kind !== 'number' || !Number.isFinite(was)) continue;
    const moved = group === 'size' ? (from === 0 ? was : was * next / from) : was + (next - from);
    out[key] = Math.min(knob.max, Math.max(knob.min, Math.round(moved)));
  }
  return out;
}

/** Typed view of merged caption values (mergeSettings over CAPTION_SCHEMA). */
export function captionDialsFrom(values: SettingsValues): CaptionDials {
  return {
    captionLayout: values.captionLayout as CaptionLayout,
    pictureHeight: values.pictureHeight as number,
    pictureShift: values.pictureShift as number,
    captionAlign: values.captionAlign as CaptionAlign,
    captionGap: values.captionGap as number,
    font: values.font as CaptionFont,
    feedPrefix: values.feedPrefix as boolean,
    titleClean: values.titleClean as TitleClean,
    titleSize: values.titleSize as number,
    titleWeight: values.titleWeight as TitleWeight,
    titleGray: values.titleGray as number,
    placeSize: values.placeSize as number,
    placeGray: values.placeGray as number,
    lineGap: values.lineGap as number,
    timeStyle: values.timeStyle as TimeStyle,
    timeLine: values.timeLine as TimeLine,
    timeGap: values.timeGap as number,
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
