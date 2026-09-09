import { mergeSettings } from '@/app/lib/settings/schema';
import type { SettingsSchema, SettingsValues } from '@/app/lib/settings/schema';
import type {
  CaptionAlign, CaptionDials, CaptionFont, CaptionLayout, LineOrder, TimeLine, TimeStyle,
  TitleClean, TitleWeight,
} from './types';

/** The rail section every caption knob sits in. */
export const CAPTION_SECTION = 'caption';

/**
 * The caption knobs, gathered by what they act on rather than listed by
 * property. A flat list interleaves the three lines — every size, then
 * every brightness — which is not how anyone thinks about a caption or
 * reaches for a dial mid-show. The lines come first because they are what
 * gets turned on the day.
 */
export const CAPTION_BANDS = [
  { id: 'time', label: 'time', hint: 'The line that says how recent the frame is, and names the crossing once it has happened.' },
  { id: 'name', label: 'name', hint: 'The camera\u2019s own line: "City: Spot".' },
  { id: 'region', label: 'region', hint: 'The county and country under the name.' },
  { id: 'all', label: 'all three lines', hint: 'What every line shares: the face, its weight, the letter spacing, and which line leads.' },
  { id: 'picture', label: 'the picture', hint: 'Where the picture sits on the panel and how far the words hang below it.' },
] as const;

