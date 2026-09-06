'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import type { EntryView, TapeEntry } from '@/app/api/kiosk/solo/view';
import type { BinKind } from '@/app/lib/solo/types';
import type { Sequence } from './EntryRow';

const COLOR: Record<BinKind, string> = { sunset: '#7ee2ac', non_sunset: '#c3cad6' };
const REPEAT = '#8b2e2e';
const RING = '0 0 0 2px #f5a344';
const mono = 'ui-monospace, SFMono-Regular, Menlo, monospace';
export const THUMB_H = 22;
/** Width is time on the tape: this many pixels per second of glass. */
export const TAPE_PX_PER_S = 3;
/** A block never draws narrower than this, whatever its time says. */
const MIN_BLOCK_PX = 14;
/** A past frame that stayed on glass longer than this many dwells was held (nothing else eligible). */
const HELD_AFTER = 1.5;
/** …and its block is capped here so one long hold does not push everything off screen. */
const MAX_DWELLS = 3;

export interface TapeDials {
  dwellS: number;
  fadeS: number;
}

const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const place = (f: { city: string; country: string }) => [f.city, f.country].filter(Boolean).join(', ');
const secs = (s: number) => `${Number.isInteger(s) ? s : s.toFixed(1)} s`;

function Thumb({ testId, src, color, width, dashed = false, ring = false, repeat = false, title, onClick, children }: {
  testId: string; src: string; color: string; width: number; dashed?: boolean; ring?: boolean; repeat?: boolean;
  title: string; onClick?: () => void; children?: ReactNode;
}) {
  return (
    <button type="button" data-testid={testId} title={title} onClick={onClick} disabled={!onClick} style={{
      flex: 'none', width, height: THUMB_H, padding: 0, background: '#000', cursor: onClick ? 'pointer' : 'default',
      borderWidth: 1.5, borderStyle: dashed ? 'dashed' : 'solid', borderColor: color, borderTopColor: repeat ? REPEAT : color,
      borderTopWidth: repeat ? 3 : 1.5, borderRadius: 3, boxShadow: ring ? RING : undefined, boxSizing: 'border-box',
      position: 'relative', overflow: 'hidden',
    }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      {children}
    </button>
  );
}

/** The Final Cut "X": the seconds during which both pictures are on glass. */
function Fade({ testId, seconds }: { testId: string; seconds: number }) {
  const width = Math.max(4, seconds * TAPE_PX_PER_S);
  return (
    <div data-testid={testId} title={`crossfade ${secs(seconds)}: both pictures on glass`} style={{
      flex: 'none', width, height: THUMB_H, marginLeft: -width / 2, marginRight: -width / 2, position: 'relative', zIndex: 1,
      background: 'linear-gradient(135deg, rgba(245,163,68,0) 0%, rgba(245,163,68,0.55) 50%, rgba(245,163,68,0) 100%)',
      borderLeft: '1px solid rgba(245,163,68,0.8)', borderRight: '1px solid rgba(245,163,68,0.8)', boxSizing: 'border-box',
    }} />
  );
}

/**
 * The tape (stages-and-tape spec §4): what this screen drew, is drawing, and
 * will draw, in one strip where width is time. Past blocks are fact from the
 * draw log, each as wide as the frame stayed on glass (a hold, when nothing
 * else was eligible, reads as a wide block); the frame on glass wears the
 * orange ring; a seam separates fact from the projection, whose blocks are
 * dashed and one dwell wide. A crossfade is an orange X straddling the cut,
 * as wide as the fade dial. A solo2 dwell with a prelude shows its earlier
 * frames as narrow sub-blocks before the chosen one. A frame already seen
 * earlier on the strip carries a red top edge, the REPEAT tag's colour. When
 * nothing is on glass the seam is preceded by a black blank. Scrolls
 * sideways; on mount and whenever the past grows, the seam is brought to
 * about two thirds across.
 */
export function Tape({ past, current, currentSince, next, nextSequences, pastDials, nextDials, onSelect }: {
  past: TapeEntry[];
  current: EntryView | null;
  /** When the current frame went on glass, ms; sizes the last past block. */
  currentSince?: number | null;
  next: EntryView[];
  /** solo2: parallel to `next`, the prelude each dwell plays first. */
  nextSequences?: (Sequence | undefined)[];
  /** The live dials: what the past and the on-glass frame were drawn with. */
  pastDials: TapeDials;
  /** The studio dials: what the projection is drawn with. */
  nextDials: TapeDials;
  onSelect: (entry: EntryView) => void;
}) {
  const strip = useRef<HTMLDivElement>(null);
  const seam = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const s = strip.current;
    const m = seam.current;
    if (!s || !m) return;
    s.scrollLeft = Math.max(0, m.offsetLeft - s.clientWidth * (2 / 3));
  }, [past.length, current?.snapshotId]);

  const seen = new Set<number>();
  const repeatOf = (id: number) => {
    const r = seen.has(id);
    seen.add(id);
    return r;
  };
  const dwellPx = (d: TapeDials) => Math.max(MIN_BLOCK_PX, d.dwellS * TAPE_PX_PER_S);

  const blocks: ReactNode[] = [];
  let fades = 0;
  const fade = (seconds: number) => {
    if (seconds > 0) blocks.push(<Fade key={`fade-${fades}`} testId={`tape-fade-${fades}`} seconds={seconds} />);
    fades += 1;
  };

  past.forEach((f, i) => {
    const endMs = i + 1 < past.length ? past[i + 1].shownAt : currentSince ?? f.shownAt + pastDials.dwellS * 1000;
    const onGlassS = Math.max(0, (endMs - f.shownAt) / 1000);
    const dwells = pastDials.dwellS > 0 ? onGlassS / pastDials.dwellS : 1;
    const held = dwells > HELD_AFTER;
    const width = Math.max(MIN_BLOCK_PX, Math.min(dwells, MAX_DWELLS) * pastDials.dwellS * TAPE_PX_PER_S);
    blocks.push(
      <Thumb key={`${f.snapshotId}-${f.slot}`} testId={`tape-past-${f.snapshotId}-${f.slot}`} src={f.imageUrl} width={width}
        color={COLOR[f.bin]} repeat={repeatOf(f.snapshotId)} onClick={() => onSelect(f)}
        title={`${f.title}${place(f) ? ` · ${place(f)}` : ''} · draw at ${clock(f.shownAt)} · on glass ${secs(Math.round(onGlassS))}`
          + (held ? ' · held: nothing else was eligible' : '')}>
        {held && <span data-testid="tape-held" style={{ position: 'absolute', right: 2, bottom: 0, fontFamily: mono, fontSize: 8, color: '#f5a344' }}>held</span>}
      </Thumb>,
    );
    fade(pastDials.fadeS);
  });

  if (current) {
    blocks.push(
      <Thumb key="current" testId="tape-current" src={current.imageUrl} width={dwellPx(pastDials)} color={COLOR[current.bin]} ring
        repeat={repeatOf(current.snapshotId)} onClick={() => onSelect(current)}
        title={`on glass${currentSince ? ` since ${clock(currentSince)}` : ''} · ${current.title}${place(current) ? ` · ${place(current)}` : ''}`} />,
    );
  } else {
    blocks.push(
      <div key="blank" data-testid="tape-blank" title="Nothing on glass: the screen is black until a frame is eligible" style={{
        flex: 'none', width: dwellPx(pastDials), height: THUMB_H, background: '#000', border: '1.5px solid #2a3242', borderRadius: 3,
        boxSizing: 'border-box', fontFamily: mono, fontSize: 8, color: '#4b5568', display: 'grid', placeItems: 'center',
      }}>blank</div>,
    );
  }
  blocks.push(
    <div key="seam" ref={seam} data-testid="tape-seam" title="Left: what happened. Right: what the studio dials project."
      style={{ flex: 'none', width: 2, height: THUMB_H + 6, background: '#f5a344', opacity: 0.6, margin: '0 2px' }} />,
  );

  next.forEach((e, i) => {
    fade(nextDials.fadeS);
    const seq = nextSequences?.[i];
    const stepPx = seq ? Math.max(6, seq.stepS * TAPE_PX_PER_S) : 0;
    const total = dwellPx(nextDials);
    const mainWidth = Math.max(MIN_BLOCK_PX, total - (seq?.earlier.length ?? 0) * stepPx);
    const title = `draw ${i + 1} · ${e.title}${place(e) ? ` · ${place(e)}` : ''}`
      + (seq && seq.earlier.length > 0 ? ` · after ${seq.earlier.length} earlier frame${seq.earlier.length === 1 ? '' : 's'} of this camera, ${secs(seq.stepS)} each` : '');
    if (seq && seq.earlier.length > 0) {
      blocks.push(
        <div key={`next-${i}`} data-testid={`tape-next-${i}-group`} style={{ flex: 'none', display: 'flex', gap: 1 }}>
          {seq.earlier.map((f) => (
            <Thumb key={f.snapshotId} testId={`tape-next-${i}-pre-${f.snapshotId}`} src={f.imageUrl} width={stepPx} color="#2a3242" dashed
              title={`prelude · ${f.title} · ${secs(seq.stepS)}`} />
          ))}
          <Thumb testId={`tape-next-${i}`} src={e.imageUrl} width={mainWidth} color={COLOR[e.bin]} dashed
            repeat={repeatOf(e.snapshotId)} title={title} onClick={() => onSelect(e)} />
        </div>,
      );
    } else {
      blocks.push(
        <Thumb key={`next-${i}`} testId={`tape-next-${i}`} src={e.imageUrl} width={total} color={COLOR[e.bin]} dashed
          repeat={repeatOf(e.snapshotId)} title={title} onClick={() => onSelect(e)} />,
      );
    }
  });

  return (
    <div ref={strip} data-testid="tape" title="The tape: width is time. Past draws, the frame on glass, then the projected next draws."
      style={{ display: 'flex', alignItems: 'center', overflowX: 'auto', padding: '4px 2px', minHeight: THUMB_H + 12 }}>
      {past.length === 0 && (
        <span style={{ fontFamily: mono, fontSize: 9.5, color: '#4b5568', whiteSpace: 'nowrap', paddingRight: 6 }}>no draws logged yet</span>
      )}
      {blocks}
    </div>
  );
}
