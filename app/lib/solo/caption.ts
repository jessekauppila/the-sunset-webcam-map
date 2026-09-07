import type { Feed, SoloDials, TimeStyle, TitleClean, CaptionFont } from './types';

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
 * The time part of the caption for one time style (solo2 spec §4.5), or
 * null when there is nothing to say (style off, or the data the style needs
 * is missing).
 */
export function formatTime(
  style: TimeStyle, capturedAt: number, timezone: string | null, sunAltitudeDeg: number | null,
): string | null {
  const twelve = timezone ? clock(capturedAt, timezone, true) : null;
  const sunPart = sunAltitudeDeg == null || !Number.isFinite(sunAltitudeDeg) ? null : sun(sunAltitudeDeg);
  switch (style) {
    case 'off': return null;
    case '12h': return twelve;
    case '12h-there': return twelve ? `${twelve} there` : null;
    case '24h': return timezone ? clock(capturedAt, timezone, false) : null;
    case 'sun': return sunPart;
    case '12h-sun': return [twelve, sunPart].filter(Boolean).join(' · ') || null;
  }
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
  e: CaptionEntry, d: Pick<SoloDials, 'showPlace' | 'timeStyle' | 'titleClean' | 'feedPrefix'>, feed?: Feed,
): CaptionLines | null {
  if (!d.showPlace) return null;
  const t = displayTitle(e.title, d.titleClean);
  const prefix = d.feedPrefix && feed ? FEED_PREFIX[feed] : '';
  const place = [t.city, e.region, e.country].filter(Boolean).join(', ');
  const time = formatTime(d.timeStyle, e.capturedAt, e.timezone, e.sunAltitudeDeg) ?? '';
  return { title: prefix + t.title, place, time, sub: [place, time].filter(Boolean).join(' · ') };
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
 * The two readings of the clock, split into the words that change and the
 * tail they share. "7:42 pm there" → "7:52 pm there" changes only "7:42", so
 * only that crossfades and "pm there" holds still; "sun 1.2° above the
 * horizon" keeps "above the horizon". Compared word by word from the end, so
 * a shared digit never splits a number, and the head keeps at least one word.
 */
export function splitTime(from: string, to: string): { fromHead: string; toHead: string; tail: string } {
  const a = from.split(' ');
  const b = to.split(' ');
  let shared = 0;
  while (shared < a.length - 1 && shared < b.length - 1 && a[a.length - 1 - shared] === b[b.length - 1 - shared]) shared++;
  return {
    fromHead: a.slice(0, a.length - shared).join(' '),
    toHead: b.slice(0, b.length - shared).join(' '),
    tail: b.slice(b.length - shared).join(' '),
  };
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
 * How tall the caption block will be, in CSS pixels at scale `s`: the lines
 * that will exist (the title always; the place line when there is a place or
 * an inline time; the time on its own line unless inline) at the line heights
 * Caption draws with, plus the line gap between them.
 */
export function captionHeight(
  d: Pick<SoloDials, 'titleSize' | 'placeSize' | 'timeSize' | 'lineGap' | 'timeLine'>,
  lines: Pick<CaptionLines, 'place' | 'time'>, s: number,
): number {
  const inline = d.timeLine === 'inline';
  const heights = [d.titleSize * LINE_HEIGHT.title];
  if (lines.place || (inline && lines.time)) heights.push(d.placeSize * LINE_HEIGHT.place);
  if (!inline && lines.time) heights.push(d.timeSize * LINE_HEIGHT.time);
  return (heights.reduce((a, b) => a + b, 0) + d.lineGap * (heights.length - 1)) * s;
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
