'use client';

import type { EntryView } from '@/app/api/kiosk/solo/view';
import type { Feed } from '@/app/lib/solo/types';
import { formatTime } from '@/app/lib/solo2/caption';
import type { Role } from '@/app/lib/solo2/types';

const COLOR = { sunset: '#7ee2ac', non_sunset: '#c3cad6' } as const;
const mono = 'ui-monospace, SFMono-Regular, Menlo, monospace';
const LIGHT = '#2a3242';

/** Height is time on the solo2 studio: this many pixels per second of glass. */
export const PX_PER_S = 4;
/** A prelude step shorter than this many pixels would hide its thumbnail. */
export const MIN_FRAME_PX = 14;

/** What plays before the chosen frame in one dwell, as the glass would show it. */
export interface Sequence {
  /** Earlier frames of the same camera, oldest first, already cut to what the dwell fits. */
  earlier: EntryView[];
  stepS: number;
  /** The rest of the dwell: hold plus lead. */
  holdS: number;
}

function Tag({ children, bg, fg, title }: { children: string; bg: string; fg: string; title: string }) {
  return (
    <span title={title} style={{
      display: 'inline-block', fontSize: 8.5, fontWeight: 700, padding: '1px 4px', borderRadius: 3,
      marginRight: 3, background: bg, color: fg, cursor: 'help',
    }}>{children}</span>
  );
}

const clock = (e: EntryView) => formatTime('12h', e.capturedAt, e.timezone, null);

/**
 * One frame, wherever it sits: a bin or the queue. The outline is always the
 * colour of the bin the frame belongs to, so the queue reads at a glance.
 * With a `sequence` the row becomes a group: the earlier frames stacked
 * above the chosen one in capture order, each its own light box with its
 * local time, all inside one bin-coloured border, so a dwell that plays
 * several pictures reads as one box. With `rowS` the row is as tall as the
 * time it gets on glass.
 */
