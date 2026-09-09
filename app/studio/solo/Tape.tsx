'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { EntryView, TapeEntry } from '@/app/api/kiosk/solo/view';
import type { BinKind } from '@/app/lib/solo/types';
import type { Run } from './EntryRow';
import { PX_PER_S, SCALE_NOTE } from './timeScale';

const COLOR: Record<BinKind, string> = { sunset: '#7ee2ac', non_sunset: '#c3cad6' };
const REPEAT = '#8b2e2e';
const RING = '0 0 0 2px #f5a344';
const mono = 'ui-monospace, SFMono-Regular, Menlo, monospace';
/**
 * Width is time on the tape, so height carries no meaning and can be spent
 * entirely on legibility. At 22 px a block was a letterbox slice with most of
 * the sky cropped away; 48 is close to uncropped at the default dwell, where
 * a block is 80 px wide. Scales with the zoom, so a zoomed block keeps its shape.
 */
export const THUMB_H = 48;
/** The keyframes the playhead rides; defined once inside the strip. */
const PLAYHEAD_ANIM = 'tape-playhead';
/** A block never draws narrower than this, whatever its time says. */
const MIN_BLOCK_PX = 14;
/** A frame the cap cut takes no time on glass, so its stub has a fixed width that stands for none. */
const CUT_STUB_PX = 8;
/** A past frame that stayed on glass longer than this many dwells was held (nothing else eligible). */
const HELD_AFTER = 1.5;
/** …and its block is capped here so one long hold does not push everything off screen. */
const MAX_DWELLS = 3;

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
}

const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const place = (f: { city: string; country: string }) => [f.city, f.country].filter(Boolean).join(', ');
const secs = (s: number) => `${Number.isInteger(s) ? s : s.toFixed(1)} s`;

