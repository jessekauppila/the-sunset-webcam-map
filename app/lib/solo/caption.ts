import type { Feed, HereTime, SoloDials, TimeStyle, TitleClean, CaptionFont } from './types';

/**
 * The caption under (or over) a solo frame: what it says and where it sits.
 * Pure, so the glass, the studio preview and the queue rows all agree, and
 * every number is testable without a DOM.
 *
 * Sizes in the caption dials are glass pixels on a 1920-wide panel; `scale`
 * turns them into CSS pixels for whatever panel is being drawn.
 */

/** The fields the caption needs; the glass and the studio both pass an EntryView. */
export interface CaptionEntry {
  title: string;
  region: string;
  country: string;
  capturedAt: number;
  timezone: string | null;
  sunAltitudeDeg: number | null;
}

function clock(capturedAt: number, timezone: string, hour12: boolean): string | null {
  try {
    const s = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: 'numeric', minute: '2-digit', hour12 })
      .format(new Date(capturedAt));
    // "7:42 PM" → "7:42 pm"; 24h comes back as "19:42".
    return s.replace(/\s?(AM|PM)$/i, (m) => ` ${m.trim().toLowerCase()}`).replace(/^24:/, '00:');
  } catch {
    return null; // an IANA name Intl does not know
  }
}

function sun(deg: number): string {
  const abs = Math.abs(deg).toFixed(1);
  return `sun ${abs}° ${deg >= 0 ? 'above' : 'below'} the horizon`;
}

/**
 * One piece of the time line. The line is drawn piece by piece rather than as
 * one string so that a step inside a camera run crossfades only the pieces
 * that actually changed: with the glass's own clock written beside the
 * camera's, the reading that moves sits in the middle of the line, and a
 * single split from the end would re-fade every word around it.
 *
 * `fade` is false for the punctuation between the readings, which never
 * animates. Segments carry no separator of their own: `text` is written
 * verbatim, in order, and the fixed segments are the spacing.
 */
export interface TimeSegment {
  text: string;
  fade: boolean;
}

/** Where the glass is, and how it wants its own clock written. */
export interface HereClock {
  style: HereTime;
  /** IANA name of the glass's own zone; null when it cannot be resolved. */
  timezone: string | null;
}

/** The glass's own zone, or null where Intl cannot say (a test, an odd runtime). */
export function localTimezone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

/**
 * How each shape attaches the here reading: what goes before it, whether it
 * says the word, and what closes it. Kept as data so the studio's dial and
 * the glass cannot drift apart about what a shape looks like.
 */
const HERE_SHAPES: Record<Exclude<HereTime, 'off'>, { open: string; word: boolean; close: string }> = {
  dot: { open: ' · ', word: true, close: '' },
  parens: { open: ' (', word: true, close: ')' },
  'parens-bare': { open: ' (', word: false, close: ')' },
  dash: { open: ' — ', word: true, close: '' },
  comma: { open: ', ', word: true, close: '' },
};

/**
 * The camera's half of the time line for one style (solo2 spec §4.5), as
 * segments, or empty when there is nothing to say (style off, or the data
 * the style needs is missing).
 */
function thereSegments(
  style: TimeStyle, capturedAt: number, timezone: string | null, sunAltitudeDeg: number | null,
): TimeSegment[] {
  const twelve = timezone ? clock(capturedAt, timezone, true) : null;
  const sunPart = sunAltitudeDeg == null || !Number.isFinite(sunAltitudeDeg) ? null : sun(sunAltitudeDeg);
  const one = (text: string | null): TimeSegment[] => (text ? [{ text, fade: true }] : []);
  switch (style) {
    case 'off': return [];
    case '12h': return one(twelve);
    case '12h-there': return one(twelve ? `${twelve} there` : null);
    case '24h': return one(timezone ? clock(capturedAt, timezone, false) : null);
    case 'sun': return one(sunPart);
    case '12h-sun': {
      const parts = [twelve, sunPart].filter(Boolean) as string[];
      return parts.flatMap((text, i) => (i === 0 ? [{ text, fade: true }] : [{ text: ' · ', fade: false }, { text, fade: true }]));
    }
  }
}

/**
 * The whole time line as segments: the camera's reading, then the glass's own
 * clock on the same instant when the here dial asks for it.
 *
 * The here half is dropped when the two zones read the same clock — a camera
 * in your own zone would otherwise say the time twice — and when the there
 * half said nothing at all, since there is nothing for it to sit beside.
 */