export function EntryRow({
  entry: e, feed, place, onGlass = false, repeat = false, cameraIndex, role, sequence, rowS, preluded = false, onClick,
}: {
  entry: EntryView;
  feed: Feed;
  place: 'sunset' | 'non_sunset' | 'queue';
  onGlass?: boolean;
  repeat?: boolean;
  cameraIndex?: { n: number; m: number };
  /** solo2: what this queued draw is inside its bar. */
  role?: Role;
  /** solo2: the prelude this dwell plays first. */
  sequence?: Sequence;
  /** solo2: seconds this row stands for; its height follows. */
  rowS?: number;
  /** solo2: an earlier queued dwell already showed this frame inside its prelude. */
  preluded?: boolean;
  onClick: (entry: EntryView) => void;
}) {
  const scores = e.bin === 'sunset'
    ? `q ${(e.quality ?? 0).toFixed(2)} d ${e.detection.toFixed(2)}`
    : `d ${e.detection.toFixed(2)}`;
  const placeText = [[e.city, e.country].filter(Boolean).join(', '), clock(e)].filter(Boolean).join(' · ');
  const title =
    `${e.title} · ${placeText}. Frame ${e.snapshotId}, ${feed} feed` +
    (place === 'queue' ? ', in the queue. ' : '. ') +
    (e.bin === 'sunset' ? 'Sunset bin, ordered by quality. ' : 'Non-sunset bin, ordered by detection. ') +
    (!e.eligible ? 'Below the floor dial; not eligible. ' : '') +
    (repeat ? 'Already appears earlier in the queue; this is a repeat showing. ' : '') +
    (preluded ? 'Already shown inside an earlier queued frame\'s prelude; this is its own turn. ' : '') +
    (sequence ? `Plays ${sequence.earlier.length} earlier frame${sequence.earlier.length === 1 ? '' : 's'} of this camera first, ${sequence.stepS} s each. ` : '') +
    `Shown ${e.tally} time${e.tally === 1 ? '' : 's'} today.`;
  const grouped = !!sequence && sequence.earlier.length > 0;
  const ring = onGlass ? '0 0 0 2px #f5a344' : undefined;

  const main = (
    <button type="button" onClick={() => onClick(e)} title={title} style={{
      display: 'grid', gridTemplateColumns: '46px 1fr', gap: 5, alignItems: 'center', width: '100%',
      textAlign: 'left', borderRadius: 5, padding: 3, marginBottom: grouped ? 0 : 4,
      border: grouped ? `1px solid ${LIGHT}` : `1.5px solid ${COLOR[e.bin]}`,
      minHeight: grouped ? Math.max(0, sequence.holdS * PX_PER_S) : rowS !== undefined ? rowS * PX_PER_S : undefined,
      background: '#0e1119', fontFamily: mono, fontSize: 9.5, color: '#9aa3b2', cursor: 'pointer',
      opacity: !e.eligible || repeat ? 0.45 : 1, boxShadow: grouped ? undefined : ring,
    }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={e.imageUrl} alt="" style={{ width: 46, aspectRatio: '16/9', objectFit: 'cover', borderRadius: 3, display: 'block' }} />
      <div style={{ minWidth: 0 }}>
        <span style={{ fontWeight: e.tally > 0 ? 800 : 500, color: e.tally > 0 ? '#e5e7eb' : '#6b7280' }}>
          shown ×{e.tally}
        </span>
        {' · '}{scores}{repeat ? ' · repeat' : ''}
        <div style={{ marginTop: 2 }}>
          {e.isNew && <Tag bg="#f5a344" fg="#1a1000" title="Newer frame from a camera already in the bin">NEW</Tag>}
          {!e.eligible && <Tag bg="#3a4356" fg="#e5e7eb" title="Below the floor dial">FLOOR</Tag>}
          {cameraIndex && (
            <Tag bg="#7ea6e2" fg="#061224" title="Same camera as another queue entry">{`CAM ${cameraIndex.n}/${cameraIndex.m}`}</Tag>
          )}
          {preluded && (
            <Tag bg="#5b4b8a" fg="#efe9ff" title="An earlier queued frame already shows this picture inside its prelude; this is its own turn">PRELUDE</Tag>
          )}
          {role === 'peak' && <Tag bg="#f5a344" fg="#1a1000" title="Beat 0 of the bar: the best remaining frame">PEAK</Tag>}
          {role === 'valley' && <Tag bg="#3a4356" fg="#e5e7eb" title="A valley: the lowest eligible frame, unshown first">VALLEY</Tag>}
        </div>
        <div style={{ color: '#c3cad6', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.title}</div>
        <div style={{ color: '#6b7280', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{placeText}</div>
      </div>
    </button>
  );

  if (!grouped) return main;

  const stepPx = Math.max(MIN_FRAME_PX, sequence.stepS * PX_PER_S);
  return (
    <div role="group" aria-label={`${e.title}: ${sequence.earlier.length + 1} frames in one dwell`} style={{
      border: `2px solid ${COLOR[e.bin]}`, borderRadius: 6, padding: 3, marginBottom: 4,
      background: '#0b0e14', boxShadow: ring, display: 'flex', flexDirection: 'column', gap: 3,
    }}>
      {sequence.earlier.map((f) => {
        const t = clock(f) ?? `${Math.max(1, Math.round((e.capturedAt - f.capturedAt) / 60_000))} min earlier`;
        return (
          <button key={f.snapshotId} type="button" onClick={() => onClick(f)}
            title={`${f.title} · ${t}. Frame ${f.snapshotId}, shown for ${sequence.stepS} s as part of this dwell's prelude, without a caption.`}
            style={{
              display: 'flex', gap: 5, alignItems: 'center', width: '100%', boxSizing: 'border-box', height: stepPx,
              textAlign: 'left', border: `1px solid ${LIGHT}`, borderRadius: 4, padding: '0 3px',
              background: '#0e1119', fontFamily: mono, fontSize: 9, color: '#9aa3b2', cursor: 'pointer',
            }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={f.imageUrl} alt="" style={{ height: '100%', aspectRatio: '16/9', objectFit: 'cover', borderRadius: 2, display: 'block' }} />
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t}</span>
          </button>
        );
      })}
      {main}
    </div>
  );
}
