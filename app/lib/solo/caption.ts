import type { SoloDials, TimeStyle, TitleClean, CaptionFont } from './types';

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

/** What the glass writes for a frame. Null when the place dial is off. */
export function captionLines(
  e: CaptionEntry, d: Pick<SoloDials, 'showPlace' | 'timeStyle' | 'titleClean'>,
): CaptionLines | null {
  if (!d.showPlace) return null;
  const t = displayTitle(e.title, d.titleClean);
  const place = [t.city, e.region, e.country].filter(Boolean).join(', ');
  const time = formatTime(d.timeStyle, e.capturedAt, e.timezone, e.sunAltitudeDeg) ?? '';
  return { title: t.title, place, time, sub: [place, time].filter(Boolean).join(' · ') };
}

export interface Rect { left: number; top: number; width: number; height: number }

/** Caption sizes are glass pixels on a 1920-wide panel. */
export const GLASS_WIDTH = 1920;
export const captionScale = (panelWidth: number) => panelWidth / GLASS_WIDTH;

/**
 * Where the picture sits on a panel of `width` × `height` CSS pixels. Overlay
 * fills the panel; inset keeps the panel's aspect at `pictureHeight` percent
 * of its height, centred, `pictureTop` percent down from the top edge.
 */
export function pictureRect(
  d: Pick<SoloDials, 'captionLayout' | 'pictureHeight' | 'pictureTop'>, width: number, height: number,
): Rect {
  if (d.captionLayout === 'overlay') return { left: 0, top: 0, width, height };
  const h = Math.round(height * d.pictureHeight / 100);
  const w = Math.round(h * (width / height));
  return { left: Math.round((width - w) / 2), top: Math.round(height * d.pictureTop / 100), width: w, height: h };
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

/**
 * Where the caption block sits, given the picture. Under-picture hangs it
 * `captionGap` below the picture; panel-bottom keeps it that far above the
 * panel's bottom edge. Overlay ignores both and tucks it inside the picture.
 */
export function captionBox(
  d: Pick<SoloDials, 'captionLayout' | 'captionAnchor' | 'captionAlign' | 'captionGap'>,
  picture: Rect, width: number,
): CaptionBox {
  const s = captionScale(width);
  if (d.captionLayout === 'overlay') return { left: 24 * s, bottom: 20 * s, textAlign: 'left', maxWidth: width - 48 * s };
  const gap = d.captionGap * s;
  const vertical = d.captionAnchor === 'under-picture'
    ? { top: picture.top + picture.height + gap }
    : { bottom: gap };
  switch (d.captionAlign) {
    case 'center': return { left: 0, width, textAlign: 'center', ...vertical };
    case 'panel': return { left: 24 * s, maxWidth: width - 48 * s, textAlign: 'left', ...vertical };
    default: return { left: picture.left, maxWidth: picture.width, textAlign: 'left', ...vertical };
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