export type CaptionBand = typeof CAPTION_BANDS[number]['id'];

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
    label: 'layout', section: CAPTION_SECTION, band: 'picture',
    description: 'Inset: the picture sits smaller on black with the caption beneath it. Overlay: the picture fills the panel and the caption floats over it.',
  },
  {
    key: 'pictureHeight', kind: 'number', min: 20, max: 100, step: 1, default: 87,
    label: 'picture height (%)', section: CAPTION_SECTION, band: 'picture',
    description: 'How tall the inset picture is, as a percent of the panel. It keeps the panel\'s shape and stays locked on the panel\'s centre. Frames arrive at 400 × 224, so the readout beneath says how far the picture is blown up; 1× is pixel-for-pixel. The caption hangs the gap below the picture; set too tall, it leaves the panel, and the preview shows that.',
  },
  {
    key: 'pictureShift', kind: 'number', min: -15, max: 15, step: 1, default: 0,
    label: 'nudge up / down (%)', section: CAPTION_SECTION, band: 'picture',
    description: 'Moves the picture and its caption together, as a percent of the panel\'s height: negative up, positive down. The gap between them does not change, so the pair balances on the panel as one block. Inset only; overlay fills the panel.',
  },
  {
    key: 'captionAlign', kind: 'enum', options: ['picture', 'center', 'panel'], default: 'picture',
    label: 'caption aligned to', section: CAPTION_SECTION, band: 'picture',
    description: 'Flush with the picture\'s left edge, centred on the panel, or at the panel\'s left margin.',
  },
  {
    key: 'captionGap', kind: 'number', min: 0, max: 80, step: 2, default: 18,
    label: 'gap (px)', section: CAPTION_SECTION, band: 'picture',
    description: 'Space between the bottom of the picture and the caption.',
  },
  {
    key: 'feedPrefix', kind: 'boolean', default: false,
    label: 'screen name', section: CAPTION_SECTION, band: 'all',
    description: 'Begin the title with the screen\'s name: "Sunrise: " on the left screen, "Sunset: " on the right.',
  },
  {
    key: 'font', kind: 'enum', options: ['atkinson', 'system', 'geist', 'sans', 'serif', 'mono'], default: 'atkinson',
    label: 'font', section: CAPTION_SECTION, band: 'all',
    description: 'atkinson: Atkinson Hyperlegible Next, drawn for low vision — no two letters confusable and the counters stay open, which is what holds a dim caption together across a room. system: whatever the Pi has. geist: the site\'s face. sans: Source Sans 3. serif: Source Serif 4. mono: Geist Mono.',
  },
  {
    key: 'lineOrder', kind: 'enum', options: ['time-first', 'name-first'], default: 'time-first',
    label: 'order', section: CAPTION_SECTION, band: 'all',
    description: 'time-first puts how recent the frame is above the camera name. The claim the piece makes is that a sun is going down somewhere right now, so the recency is the headline and the place is the answer to the question it provokes.',
  },
  {
    key: 'captionTrack', kind: 'number', min: -20, max: 60, step: 2, default: 6,
    label: 'letter spacing', section: CAPTION_SECTION, band: 'all',
    description: 'Thousandths of an em, for the whole block. Pale letters on black spread optically: the counters fill in and words start to read as a bar at distance. A little positive tracking resists that, and is worth more here than it would be on paper.',
  },
  {
    key: 'titleClean', kind: 'enum', options: ['compass', 'raw', 'comma', 'dot', 'spot'], default: 'compass',
    label: '“›” in titles', section: CAPTION_SECTION, band: 'name',
    description: 'Windy titles read "City › Compass: Spot". compass drops the "› Compass" part; comma / dot keep it with a quieter separator; spot shows only the spot name and moves the city down to the place line; raw shows the title as sent.',
  },
  {
    key: 'titleSize', kind: 'number', min: 10, max: 60, step: 1, default: 30,
    label: 'title size (px)', section: CAPTION_SECTION, band: 'name',
    description: 'The camera name.',
  },
  {
    key: 'titleWeight', kind: 'enum', options: ['300', '400', '500', '600'], default: '300',
    label: 'thickness', section: CAPTION_SECTION, band: 'all',
    description: 'Stroke weight for every caption line. As brightness falls the eye loses the fine parts of a letter first, so a thin weight at high grey gives out sooner than a normal weight at low grey — and the normal weight is the quieter of the two over a picture. 300 light, 400 regular, 500 medium, 600 semibold.',
  },
  {
    key: 'titleGray', kind: 'number', min: 0, max: 100, step: 1, default: 20,
    label: 'title gray (%)', section: CAPTION_SECTION, band: 'name',
    description: '100 is white.',
  },
  {
    key: 'placeSize', kind: 'number', min: 8, max: 60, step: 1, default: 22,
    label: 'place size (px)', section: CAPTION_SECTION, band: 'region',
    description: 'The region and country line.',
  },
  {
    key: 'placeGray', kind: 'number', min: 0, max: 100, step: 1, default: 20,
    label: 'place gray (%)', section: CAPTION_SECTION, band: 'region',
    description: '100 is white.',
  },
  {
    key: 'titleGap', kind: 'number', min: 0, max: 140, step: 1, default: 30,
    label: 'space above the name', section: CAPTION_SECTION, band: 'name',
    description: 'Glass pixels above the camera name, ignored when the name is the first line. Space costs no ink, so it is the cheapest way to say the time and the place are different kinds of fact.',
  },
  {
    key: 'placeGap', kind: 'number', min: 0, max: 140, step: 1, default: 0,
    label: 'space above the region', section: CAPTION_SECTION, band: 'region',
    description: 'Glass pixels above the region line, ignored when the region is the first line. Zero binds it to the name as one block.',
  },
  {
    key: 'timeStyle', kind: 'enum', options: ['sun-past', 'off', 'ago', '12h', '12h-there', '24h', 'sun', '12h-sun'], default: 'sun-past',
    label: 'time', section: CAPTION_SECTION, band: 'time',
    description: 'sun-past → names the crossing once it has happened ("Sunset 20 minutes ago"), and says how old the picture is before then. Only the past tense is printed: a ridge or a bank of cloud takes the sun away earlier than the almanac says but never later, so an elapsed time is safe over any picture while a countdown gets contradicted by the one it captions. ago → how long since the picture was taken ("13 minutes ago", "1 hour 5 minutes ago"). It says the sunset is happening somewhere else right now without asking anyone to convert a clock, and inside a camera run it counts down. The rest read the camera\'s own clock at the moment of the picture (12h → "7:42 pm", 12h-there → "7:42 pm there", 24h → "19:42"), the sun\'s height ("sun 1.2° above the horizon"), or both.',
  },
  {
    key: 'timeLine', kind: 'enum', options: ['own', 'inline'], default: 'own',
    label: 'time placement', section: CAPTION_SECTION, band: 'time',
    description: 'own: the time on its own line under the place. inline: after the place with a middle dot.',
  },
  {
    key: 'timeGap', kind: 'number', min: 0, max: 140, step: 1, default: 0,
    label: 'space above the time', section: CAPTION_SECTION, band: 'time',
    description: 'Extra space above the time line only, on top of the line gap, so the time can sit apart from the title and the place instead of evenly under them. It reaches a quarter of the panel, far enough to drop the time clear of the pair above it; past what the panel can hold the time leaves the panel, and the preview\u2019s amber edge shows where that is. Nothing when the time is inline.',
  },
  {
    key: 'timeSize', kind: 'number', min: 8, max: 60, step: 1, default: 30,
    label: 'time size (px)', section: CAPTION_SECTION, band: 'time',
    description: 'The time line.',
  },
  {
    key: 'timeGray', kind: 'number', min: 0, max: 90, step: 1, default: 20,
    label: 'time gray (%)', section: CAPTION_SECTION, band: 'time',
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
    lineOrder: values.lineOrder as LineOrder,
    captionTrack: values.captionTrack as number,
    titleSize: values.titleSize as number,
    titleWeight: values.titleWeight as TitleWeight,
    titleGray: values.titleGray as number,
    placeSize: values.placeSize as number,
    placeGray: values.placeGray as number,
    titleGap: values.titleGap as number,
    placeGap: values.placeGap as number,
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
