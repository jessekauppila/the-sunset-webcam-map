'use client';

import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import type { EntryView, StateView } from '@/app/api/kiosk/solo/view';
import type { Feed } from '@/app/lib/solo/types';
import type { PairProjection } from './projectPair';
import { layoutStrip, type Block } from './pairLayout';
import {
  clock, COLOR, CUT_STUB_PX, MIN_BLOCK_PX, mono, Playhead, place, PLAYHEAD_ANIM,
  seamBetween, SeamMark, TAPE_ZOOMS, type TapeDials, THUMB_H, Thumb,
} from './tapeParts';
import { PX_PER_S, SCALE_NOTE } from './timeScale';

export { layoutStrip, type Block } from './pairLayout';

export interface PairTapeProps {
  sunrise: StateView;
  sunset: StateView;
  projection: PairProjection;
  liveDials: Record<Feed, TapeDials>;
  studioDials: Record<Feed, TapeDials>;
  nowMs: number;
  onSelect: (entry: EntryView, feed: Feed, list: EntryView[]) => void;
  zoom?: number;
  onZoom?: (z: number) => void;
}

const RULER_H = 24;
const LABEL_H = 20;
const SUB_MIN_PX = 6;
const ORANGE = '#f5a344';
const GHOST = '#4b5568';

/** `dropped`/`grown` frames get this instead of `Thumb`'s fixed red repeat edge, which is a different fact. */
function OrangeEdge({ testId }: { testId: string }) {
  return <span data-testid={testId} aria-hidden style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: ORANGE, pointerEvents: 'none' }} />;
}

function movedLabel(peakAtMs: number, ghostMs: number): string {
  const movedS = Math.round((peakAtMs - ghostMs) / 1000);
  return `peak moved ${movedS > 0 ? '+' : ''}${movedS} s`;
}

function labelOf(b: Block, beatS: number): string {
  const parts: string[] = [];
  if (b.dropped.length > 0) parts.push(`dropped ${b.dropped.length}`);
  if (b.grown > 0) parts.push(`grew +${b.grown}`);
  if (b.ghostMs != null && b.peakAtMs != null && beatS > 0 && Math.abs(b.ghostMs - b.peakAtMs) >= beatS * 1000) {
    parts.push(movedLabel(b.peakAtMs, b.ghostMs));
  }
  return parts.join(' · ');
}

/**
 * The one tape for two screens (one-tape spec §4): sunrise's strip, a shared
 * ruler, sunset's strip, all positioned from a single `x(ms)` — so a landing
 * at `L` draws as one vertical line through all three, not two strips an
 * operator has to line up by eye. `layoutStrip` (pairLayout.ts) does the pure
 * half — deciding each block's ms boundaries and what it carries; this file
 * only turns those into pixels.
 */
