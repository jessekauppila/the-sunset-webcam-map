'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { EntryView, TapeEntry } from '@/app/api/kiosk/solo/view';
import { fitPlan } from '@/app/lib/solo2/plan';
import type { Run } from './EntryRow';
import { PX_PER_S, SCALE_NOTE } from './timeScale';
import {
  clock, COLOR, CUT_STUB_PX, HELD_AFTER, MAX_DWELLS, MIN_BLOCK_PX, mono, Playhead, place, PLAYHEAD_ANIM,
  seamBetween, SeamMark, secs, TAPE_ZOOMS, type TapeDials, THUMB_H, Thumb,
} from './tapeParts';

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
   * is only its nominal value: a dwell is whole beats, a change, one per
   * frame, and a rest on the last.
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
   * A projected block's width: on the beat, a run is `change + played + rest`
   * beats, not the nominal still `dwellPx` reads — an eight-frame run spans
   * far more than a one-frame one at the same dials. Falls back to `dwellPx`
   * (the still alone) when the dials carry no beat fields, which is solo's case.
   */
  const projectedPx = (d: TapeDials, played: number) => {
    if (d.beatS == null || d.dwellBeats == null || d.changeBeats == null) return dwellPx(d);
    const plan = fitPlan({ beatS: d.beatS, dwellBeats: d.dwellBeats, changeBeats: d.changeBeats, leadS: 0, transition: d.transition }, played);
    return Math.max(MIN_BLOCK_PX, plan.dwellS * px);
  };
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
    // frame's start. A dwell is whole beats — a change, one per frame, and a
    // rest on the last — so f.shownAt plus the dial would be wrong for any
    // run of more than one frame. With nothing after it to measure against,
    // the block falls back to one nominal dwell for width alone.
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
        color={COLOR[f.bin]} repeat={repeatOf(f.snapshotId)} rating={f.bin === 'sunset' ? f.quality : null} ratingId={f.snapshotId} onClick={() => onSelect(f)}
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
        repeat={repeatOf(current.snapshotId)} rating={current.bin === 'sunset' ? current.quality : null} ratingId={current.snapshotId} onClick={() => onSelect(current)}
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
    const played = (seq?.earlier.length ?? 0) + 1;
    const total = projectedPx(nextDials, played);
    const mainWidth = Math.max(MIN_BLOCK_PX, total - (seq?.earlier.length ?? 0) * stepPx);
    // The frame the dwell actually ends on: `seq.last` when the run windows
    // around a peak that isn't the camera's newest (rendezvous spec §3.6),
    // else `e` itself — the only case for an ungrouped or unwindowed draw.
    const last = seq?.last ?? e;
    // The peak of the group: the highest-quality frame among the run's earlier
    // frames and the chosen one, ringed the same way the on-glass frame is. A
    // lone projected frame has no group to peak within — with no earlier
    // frames it would always "win" against itself, ringing every ordinary
    // single-frame draw.
    const peakId = seq && seq.earlier.length > 0
      ? [...seq.earlier, last].reduce((a, b) => ((b.quality ?? -1) > (a.quality ?? -1) ? b : a)).snapshotId
      : null;
    const title = `draw ${i + 1} · ${last.title}${place(last) ? ` · ${place(last)}` : ''}`
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
              ring={f.snapshotId === peakId} rating={f.bin === 'sunset' ? f.quality : null} ratingId={f.snapshotId}
              title={`run · ${f.title} · ${secs(seq.stepS)}`} onClick={() => onSelect(f)} />
          ))}
          <Thumb testId={`tape-next-${i}`} src={last.imageUrl} width={mainWidth} height={thumbH} color={COLOR[e.bin]} dashed
            ring={last.snapshotId === peakId} rating={last.bin === 'sunset' ? last.quality : null} ratingId={last.snapshotId}
            repeat={repeatOf(last.snapshotId)} title={title} onClick={() => onSelect(last)} />
        </div>,
      );
    } else {
      blocks.push(
        <Thumb key={`next-${i}`} testId={`tape-next-${i}`} src={last.imageUrl} width={total} height={thumbH} color={COLOR[e.bin]} dashed
          ring={last.snapshotId === peakId} rating={last.bin === 'sunset' ? last.quality : null} ratingId={last.snapshotId}
          repeat={repeatOf(last.snapshotId)} title={title} onClick={() => onSelect(last)} />,
      );
    }
  });

  // The beat grid (beat spec §4.1): a tick every beat, anchored at the seam,
  // which is "now". Both directions, because on the beat the past is on the
  // grid too. Only the projected side can be trusted to whole widths, so the
  // lines are drawn from the seam's measured offset, read after layout.
  const beatS = nextDials.beatS ?? pastDials.beatS ?? null;
  const [seamLeft, setSeamLeft] = useState<number | null>(null);
  useEffect(() => { setSeamLeft(seam.current?.offsetLeft ?? null); }, [past.length, current?.snapshotId, zoom, next.length]);
  const grid: ReactNode[] = [];
  if (beatS && seamLeft != null) {
    const stepPx = beatS * px;
    const span = 40; // beats either side is plenty for the widest strip
    for (let k = -span; k <= span; k++) {
      grid.push(<span key={`beat-${k}`} data-testid="tape-beat" aria-hidden style={{
        position: 'absolute', top: 0, bottom: 0, left: seamLeft + k * stepPx, width: 1, background: k === 0 ? 'transparent' : '#1d2432', pointerEvents: 'none',
      }} />);
    }
  }

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
      style={{ position: 'relative', display: 'flex', alignItems: 'center', overflowX: 'auto', padding: '4px 2px', minHeight: thumbH + 12 }}>
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
      {grid}
      {blocks}
    </div>
  );
}
