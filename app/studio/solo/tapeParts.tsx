'use client';

import { useEffect, useState, type ReactNode } from 'react';
import type { BinKind } from '@/app/lib/solo/types';

export const COLOR: Record<BinKind, string> = { sunset: '#7ee2ac', non_sunset: '#c3cad6' };
export const REPEAT = '#8b2e2e';
export const RING = '0 0 0 2px #f5a344';
export const mono = 'ui-monospace, SFMono-Regular, Menlo, monospace';
/**
 * Width is time on the tape, so height carries no meaning and can be spent
 * entirely on legibility. At 22 px a block was a letterbox slice with most of
 * the sky cropped away; 48 is close to uncropped at the default dwell, where
 * a block is 80 px wide. Scales with the zoom, so a zoomed block keeps its shape.
 */
export const THUMB_H = 48;
/** The keyframes the playhead rides; defined once inside the strip. */
export const PLAYHEAD_ANIM = 'tape-playhead';
/** A block never draws narrower than this, whatever its time says. */
export const MIN_BLOCK_PX = 14;
/** A frame the cap cut takes no time on glass, so its stub has a fixed width that stands for none. */
export const CUT_STUB_PX = 8;
/** A past frame that stayed on glass longer than this many times its expected duration was held (nothing else eligible). */
export const HELD_AFTER = 1.5;

/**
 * The zoom steps, as multiples of the studio's shared scale. 1 is the queue's
 * scale, so the tape and the queue agree at rest; the others are for reading
 * a seam or a run's sub-blocks, which at 4 px/s are slivers.
 */
export const TAPE_ZOOMS = [0.5, 1, 2, 4] as const;
const ZOOM_KEY = 'studio.tape.zoom';

/**
 * The tape's zoom, remembered per browser. Lifted to the panel rather than
 * kept per tape so both screens' tapes zoom together: they sit side by side
 * and read as one instrument.
 */
export function useTapeZoom(): [number, (z: number) => void] {
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    try {
      const z = Number(localStorage.getItem(ZOOM_KEY));
      if ((TAPE_ZOOMS as readonly number[]).includes(z)) setZoom(z);
    } catch { /* storage unavailable: stay at 1 */ }
  }, []);
  const set = (z: number) => {
    setZoom(z);
    try { localStorage.setItem(ZOOM_KEY, String(z)); } catch { /* ignore */ }
  };
  return [zoom, set];
}

export type TapeTransition = 'cut' | 'crossfade' | 'dip';

export interface TapeDials {
  dwellS: number;
  fadeS: number;
  /**
   * What a camera change is. Absent reads as a crossfade, which is what solo
   * does and what the tape assumed for everything until 2026-09-08 — when at
   * the live `dip` it drew a 6 s "both pictures on glass" on every seam where
   * the real overlap was none.
   */
  transition?: TapeTransition;
  /** A change to a later frame of the same camera dissolves over this, never through the veil. */
  sameCameraFadeS?: number;
  /** What a dip goes through on this screen, for the seam's colour; null crossfades instead. */
  veil?: string | null;
  /** The beat, seconds; when present the strip draws a tick grid at this spacing from the seam. */
  beatS?: number;
  /** The still, in beats; with `beatS` and `changeBeats` present, a projected run's width comes from `fitPlan`, not the nominal still. */
  dwellBeats?: number;
  /** The change, in beats; see `dwellBeats`. */
  changeBeats?: number;
}

export const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
export const place = (f: { city: string; country: string }) => [f.city, f.country].filter(Boolean).join(', ');
export const secs = (s: number) => `${Number.isInteger(s) ? s : s.toFixed(1)} s`;

