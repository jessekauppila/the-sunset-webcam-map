import type { Solo2Dials, TimeStyle } from './types';

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
 * The trailing item of the caption's second line for one time style (spec
 * §4.5), or null when there is nothing to say (style off, or the data the
 * style needs is missing).
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

/**
 * What the glass writes under a frame: the camera's title, then region and
 * country with the time after a middle dot. Null when the place dial is off.
 */
export function captionLines(
  e: CaptionEntry, d: Pick<Solo2Dials, 'showPlace' | 'timeStyle'>,
): { title: string; sub: string } | null {
  if (!d.showPlace) return null;
  const place = [e.region, e.country].filter(Boolean).join(', ');
  const time = formatTime(d.timeStyle, e.capturedAt, e.timezone, e.sunAltitudeDeg);
  return { title: e.title, sub: [place, time].filter(Boolean).join(' · ') };
}
