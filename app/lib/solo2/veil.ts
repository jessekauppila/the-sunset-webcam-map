import type { Feed } from '@/app/lib/solo/types';
import type { Solo2Dials, VeilTint, ArrivalEase, VeilCovers } from './types';

/**
 * What a camera change dips through, and how it eases (arrival-look spec).
 *
 * The four styles are pairs, one look per screen, because the whole point is
 * the asymmetry: a sunset ending in black is the story, a sunrise ending in
 * black is a sunrise playing backwards. Reported 2026-09-07: "narratively
 * this makes sense for sunsets, but sunrise should fade to white or crossfade
 * because it's becoming light."
 */

/** The tints the `light` style can dip a sunrise through. */
export const VEIL_TINTS: Record<VeilTint, string> = {
  white: '#ffffff',
  dawn: '#f4e6cf',
  sky: '#dfe6ee',
  dim: '#b9a892',
};

/**
 * The timing function both halves of a dissolve share.
 *
 * Every curve here is point-symmetric about (0.5, 0.5) — the mirror of
 * (x1, y1) is (1 - x1, 1 - y1) — and that is not decoration. A dissolve is two
 * animations, one leaving and one arriving, and they only stay matched while
 * they are the same shape run in opposite directions. An eased arrival against
 * a linear departure lands in a third of the time it left in (PR #160,
 * 2026-09-06). Adding a curve that is not symmetric here reintroduces that bug
 * for every style at once, so `easingIsSymmetric` guards the table.
 */
export const ARRIVAL_EASES: Record<ArrivalEase, string> = {
  linear: 'linear',
  gentle: 'cubic-bezier(0.4, 0, 0.6, 1)',
  soft: 'cubic-bezier(0.65, 0, 0.35, 1)',
};

/** The control points of a cubic-bezier easing, or null for a keyword. */
export function bezierPoints(css: string): [number, number, number, number] | null {
  const m = css.match(/^cubic-bezier\(([^)]+)\)$/);
  if (!m) return null;
  const n = m[1].split(',').map((v) => Number(v.trim()));
  return n.length === 4 && n.every((v) => Number.isFinite(v)) ? (n as [number, number, number, number]) : null;
}

/**
 * Whether a timing function runs the same shape backwards as forwards, which
 * is what lets the two halves of a dissolve use it without drifting apart.
 * `linear` trivially does; a cubic-bezier does when its second control point
 * is the first one reflected through the centre.
 */
export function easingIsSymmetric(css: string): boolean {
  if (css === 'linear') return true;
  const p = bezierPoints(css);
  if (!p) return false;
  const [x1, y1, x2, y2] = p;
  return Math.abs(x2 - (1 - x1)) < 1e-9 && Math.abs(y2 - (1 - y1)) < 1e-9;
}

/** How one screen's camera change looks, resolved from the style and the feed. */
export interface ArrivalLook {
  /**
   * The veil the change dips through, or null to crossfade with no veil at
   * all. The panel is black, so a black veil and no veil differ only in
   * whether the outgoing picture is still there underneath.
   */
  veilColor: string | null;
  /**
   * The brightness the outgoing picture reaches as the veil closes, and the
   * one the incoming picture comes back from. 1 leaves the picture alone.
   * Above 1 it blows out toward a white veil; 0 darkens into a black one.
   *
   * The picture moves TOWARD the veil rather than merely being covered by it,
   * which is what separates an exposure from a dip through a coloured card.
   */
  lift: number;
  /** Whether the veil spans the panel or only the picture inside it. */
  covers: VeilCovers;
  /** The timing function every layer of this change shares. */
  ease: string;
}

/**
 * The look for one screen. `sunset` keeps black under every style: the
 * question this answers is what a SUNRISE should do instead.
 */
export function arrivalLook(feed: Feed, d: Pick<Solo2Dials,
  'veilStyle' | 'veilTint' | 'burnLift' | 'veilCovers' | 'arrivalEase'>): ArrivalLook {
  const ease = ARRIVAL_EASES[d.arrivalEase] ?? ARRIVAL_EASES.linear;
  const base = { covers: d.veilCovers, ease };
  const sunrise = feed === 'sunrise';
  switch (d.veilStyle) {
    case 'crossfade':
      return { ...base, veilColor: sunrise ? null : '#000000', lift: 1 };
    case 'lift':
      return { ...base, veilColor: sunrise ? (VEIL_TINTS[d.veilTint] ?? VEIL_TINTS.dawn) : '#000000', lift: 1 };
    case 'exposure':
      // The picture moves toward the veil: up into white on the sunrise
      // screen, down into black on the sunset one. Both screens burn; they
      // burn toward opposite ends, which is the whole idea.
      return sunrise
        ? { ...base, veilColor: '#ffffff', lift: Math.max(1, d.burnLift) }
        : { ...base, veilColor: '#000000', lift: 0 };
    case 'black':
    default:
      return { ...base, veilColor: '#000000', lift: 1 };
  }
}