function Thumb({ testId, src, color, width, height, dashed = false, dim = false, ring = false, repeat = false, title, onClick, children }: {
  testId: string; src: string; color: string; width: number; height: number; dashed?: boolean; dim?: boolean; ring?: boolean; repeat?: boolean;
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
function SeamMark({ testId, seam, px, height }: { testId: string; seam: Seam; px: number; height: number }) {
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
function Playhead({ sinceMs, endsAtMs, nowMs }: { sinceMs: number | null; endsAtMs: number | null; nowMs: number | null }) {
  if (sinceMs == null || endsAtMs == null || nowMs == null) return null;
  // The length comes from the server's published end, never from the dwell
  // dial: a dwell is a budget its frames share, so the dial is only its
  // nominal value and a run of eight stretches past it.
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

/**
 * The tape (stages-and-tape spec §4): what this screen drew, is drawing, and
 * will draw, in one strip where width is time. Past blocks are fact from the
 * draw log, each as wide as the frame stayed on glass (a hold, when nothing
 * else was eligible, reads as a wide block); the frame on glass wears the
 * orange ring; a seam separates fact from the projection, whose blocks are
 * dashed and one dwell wide. Between any two draws sits the seam the glass
 * will actually play there: an orange X for a crossfade or a same-camera
 * dissolve, a bar in the veil's colour for a dip, nothing for a cut. A solo2
 * dwell with a camera run shows its earlier frames as narrow sub-blocks before
 * the chosen one, and the frames the most-frames cap cut as dim stubs before
 * those. A frame already seen earlier on the strip carries a red top edge, the
 * REPEAT tag's colour. When nothing is on glass the seam is preceded by a black
 * blank. Scrolls sideways; on mount and whenever the past grows, the seam is
 * brought to about two thirds across. The zoom, in the sticky cell at the
 * left, scales the whole strip.
 */
export function Tape({ past, current, currentSince, currentEndsAt, next, nextSequences, pastDials, nextDials, onSelect, zoom = 1, onZoom }: {
  past: TapeEntry[];
  current: EntryView | null;
  /** When the current frame went on glass, ms; sizes the last past block. */
  currentSince?: number | null;
  /**
   * When the current dwell ends, ms since epoch, as published by the server
   * (StateView.current.endsAtMs). The playhead's travel and the last past
   * block's width both come from this rather than from the dwell dial, which
   * is only a budget's nominal value once frames share it.
   */
  currentEndsAt?: number | null;
  next: EntryView[];
  /** solo2: parallel to `next`, the earlier frames of the camera each dwell plays first. */
  nextSequences?: (Run | undefined)[];
  /** The live dials: what the past and the on-glass frame were drawn with. */
  pastDials: TapeDials;
  /** The studio dials: what the projection is drawn with. */
  nextDials: TapeDials;
  onSelect: (entry: EntryView) => void;
  /** Multiplies the shared scale; see `TAPE_ZOOMS`. */
  zoom?: number;
  /** When given, the sticky cell grows − and + buttons that step through `TAPE_ZOOMS`. */
  onZoom?: (zoom: number) => void;
}) {
  const strip = useRef<HTMLDivElement>(null);
  const seam = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const s = strip.current;
    const m = seam.current;
    if (!s || !m) return;
    s.scrollLeft = Math.max(0, m.offsetLeft - s.clientWidth * (2 / 3));
  }, [past.length, current?.snapshotId, zoom]);

  // Read once per frame on glass, after mount. The playhead's own motion is
  // CSS, so this never ticks; it only re-anchors when the picture changes.
  const [nowMs, setNowMs] = useState<number | null>(null);
  useEffect(() => { setNowMs(Date.now()); }, [currentSince, current?.snapshotId]);

  const px = PX_PER_S * zoom;
  const thumbH = Math.round(THUMB_H * zoom);
  const zoomIndex = (TAPE_ZOOMS as readonly number[]).indexOf(zoom);
  const zoomOut = zoomIndex > 0 ? TAPE_ZOOMS[zoomIndex - 1] : null;
  const zoomIn = zoomIndex >= 0 && zoomIndex < TAPE_ZOOMS.length - 1 ? TAPE_ZOOMS[zoomIndex + 1] : null;

  const seen = new Set<number>();
  const repeatOf = (id: number) => {
    const r = seen.has(id);
    seen.add(id);
    return r;
  };
  const dwellPx = (d: TapeDials) => Math.max(MIN_BLOCK_PX, d.dwellS * px);
  /**
   * The on-glass block is as wide as this dwell actually lasts, from the
   * server's published end, so a run of eight reads wider than a single
   * frame. Falls back to the nominal dial only when the end is unpublished.
   */
  const currentPx = () => {
    const ms = currentEndsAt != null && currentSince != null ? currentEndsAt - currentSince : null;
    return ms != null && ms > 0
      ? Math.max(MIN_BLOCK_PX, (ms / 1000) * px)
      : dwellPx(pastDials);
  };

  const blocks: ReactNode[] = [];
  let seams = 0;
  const seamAfter = (a: { webcamId: number } | null, b: { webcamId: number } | null, d: TapeDials) => {
    const s = seamBetween(a, b, d);
    if (s.kind !== 'cut' && s.seconds > 0) {
      blocks.push(<SeamMark key={`seam-${seams}`} testId={`tape-fade-${seams}`} seam={s} px={px} height={thumbH} />);
    }
    seams += 1;
  };
  // The draw after the last past block, for its seam: the frame on glass, else the first projection.
  const afterPast: { webcamId: number } | null = current ?? next[0] ?? null;

  past.forEach((f, i) => {
    // Measured, never computed: the next draw's time, else the current
    // frame's start. A dwell is a budget its frames share, so f.shownAt plus
    // the dial would be wrong for any run past the floor's threshold, by up
    // to 2.4x on runs already in the log. With nothing after it to measure
    // against, the block falls back to one nominal dwell for width alone.
    const endMs = i + 1 < past.length ? past[i + 1].shownAt : currentSince ?? null;
    const measured = endMs != null;
    const onGlassS = measured ? Math.max(0, (endMs - f.shownAt) / 1000) : pastDials.dwellS;
    const dwells = pastDials.dwellS > 0 ? onGlassS / pastDials.dwellS : 1;
    // Only a measured block can be known to have been held; an unmeasured one
    // is drawn at its nominal length and must not claim anything about it.
    const held = measured && dwells > HELD_AFTER;
    const width = Math.max(MIN_BLOCK_PX, Math.min(dwells, MAX_DWELLS) * pastDials.dwellS * px);
    blocks.push(
      <Thumb key={`${f.snapshotId}-${f.slot}`} testId={`tape-past-${f.snapshotId}-${f.slot}`} src={f.imageUrl} width={width} height={thumbH}
        color={COLOR[f.bin]} repeat={repeatOf(f.snapshotId)} onClick={() => onSelect(f)}
        title={`${f.title}${place(f) ? ` · ${place(f)}` : ''} · draw at ${clock(f.shownAt)} · on glass `
          + (measured ? secs(Math.round(onGlassS)) : 'unknown, nothing followed it')
          + (held ? ' · held: nothing else was eligible' : '')}>
        {held && <span data-testid="tape-held" style={{ position: 'absolute', right: 2, bottom: 0, fontFamily: mono, fontSize: 8, color: '#f5a344' }}>held</span>}
      </Thumb>,
    );
    seamAfter(f, i + 1 < past.length ? past[i + 1] : afterPast, pastDials);
  });

  if (current) {
    blocks.push(
      <Thumb key="current" testId="tape-current" src={current.imageUrl} width={currentPx()} height={thumbH} color={COLOR[current.bin]} ring
        repeat={repeatOf(current.snapshotId)} onClick={() => onSelect(current)}
        title={`on glass${currentSince ? ` since ${clock(currentSince)}` : ''} · ${current.title}${place(current) ? ` · ${place(current)}` : ''}`}>
        <Playhead sinceMs={currentSince ?? null} endsAtMs={currentEndsAt ?? null} nowMs={nowMs} />
      </Thumb>,
    );
  } else {
    blocks.push(
      <div key="blank" data-testid="tape-blank" title="Nothing on glass: the screen is black until a frame is eligible" style={{
        flex: 'none', width: dwellPx(pastDials), height: thumbH, background: '#000', border: '1.5px solid #2a3242', borderRadius: 3,
        boxSizing: 'border-box', fontFamily: mono, fontSize: 8, color: '#4b5568', display: 'grid', placeItems: 'center',
      }}>blank</div>,
    );
  }
  blocks.push(
    <div key="seam" ref={seam} data-testid="tape-seam" title="Left: what happened. Right: what the studio dials project."
      style={{ flex: 'none', width: 2, height: thumbH + 6, background: '#f5a344', opacity: 0.6, margin: '0 2px' }} />,
  );

  next.forEach((e, i) => {
    // The seam INTO this draw: from the frame on glass for the first, else from the draw before.
    seamAfter(i === 0 ? current : next[i - 1], e, nextDials);
    const seq = nextSequences?.[i];
    const stepPx = seq ? Math.max(6, seq.stepS * px) : 0;
    const total = dwellPx(nextDials);
    const mainWidth = Math.max(MIN_BLOCK_PX, total - (seq?.earlier.length ?? 0) * stepPx);
    const title = `draw ${i + 1} · ${e.title}${place(e) ? ` · ${place(e)}` : ''}`
      + (seq && seq.earlier.length > 0 ? ` · after ${seq.earlier.length} earlier frame${seq.earlier.length === 1 ? '' : 's'} of this camera, ${secs(seq.stepS)} each` : '');
    const cut = seq?.skipped ?? [];
    if (seq && (seq.earlier.length > 0 || cut.length > 0)) {
      blocks.push(
        <div key={`next-${i}`} data-testid={`tape-next-${i}-group`} style={{ flex: 'none', display: 'flex', gap: 1 }}>
          {/* Cut by the most-frames cap: no time on the strip, only a dim stub so the operator sees what a higher cap adds. */}
          {cut.map((f) => (
            <Thumb key={`cut-${f.snapshotId}`} testId={`tape-next-${i}-cut-${f.snapshotId}`} src={f.imageUrl} width={CUT_STUB_PX} height={thumbH} color="#2a3242" dashed dim
              title={`not played · ${f.title} · over the ${seq.capLabel ?? 'most-frames cap'}`} onClick={() => onSelect(f)} />
          ))}
          {/* Clickable like every other block. Without a handler `Thumb`
              disables the button, and these are the frames an operator most
              wants to open: the run's earlier pictures are the ones they
              cannot identify from a 6 px sliver. */}
          {seq.earlier.map((f) => (
            <Thumb key={f.snapshotId} testId={`tape-next-${i}-pre-${f.snapshotId}`} src={f.imageUrl} width={stepPx} height={thumbH} color="#2a3242" dashed
              title={`run · ${f.title} · ${secs(seq.stepS)}`} onClick={() => onSelect(f)} />
          ))}
          <Thumb testId={`tape-next-${i}`} src={e.imageUrl} width={mainWidth} height={thumbH} color={COLOR[e.bin]} dashed
            repeat={repeatOf(e.snapshotId)} title={title} onClick={() => onSelect(e)} />
        </div>,
      );
    } else {
      blocks.push(
        <Thumb key={`next-${i}`} testId={`tape-next-${i}`} src={e.imageUrl} width={total} height={thumbH} color={COLOR[e.bin]} dashed
          repeat={repeatOf(e.snapshotId)} title={title} onClick={() => onSelect(e)} />,
      );
    }
  });

  const zoomButton = (label: string, to: number | null, testId: string) => (
    <button type="button" data-testid={testId} disabled={to == null} onClick={() => to != null && onZoom?.(to)}
      title={to == null ? undefined : `${label === '+' ? 'zoom in' : 'zoom out'} to ${PX_PER_S * to} px/s`} style={{
        background: 'none', border: '1px solid #2a3242', borderRadius: 3, color: to == null ? '#2a3242' : '#9aa3b2',
        fontFamily: mono, fontSize: 10, width: 16, height: 16, padding: 0, lineHeight: 1, cursor: to == null ? 'default' : 'pointer',
      }}>{label}</button>
  );

  return (
    <div ref={strip} data-testid="tape"
      title={`The tape: past draws, the frame on glass, then the projected next draws. ${SCALE_NOTE}`}
      style={{ display: 'flex', alignItems: 'center', overflowX: 'auto', padding: '4px 2px', minHeight: thumbH + 12 }}>
      <style>{
        `@keyframes ${PLAYHEAD_ANIM} { from { left: 0% } to { left: 100% } }`
        + ` @media (prefers-reduced-motion: reduce) { [data-testid="tape-playhead"] { animation: none } }`
      }</style>
      {/* Sticks to the left edge while the strip scrolls, so the scale is readable without hovering. */}
      <span data-testid="tape-scale" title={SCALE_NOTE} style={{
        position: 'sticky', left: 0, zIndex: 2, flex: 'none', alignSelf: 'stretch', display: 'flex', alignItems: 'center', gap: 4,
        fontFamily: mono, fontSize: 9, color: '#4b5568', background: '#0e1119', padding: '0 5px', cursor: 'help',
      }}>
        {onZoom && zoomButton('−', zoomOut, 'tape-zoom-out')}
        <span data-testid="tape-scale-label">{px} px/s</span>
        {onZoom && zoomButton('+', zoomIn, 'tape-zoom-in')}
      </span>
      {past.length === 0 && (
        <span style={{ fontFamily: mono, fontSize: 9.5, color: '#4b5568', whiteSpace: 'nowrap', paddingRight: 6 }}>no draws logged yet</span>
      )}
      {blocks}
    </div>
  );
}