export function PairTape({ sunrise, sunset, projection, liveDials, studioDials, nowMs, onSelect, zoom = 1, onZoom }: PairTapeProps) {
  const stripRef = useRef<HTMLDivElement>(null);

  const beatS = studioDials.sunrise.beatS ?? studioDials.sunset.beatS ?? liveDials.sunrise.beatS ?? liveDials.sunset.beatS ?? 0;
  const earliestOf = (v: StateView) => v.tape[0]?.shownAt ?? v.current?.shownSince ?? nowMs;
  const originMs = Math.min(earliestOf(sunrise), earliestOf(sunset)) - 8 * beatS * 1000;

  const views: Record<Feed, StateView> = { sunrise, sunset };
  // Deliberately NOT keyed on `nowMs`: layoutStrip only reads it for the "no
  // current"/"unmeasured past" fallback edges, and nowMs otherwise ticks far
  // more often than the underlying data changes — keying on it would defeat
  // the memo.
  const blocksOf: Record<Feed, Block[]> = useMemo(() => ({
    sunrise: layoutStrip({ view: sunrise, projection: projection.sunrise, ghosts: projection.ghosts.sunrise, liveDials: liveDials.sunrise, studioDials: studioDials.sunrise, nowMs }),
    sunset: layoutStrip({ view: sunset, projection: projection.sunset, ghosts: projection.ghosts.sunset, liveDials: liveDials.sunset, studioDials: studioDials.sunset, nowMs }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [sunrise, sunset, projection, studioDials, liveDials]);

  // The same blank-slot/unmeasured fallback `layoutStrip` already resolved
  // per block — never re-derived from the raw frames here, which would miss
  // that fallback (a `StripFrame`'s own `dwellMs` is null for a blank slot).
  const endMs = Math.max(
    ...blocksOf.sunrise.map((b) => b.endMs),
    ...blocksOf.sunset.map((b) => b.endMs),
  );
  const px = PX_PER_S * zoom;
  const x = (ms: number) => ((ms - originMs) / 1000) * px;
  const width = x(endMs) + 40;
  const thumbH = Math.round(THUMB_H * zoom);
  const rowH = thumbH + LABEL_H;
  const rowTop = { sunrise: 0, ruler: rowH, sunset: rowH + RULER_H } as const;
  const totalH = rowH + RULER_H + rowH;

  const nowMinute = Math.floor(nowMs / 60_000);
  useEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    el.scrollLeft = Math.max(0, x(nowMs) - el.clientWidth * (2 / 3));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nowMinute, zoom]);

  const zoomIndex = (TAPE_ZOOMS as readonly number[]).indexOf(zoom);
  const zoomOut = zoomIndex > 0 ? TAPE_ZOOMS[zoomIndex - 1] : null;
  const zoomIn = zoomIndex >= 0 && zoomIndex < TAPE_ZOOMS.length - 1 ? TAPE_ZOOMS[zoomIndex + 1] : null;
  const zoomButton = (label: string, to: number | null, testId: string) => (
    <button type="button" data-testid={testId} disabled={to == null} onClick={() => to != null && onZoom?.(to)} style={{
      background: 'none', border: '1px solid #2a3242', borderRadius: 3, color: to == null ? '#2a3242' : '#9aa3b2',
      fontFamily: mono, fontSize: 10, width: 16, height: 16, padding: 0, lineHeight: 1, cursor: to == null ? 'default' : 'pointer',
    }}>{label}</button>
  );

  function seamsOf(feed: Feed): ReactNode[] {
    const blocks = blocksOf[feed];
    const out: ReactNode[] = [];
    for (let i = 1; i < blocks.length; i++) {
      const a = blocks[i - 1];
      const b = blocks[i];
      const dials = b.kind === 'next' ? studioDials[feed] : liveDials[feed];
      const seam = seamBetween(a.entry, b.entry, dials);
      if (seam.kind === 'cut' || seam.seconds <= 0) continue;
      // SeamMark centres itself on its own left edge via a negative margin
      // (tapeParts.tsx), the same trick that straddled a cut in the old
      // flex-laid tape; placing that left edge at the boundary is enough.
      out.push(
        <span key={`seam-${feed}-${i}`} style={{ position: 'absolute', top: 0, left: x(b.startMs), height: thumbH }}>
          <SeamMark testId={`tape-seam-${feed}-${i}`} seam={seam} px={px} height={thumbH} />
        </span>,
      );
    }
    return out;
  }

  function pastRow(feed: Feed): ReactNode[] {
    const tape = views[feed].tape;
    const blocks = blocksOf[feed].slice(0, tape.length);
    return blocks.map((b, i) => {
      const f = tape[i];
      const left = x(b.startMs);
      const w = Math.max(MIN_BLOCK_PX, x(b.endMs) - left);
      if (!b.entry) return null;
      return (
        <div key={`past-${feed}-${f.snapshotId}-${f.slot}`} style={{ position: 'absolute', left, top: 0, width: w, height: thumbH }}>
          <Thumb testId={`tape-past-${f.snapshotId}-${f.slot}`} src={b.entry.imageUrl} width={w} height={thumbH} color={COLOR[b.entry.bin]}
            repeat={b.repeat} rating={b.entry.bin === 'sunset' ? b.entry.quality : null} ratingId={b.entry.snapshotId}
            onClick={() => onSelect(b.entry!, feed, listOf(feed))}
            title={`${b.entry.title}${place(b.entry) ? ` · ${place(b.entry)}` : ''} · draw at ${clock(f.shownAt)}` + (b.held ? ' · held: nothing else was eligible' : '')}>
            {b.held && <span data-testid="tape-held" style={{ position: 'absolute', right: 2, bottom: 0, fontFamily: mono, fontSize: 8, color: ORANGE }}>held</span>}
          </Thumb>
        </div>
      );
    });
  }

  function currentBlockOf(feed: Feed): Block {
    return blocksOf[feed][views[feed].tape.length];
  }

  function currentRow(feed: Feed): ReactNode {
    const b = currentBlockOf(feed);
    const cur = views[feed].current;
    const left = x(b.startMs);
    const w = Math.max(MIN_BLOCK_PX, x(b.endMs) - left);
    if (!b.entry) {
      return (
        <div key={`current-${feed}`} data-testid={`tape-current-${feed}`} title="Nothing on glass: the screen is black until a frame is eligible" style={{
          position: 'absolute', left, top: 0, width: w, height: thumbH, background: '#000', border: '1.5px solid #2a3242',
          borderRadius: 3, boxSizing: 'border-box', fontFamily: mono, fontSize: 8, color: '#4b5568', display: 'grid', placeItems: 'center',
        }}>blank</div>
      );
    }
    return (
      <div key={`current-${feed}`} style={{ position: 'absolute', left, top: 0, width: w, height: thumbH }}>
        <Thumb testId={`tape-current-${feed}`} src={b.entry.imageUrl} width={w} height={thumbH} color={COLOR[b.entry.bin]} ring
          repeat={b.repeat} rating={b.entry.bin === 'sunset' ? b.entry.quality : null} ratingId={b.entry.snapshotId}
          onClick={() => onSelect(b.entry!, feed, listOf(feed))}
          title={`on glass${cur?.shownSince ? ` since ${clock(cur.shownSince)}` : ''} · ${b.entry.title}${place(b.entry) ? ` · ${place(b.entry)}` : ''}`}>
          <Playhead sinceMs={cur?.shownSince ?? null} endsAtMs={cur?.endsAtMs ?? null} nowMs={nowMs} />
        </Thumb>
      </div>
    );
  }

  function nextRow(feed: Feed): ReactNode[] {
    const tape = views[feed].tape;
    const blocks = blocksOf[feed].slice(tape.length + 1);
    const dials = studioDials[feed];
    return blocks.map((b, i) => {
      const left = x(b.startMs);
      const w = Math.max(MIN_BLOCK_PX, x(b.endMs) - left);
      if (!b.entry) {
        return (
          <div key={`next-${feed}-${i}`} data-testid={`tape-next-${feed}-${i}`} title="nothing eligible at this tick" style={{
            position: 'absolute', left, top: 0, width: w, height: thumbH, background: '#000', border: '1.5px dashed #2a3242',
            borderRadius: 3, boxSizing: 'border-box',
          }} />
        );
      }
      const entry = b.entry;
      const kept = b.frames.length ? b.frames : [entry];
      // The sub-blocks must always sum to the block's own width `w` — never
      // more, never less. With a beat dial: one beat each for every earlier
      // frame, the last takes whatever is left (its own change beat sits
      // ahead of the block, at the seam; its rest sits here, at the tail).
      // Without one, there is no beat to measure a "one frame" width by, so
      // each frame gets an equal share of `w`.
      let subW: number[];
      if (kept.length <= 1) {
        subW = [w];
      } else if (dials.beatS) {
        const stepPx = Math.max(SUB_MIN_PX, dials.beatS * px);
        const earlier = new Array(kept.length - 1).fill(stepPx);
        const usedByEarlier = earlier.reduce((a: number, c: number) => a + c, 0);
        subW = [...earlier, Math.max(MIN_BLOCK_PX, w - usedByEarlier)];
      } else {
        subW = new Array(kept.length).fill(w / kept.length);
      }
      const junctions: number[] = [left];
      subW.reduce((c, sw) => { const n = c + sw; junctions.push(n); return n; }, left);

      const cutNodes = b.cut.map((c) => (
        <Thumb key={`cut-${c.snapshotId}`} testId={`tape-next-${feed}-${i}-cut-${c.snapshotId}`} src={c.imageUrl} width={CUT_STUB_PX} height={thumbH}
          color="#2a3242" dashed dim title={`not played · ${c.title} · over the most-frames cap`} onClick={() => onSelect(c, feed, listOf(feed))} />
      )).map((node, ci) => (
        <div key={`cutwrap-${ci}`} style={{ position: 'absolute', left: left - (b.cut.length - ci) * CUT_STUB_PX, top: 0 }}>{node}</div>
      ));

      // Dropped frames took no time on the strip: each sits at the junction
      // between the two kept climb frames it fell between (a merge by
      // capture time, not by any ms of its own — it has none).
      const juncCount = new Map<number, number>();
      const droppedNodes = [...b.dropped].sort((a, c) => (a.capturedAt ?? 0) - (c.capturedAt ?? 0)).map((d) => {
        const idx = kept.filter((k) => (k.capturedAt ?? 0) < (d.capturedAt ?? 0)).length;
        const stack = juncCount.get(idx) ?? 0;
        juncCount.set(idx, stack + 1);
        const jx = junctions[idx] + stack * 3;
        return (
          <div key={`drop-${d.snapshotId}`} style={{ position: 'absolute', left: jx - CUT_STUB_PX / 2, top: 0 }}>
            <Thumb testId={`tape-dropped-${d.snapshotId}`} src={d.imageUrl} width={CUT_STUB_PX} height={thumbH} color="#2a3242" dashed dim
              title={`dropped from the climb · ${d.title} · thinned to fit the rendezvous`} onClick={() => onSelect(d, feed, listOf(feed))}>
              <OrangeEdge testId={`tape-dropped-${d.snapshotId}-edge`} />
            </Thumb>
          </div>
        );
      });

      const subNodes = kept.map((fr, j) => {
        const isLast = j === kept.length - 1;
        const testId = isLast ? `tape-next-${feed}-${i}` : `tape-next-${feed}-${i}-pre-${fr.snapshotId}`;
        const grownEdge = b.grown > 0 && j >= kept.length - b.grown;
        const sub = (
          <Thumb key={testId} testId={testId} src={fr.imageUrl} width={subW[j]} height={thumbH} color={COLOR[entry.bin]} dashed
            rating={fr.bin === 'sunset' ? fr.quality : null} ratingId={fr.snapshotId}
            repeat={isLast ? b.repeat : false}
            title={`${isLast ? `draw ${i + 1} · ` : 'run · '}${fr.title}${place(fr) ? ` · ${place(fr)}` : ''}`}
            onClick={() => onSelect(fr, feed, listOf(feed))}>
            {grownEdge && <OrangeEdge testId={`${testId}-edge`} />}
          </Thumb>
        );
        return <div key={testId} style={{ position: 'absolute', left: junctions[j], top: 0 }}>{sub}</div>;
      });

      const ghost = b.ghostMs != null && b.peakAtMs != null && beatS > 0 && Math.abs(b.ghostMs - b.peakAtMs) >= beatS * 1000
        ? (
          <span key="ghost" data-testid="tape-ghost" title="peak would land here without the rendezvous" style={{
            position: 'absolute', left: x(b.ghostMs) - 5, top: -1, width: 0, height: 0,
            borderLeft: '5px solid transparent', borderRight: '5px solid transparent', borderTop: `7px solid ${GHOST}`,
          }} />
        ) : null;

      const label = labelOf(b, beatS);

      return (
        <div key={`next-${feed}-${i}`} style={{ position: 'absolute', left: 0, top: 0 }}>
          {cutNodes}
          {droppedNodes}
          {subNodes}
          {ghost}
          {label && <div style={{ position: 'absolute', left, top: thumbH + 2, fontFamily: mono, fontSize: 10, color: '#8b95a7', whiteSpace: 'nowrap' }}>{label}</div>}
        </div>
      );
    });
  }

  /**
   * Every frame this strip actually shows, in time order: for each block, its
   * cut stubs, its dropped stubs, then its played frames — a superset of
   * `map(b => b.entry)` that also carries the run's earlier frames and the
   * stubs, since a click on any of those must find itself in the list `onSelect`
   * hands to the caller (SoloPanel opens the detail modal at its index in it).
   */
  function listOf(feed: Feed): EntryView[] {
    return blocksOf[feed].flatMap((b) => [...b.cut, ...b.dropped, ...b.frames]);
  }

  /** The beat grid (one-tape spec §4.3): from the axis itself, not a measured seam — every tick is `x(originMs + k·beatS·1000)`. */
  function beatGrid(): ReactNode[] {
    if (beatS <= 0) return [];
    const out: ReactNode[] = [];
    let t = originMs;
    let k = 0;
    while (t <= endMs) {
      out.push(<span key={`beat-${k}`} data-testid="tape-beat" aria-hidden style={{ position: 'absolute', top: 0, bottom: 0, left: x(t), width: 1, background: '#161c28', pointerEvents: 'none' }} />);
      t += beatS * 1000;
      k += 1;
    }
    return out;
  }

  function ruler(): ReactNode {
    const minutes: ReactNode[] = [];
    const first = Math.ceil(originMs / 60_000) * 60_000;
    for (let t = first; t <= endMs; t += 60_000) {
      minutes.push(<span key={`min-${t}`} style={{ position: 'absolute', left: x(t) + 2, top: 2, fontFamily: mono, fontSize: 8, color: '#4b5568' }}>{clock(t)}</span>);
    }
    return (
      <>
        {minutes}
        <span data-testid="tape-now" title={`now · ${clock(nowMs)}`} style={{ position: 'absolute', left: x(nowMs), top: 0, bottom: 0, width: 1, background: '#fff', opacity: 0.7 }} />
        <span style={{ position: 'absolute', left: x(nowMs) + 3, top: 2, fontFamily: mono, fontSize: 8, color: '#fff' }}>{clock(nowMs)}</span>
      </>
    );
  }

  function ties(): ReactNode[] {
    const out: ReactNode[] = [];
    projection.landings.forEach((l, li) => {
      (['sunrise', 'ruler', 'sunset'] as const).forEach((row) => {
        const top = row === 'sunrise' ? rowTop.sunrise : row === 'ruler' ? rowTop.ruler : rowTop.sunset;
        const h = row === 'ruler' ? RULER_H : rowH;
        out.push(
          <span key={`tie-${li}-${row}`} data-testid="tape-tie" title={`rendezvous · ${clock(l.atMs)}`} style={{
            position: 'absolute', left: x(l.atMs) - 1, top, width: 2, height: h, background: ORANGE, zIndex: 3, pointerEvents: 'none',
          }}>
            {row === 'ruler' && <span style={{ position: 'absolute', left: 3, top: 2, fontFamily: mono, fontSize: 8, color: ORANGE, whiteSpace: 'nowrap' }}>{clock(l.atMs)}</span>}
          </span>,
        );
      });
    });
    const seenPast = new Set<number>();
    const check = (mine: Block[], theirs: Block[]) => {
      for (const b of mine) {
        if (b.kind !== 'past' || !b.rendezvous || b.peakAtMs == null || seenPast.has(b.peakAtMs)) continue;
        if (theirs.some((o) => (o.kind === 'past' || o.kind === 'current') && o.peakAtMs === b.peakAtMs)) {
          seenPast.add(b.peakAtMs);
          out.push(
            <span key={`past-tie-${b.peakAtMs}`} data-testid="tape-tie" title={`fitted earlier · ${clock(b.peakAtMs)}`} style={{
              position: 'absolute', left: x(b.peakAtMs) - 1, top: 0, width: 2, height: totalH, background: ORANGE, zIndex: 3, pointerEvents: 'none',
            }} />,
          );
        }
      }
    };
    check(blocksOf.sunrise, blocksOf.sunset);
    check(blocksOf.sunset, blocksOf.sunrise);
    return out;
  }

  const noDraws = (feed: Feed) => views[feed].tape.length === 0 && (
    <span style={{ position: 'absolute', left: 2, top: 2, fontFamily: mono, fontSize: 9.5, color: '#4b5568', whiteSpace: 'nowrap' }}>no draws logged yet</span>
  );

  return (
    <div data-testid="pair-tape" title={`Both screens, one clock. ${SCALE_NOTE}`} style={{ position: 'relative', display: 'flex', overflowX: 'auto' }} ref={stripRef}>
      <style>{`@keyframes ${PLAYHEAD_ANIM} { from { left: 0% } to { left: 100% } } @media (prefers-reduced-motion: reduce) { [data-testid="tape-playhead"] { animation: none } }`}</style>
      <span data-testid="tape-scale" title={SCALE_NOTE} style={{
        position: 'sticky', left: 0, zIndex: 4, flex: 'none', alignSelf: 'stretch', display: 'flex', alignItems: 'center', gap: 4,
        fontFamily: mono, fontSize: 9, color: '#4b5568', background: '#0e1119', padding: '0 5px', cursor: 'help',
      }}>
        {onZoom && zoomButton('−', zoomOut, 'tape-zoom-out')}
        <span data-testid="tape-scale-label">{px} px/s</span>
        {onZoom && zoomButton('+', zoomIn, 'tape-zoom-in')}
      </span>
      <div style={{ position: 'relative', width, height: totalH, flex: 'none' }}>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: totalH }}>{beatGrid()}</div>
        <div style={{ position: 'absolute', top: rowTop.sunrise, left: 0, right: 0, height: rowH }}>
          {noDraws('sunrise')}
          {seamsOf('sunrise')}
          {pastRow('sunrise')}
          {currentRow('sunrise')}
          {nextRow('sunrise')}
        </div>
        <div style={{ position: 'absolute', top: rowTop.ruler, left: 0, right: 0, height: RULER_H }}>{ruler()}</div>
        <div style={{ position: 'absolute', top: rowTop.sunset, left: 0, right: 0, height: rowH }}>
          {noDraws('sunset')}
          {seamsOf('sunset')}
          {pastRow('sunset')}
          {currentRow('sunset')}
          {nextRow('sunset')}
        </div>
        {ties()}
      </div>
    </div>
  );
}