export function Thumb({ testId, src, color, width, height, dashed = false, dim = false, ring = false, repeat = false, rating = null, ratingId, title, onClick, children }: {
  testId: string; src: string; color: string; width: number; height: number; dashed?: boolean; dim?: boolean; ring?: boolean; repeat?: boolean;
  /** A sunset frame's quality, [0,1], drawn as a bar along the bottom edge; null for anything else. */
  rating?: number | null;
  /**
   * The rating bar's test id. Explicit rather than derived from `testId`,
   * because `testId` is not reliably a bare snapshot id — a run's earlier
   * frames are `tape-next-i-pre-id`, and a regex over that collides with the
   * slot index `i`.
   */
  ratingId?: number | string;
  title: string; onClick?: () => void; children?: ReactNode;
}) {
  return (
    <button type="button" data-testid={testId} title={title} onClick={onClick} disabled={!onClick} style={{
      flex: 'none', width, height, padding: 0, background: '#000', cursor: onClick ? 'pointer' : 'default',
      borderWidth: 1.5, borderStyle: dashed ? 'dashed' : 'solid', borderColor: color, borderTopColor: repeat ? REPEAT : color,
      borderTopWidth: repeat ? 3 : 1.5, borderRadius: 3, boxShadow: ring ? RING : undefined, boxSizing: 'border-box',
      position: 'relative', overflow: 'hidden', opacity: dim ? 0.35 : 1,
    }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      {children}
      {rating != null && (
        <span data-testid={`tape-rating-${ratingId}`} style={{
          position: 'absolute', left: 0, bottom: 0, height: 3, width: `${Math.round(rating * 100)}%`, background: color, opacity: 0.9,
        }} />
      )}
    </button>
  );
}

/** What happens at the cut between two draws, as the glass will actually play it. */
export interface Seam {
  kind: 'crossfade' | 'dissolve' | 'dip' | 'cut';
  seconds: number;
  veil: string | null;
}

/**
 * The seam between draw `a` and draw `b` under `d`. A later frame of the
 * same camera dissolves over the same-camera dial whatever the transition
 * says (Solo2Frame `arrival`); otherwise the transition decides. This is
 * what the glass does, so this is what the tape draws.
 */
export function seamBetween(
  a: { webcamId: number } | null, b: { webcamId: number } | null, d: TapeDials,
): Seam {
  if (a && b && a.webcamId === b.webcamId) {
    const s = Math.max(0, d.sameCameraFadeS ?? 0);
    return { kind: s > 0 ? 'dissolve' : 'cut', seconds: s, veil: null };
  }
  const fade = Math.max(0, d.fadeS);
  const kind = d.transition ?? 'crossfade';
  if (kind === 'cut' || fade <= 0) return { kind: 'cut', seconds: 0, veil: null };
  // A dip on a screen whose veil is null is a crossfade (veil.ts).
  if (kind === 'dip' && d.veil === null) return { kind: 'crossfade', seconds: fade, veil: null };
  return { kind, seconds: fade, veil: kind === 'dip' ? (d.veil ?? '#000000') : null };
}

/**
 * The seam marker. A crossfade or a dissolve is the Final Cut "X": the seconds
 * during which both pictures are on glass. A dip is a bar in the veil's colour:
 * the seconds during which NEITHER picture is fully on glass, the first half
 * the old one burning down inside its own block, the second the new one
 * rising inside its. A cut draws nothing.
 *
 * It straddles the cut by half its width each way, which for a dip is exactly
 * where the halves live. Never a click target: it paints above its neighbours,
 * and while it took pointer events it swallowed clicks along their edges.
 */
export function SeamMark({ testId, seam, px, height }: { testId: string; seam: Seam; px: number; height: number }) {
  const width = Math.max(4, seam.seconds * px);
  const base = {
    flex: 'none', width, height, marginLeft: -width / 2, marginRight: -width / 2, position: 'relative', zIndex: 1,
    pointerEvents: 'none', boxSizing: 'border-box',
  } as const;
  if (seam.kind === 'dip') {
    const veil = seam.veil ?? '#000000';
    return (
      <div data-testid={testId} data-seam="dip" title={`dip ${secs(seam.seconds)}: down into the veil, then up. No overlap.`} style={{
        ...base, background: `linear-gradient(90deg, ${veil}00 0%, ${veil} 45%, ${veil} 55%, ${veil}00 100%)`,
        borderLeft: '1px solid rgba(139,149,167,0.5)', borderRight: '1px solid rgba(139,149,167,0.5)',
      }} />
    );
  }
  const what = seam.kind === 'dissolve' ? 'same camera · dissolve' : 'crossfade';
  return (
    <div data-testid={testId} data-seam={seam.kind} title={`${what} ${secs(seam.seconds)}: both pictures on glass`} style={{
      ...base,
      background: 'linear-gradient(135deg, rgba(245,163,68,0) 0%, rgba(245,163,68,0.55) 50%, rgba(245,163,68,0) 100%)',
      borderLeft: '1px solid rgba(245,163,68,0.8)', borderRight: '1px solid rgba(245,163,68,0.8)',
    }} />
  );
}

/**
 * Where the glass is inside the current dwell: a line that starts at the left
 * edge of the on-glass block and reaches the seam as the picture changes.
 *
 * The motion is one CSS animation, not a JavaScript tick, so nothing re-renders
 * while it travels. Duration is the whole dwell and the delay is minus the time
 * already elapsed, which starts it part-way through; `forwards` parks it at the
 * right edge when a frame is held past its dwell, which the block's `held` mark
 * explains. `left` is also set inline, so a reader with reduced motion gets the
 * line at its true position without it moving.
 *
 * `nowMs` is read once on mount rather than during render, because a clock read
 * during render disagrees between the server and the client and React reports
 * that as a hydration mismatch.
 */
export function Playhead({ sinceMs, endsAtMs, nowMs }: { sinceMs: number | null; endsAtMs: number | null; nowMs: number | null }) {
  if (sinceMs == null || endsAtMs == null || nowMs == null) return null;
  // The length comes from the server's published end, never from the dwell
  // dial: a dwell is whole beats — a change, one per frame, and a rest on the
  // last — so a run of eight takes more beats than the dial alone says.
  const dwellS = (endsAtMs - sinceMs) / 1000;
  if (dwellS <= 0) return null;
  const elapsedS = Math.max(0, (nowMs - sinceMs) / 1000);
  const pct = Math.min(100, (elapsedS / dwellS) * 100);
  return (
    <span data-testid="tape-playhead" aria-hidden style={{
      position: 'absolute', top: 0, bottom: 0, width: 2, left: `${pct}%`, background: '#fff',
      boxShadow: '0 0 4px rgba(255,255,255,0.9)', pointerEvents: 'none',
      animationName: PLAYHEAD_ANIM, animationDuration: `${dwellS}s`, animationTimingFunction: 'linear',
      animationDelay: `${-elapsedS}s`, animationFillMode: 'forwards',
    }} />
  );
}