export function timeSegments(
  style: TimeStyle, capturedAt: number, timezone: string | null, sunAltitudeDeg: number | null,
  here?: HereClock,
): TimeSegment[] {
  const there = thereSegments(style, capturedAt, timezone, sunAltitudeDeg);
  if (!here || here.style === 'off' || !here.timezone || there.length === 0) return there;
  const mine = clock(capturedAt, here.timezone, true);
  if (!mine) return there;
  if (timezone && mine === clock(capturedAt, timezone, true)) return there; // same zone; it is one clock
  const shape = HERE_SHAPES[here.style];
  return [
    ...there,
    { text: shape.open, fade: false },
    { text: shape.word ? `${mine} here` : mine, fade: true },
    ...(shape.close ? [{ text: shape.close, fade: false }] : []),
  ];
}

/** The segments written out, or '' when there are none. */
export const timeText = (segments: TimeSegment[]): string => segments.map((s) => s.text).join('');

/**
 * The time part of the caption as one string, or null when there is nothing
 * to say. The glass draws segments; this is for the readouts that want a
 * plain line.
 */
export function formatTime(
  style: TimeStyle, capturedAt: number, timezone: string | null, sunAltitudeDeg: number | null,
  here?: HereClock,
): string | null {
  return timeText(timeSegments(style, capturedAt, timezone, sunAltitudeDeg, here)) || null;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

/**
 * Windy titles come as "City › Compass: Spot name". The compass says where
 * the camera sits relative to the city ("Split › West" is on Split's west
 * side); on glass it reads as noise. Each mode is one way to tidy it. `city`
 * is set only when the mode moves the city off the title line ('spot'), so
 * the caller can put it on the place line instead.
 */
export function displayTitle(raw: string, mode: TitleClean): { title: string; city: string | null } {
  const m = raw.match(/^(.*?)(?:\s*›\s*([^:]*))?(?::\s*(.*))?$/);
  if (mode === 'raw' || !m) return { title: raw, city: null };
  const city = m[1].trim();
  const compass = (m[2] ?? '').trim();
  const spot = (m[3] ?? '').trim();
  const spotPart = spot && norm(spot) !== norm(city) ? spot : ''; // "Toussus-le-Noble: Toussus Le Noble" says it once
  const withSpot = (head: string) => (spotPart ? `${head}: ${spotPart}` : head);
  switch (mode) {
    case 'comma': return { title: withSpot([city, compass].filter(Boolean).join(', ')), city: null };
    case 'dot': return { title: withSpot([city, compass].filter(Boolean).join(' · ')), city: null };
    case 'compass': return { title: withSpot(city), city: null };
    case 'spot': return spotPart ? { title: spotPart, city } : { title: city, city: null };
  }
}

export interface CaptionLines {
  title: string;
  /** City (when the title mode moved it down), region and country, comma-joined. */
  place: string;
  /** The formatted time, or '' when the style or the data says nothing. */
  time: string;
  /** The same time, piece by piece, so the glass can crossfade each piece on its own. */
  timeParts: TimeSegment[];
  /** place · time on one line, for the studio's compact readouts. */
  sub: string;
}

/** The screen's name before the title when the prefix dial is on. */
export const FEED_PREFIX: Record<Feed, string> = { sunrise: 'Sunrise: ', sunset: 'Sunset: ' };

/**
 * What the glass writes for a frame. Null when the place dial is off. `feed`
 * is the screen the caption is for; with the prefix dial on, the title
 * begins with its name (camera-run spec §6.2).
 */
export function captionLines(
  e: CaptionEntry, d: Pick<SoloDials, 'showPlace' | 'timeStyle' | 'hereTime' | 'titleClean' | 'feedPrefix'>,
  feed?: Feed, hereTimezone?: string | null,
): CaptionLines | null {
  if (!d.showPlace) return null;
  const t = displayTitle(e.title, d.titleClean);
  const prefix = d.feedPrefix && feed ? FEED_PREFIX[feed] : '';
  const place = [t.city, e.region, e.country].filter(Boolean).join(', ');
  const timeParts = timeSegments(d.timeStyle, e.capturedAt, e.timezone, e.sunAltitudeDeg, {
    style: d.hereTime, timezone: hereTimezone === undefined ? localTimezone() : hereTimezone,
  });
  const time = timeText(timeParts);
  return { title: prefix + t.title, place, time, timeParts, sub: [place, time].filter(Boolean).join(' · ') };
}

export interface Rect { left: number; top: number; width: number; height: number }

/** Caption sizes are glass pixels on a 1920-wide panel. */
export const GLASS_WIDTH = 1920;
export const captionScale = (panelWidth: number) => panelWidth / GLASS_WIDTH;

/**
 * Where the picture sits on a panel of `width` × `height` CSS pixels. Overlay
 * fills the panel; inset keeps the panel's aspect at `pictureHeight` percent
 * of its height, locked on the panel's centre both ways (camera-run spec
 * §6.1), so the height dial grows it about its middle.
 *
 * `pictureShift` then slides that centre up or down by a percent of the
 * panel's height. The caption hangs off the picture's foot, so the shift
 * carries the words with the picture: one block to balance, not two things
 * to line up.
 */
export function pictureRect(
  d: Pick<SoloDials, 'captionLayout' | 'pictureHeight' | 'pictureShift'>, width: number, height: number,
): Rect {
  if (d.captionLayout === 'overlay') return { left: 0, top: 0, width, height };
  const h = Math.round(height * d.pictureHeight / 100);
  const w = Math.round(h * (width / height));
  const shift = Math.round(height * d.pictureShift / 100);
  return { left: Math.round((width - w) / 2), top: Math.round((height - h) / 2) + shift, width: w, height: h };
}

/**
 * One reading and the reading it replaces, split into the characters they
 * share at each end and the stretch between that actually moved.
 *
 * Character by character, not word by word: "7:22 pm there" → "7:32 pm there"
 * moves one digit, so `lead` holds "7:", `tail` holds "2 pm there", and only
 * "2" → "3" crossfades. Comparing words would have faded the whole "7:22",
 * carrying the hour and the colon along with the minute that changed. The
 * time is drawn in tabular figures, so a digit swapped mid-number lands in
 * exactly the same place and nothing beside it shifts.
 *
 * Both ends stop one character short of consuming a reading, so there is
 * always something in the middle to fade even when the two are the same.
 */
export interface TimeSplit {
  /** What both readings begin with; never animates. */
  lead: string;
  /** The stretch that moved, on its way out and on its way in. */
  fromMid: string;
  toMid: string;
  /** What both readings end with; never animates. */
  tail: string;
}

export function splitTime(from: string, to: string): TimeSplit {
  const room = Math.min(from.length, to.length) - 1;
  let lead = 0;
  while (lead < room && from[lead] === to[lead]) lead++;
  let tail = 0;
  while (lead + tail < room && from[from.length - 1 - tail] === to[to.length - 1 - tail]) tail++;
  return {
    lead: to.slice(0, lead),
    fromMid: from.slice(lead, from.length - tail),
    toMid: to.slice(lead, to.length - tail),
    tail: tail ? to.slice(to.length - tail) : '',
  };
}

/**
 * The two readings of one time line, matched piece for piece, so the glass
 * can fade each piece against the one it replaces. Pieces line up when the
 * two readings have the same shape, which is the normal case inside a camera
 * run; when they do not — a frame that knows the sun's height beside one that
 * does not — the whole line is treated as a single piece and crossfades as
 * one, which is what it did before there were pieces.
 *
 * `from` null means there is nothing to fade from, so nothing animates.
 */
export interface TimePair { from: string; to: string; fade: boolean }

export function pairTimeSegments(from: TimeSegment[] | null, to: TimeSegment[]): TimePair[] {
  if (!from) return to.map((s) => ({ from: s.text, to: s.text, fade: false }));
  const aligned = from.length === to.length && to.every((s, i) => s.fade === from[i].fade);
  if (aligned) return to.map((s, i) => ({ from: from[i].text, to: s.text, fade: s.fade }));
  return [{ from: timeText(from), to: timeText(to), fade: true }];
}

export interface CaptionBox {
  left: number;
  /** Exactly one of top / bottom is set, in CSS pixels from the panel edge. */
  top?: number;
  bottom?: number;
  /** Set when the caption is centred, so the text can centre in it. */
  width?: number;
  maxWidth?: number;
  textAlign: 'left' | 'center';
}

/** Line heights the caption draws with, as multiples of each line's font size. Caption.tsx uses these. */
export const LINE_HEIGHT = { title: 1.15, place: 1.3, time: 1.3 } as const;

/**
 * The space above each caption line, in glass pixels: nothing above the first
 * line, `lineGap` above any line after it, and `timeGap` on top of that above
 * the time when the time has a line of its own. Caption.tsx draws these as
 * margins and captionHeight adds them up, so the two always agree about how
 * far the block reaches.
 */
export function lineGaps(
  d: Pick<SoloDials, 'lineGap' | 'timeGap'>,
): { place: number; time: number } {
  return { place: d.lineGap, time: d.lineGap + d.timeGap };
}

/**
 * How tall the caption block will be, in CSS pixels at scale `s`: the lines
 * that will exist (the title always; the place line when there is a place or
 * an inline time; the time on its own line unless inline) at the line heights
 * Caption draws with, plus the gap above each line after the first.
 */
export function captionHeight(
  d: Pick<SoloDials, 'titleSize' | 'placeSize' | 'timeSize' | 'lineGap' | 'timeGap' | 'timeLine'>,
  lines: Pick<CaptionLines, 'place' | 'time'>, s: number,
): number {
  const inline = d.timeLine === 'inline';
  const gaps = lineGaps(d);
  let total = d.titleSize * LINE_HEIGHT.title;
  if (lines.place || (inline && lines.time)) total += gaps.place + d.placeSize * LINE_HEIGHT.place;
  if (!inline && lines.time) total += gaps.time + d.timeSize * LINE_HEIGHT.time;
  return total * s;
}

/**
 * Where the caption block sits, given the picture and the panel. Inset hangs
 * it `captionGap` below the picture's foot, always (camera-run spec §6.1):
 * the gap is measured from the picture, whatever its height, so dragging
 * the height dial moves the caption with the picture and nothing else. When
 * the panel cannot hold both, the caption leaves the panel, which the studio
 * preview shows for what it is: a picture dial set too tall. Overlay ignores
 * all of this and tucks the caption inside the picture.
 */
export function captionBox(
  d: Pick<SoloDials, 'captionLayout' | 'captionAlign' | 'captionGap'>,
  picture: Rect, width: number,
): CaptionBox {
  const s = captionScale(width);
  if (d.captionLayout === 'overlay') return { left: 24 * s, bottom: 20 * s, textAlign: 'left', maxWidth: width - 48 * s };
  const top = picture.top + picture.height + d.captionGap * s;
  switch (d.captionAlign) {
    case 'center': return { left: 0, width, textAlign: 'center', top };
    case 'panel': return { left: 24 * s, maxWidth: width - 48 * s, textAlign: 'left', top };
    default: return { left: picture.left, maxWidth: picture.width, textAlign: 'left', top };
  }
}

/** A percent of white, for the gray dials. */
export const gray = (pct: number) => {
  const v = Math.round(255 * Math.min(100, Math.max(0, pct)) / 100);
  return `rgb(${v}, ${v}, ${v})`;
};

/**
 * CSS font stacks per font dial. Geist and its mono come from the root
 * layout's variables; the two Source faces are loaded by soloFonts.ts, which
 * the kiosk layout and the solo studio pages apply. Every stack ends in a
 * real fallback so a page without the variables still draws.
 */
export const FONT_STACKS: Record<CaptionFont, string> = {
  system: 'system-ui, -apple-system, "Segoe UI", "Noto Sans", "DejaVu Sans", sans-serif',
  geist: 'var(--font-geist-sans), system-ui, sans-serif',
  sans: 'var(--solo-font-sans), "Source Sans 3", system-ui, sans-serif',
  serif: 'var(--solo-font-serif), "Source Serif 4", Georgia, "Times New Roman", serif',
  mono: 'var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, monospace',
};

/**
 * The still Windy publishes per camera (`images.current.preview`), which is
 * what the cron stores and every solo frame is drawn from. On a 1920-wide
 * panel at the default picture height it is blown up about 4×; the studio
 * says so beside the picture dial rather than letting the softness read as
 * compression.
 */
export const SOURCE_FRAME = { width: 400, height: 224 } as const;

/** How many times larger than the source the picture is drawn: 1 is pixel-for-pixel. */
export function drawFactor(picture: Pick<Rect, 'width'>, source: { width: number } = SOURCE_FRAME): number {
  return picture.width / source.width;
}
