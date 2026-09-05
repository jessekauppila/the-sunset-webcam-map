'use client';

import type { EntryView } from '@/app/api/kiosk/solo/view';
import type { Feed } from '@/app/lib/solo/types';

const COLOR = { sunset: '#7ee2ac', non_sunset: '#c3cad6' } as const;
const mono = 'ui-monospace, SFMono-Regular, Menlo, monospace';

function Tag({ children, bg, fg, title }: { children: string; bg: string; fg: string; title: string }) {
  return (
    <span title={title} style={{
      display: 'inline-block', fontSize: 8.5, fontWeight: 700, padding: '1px 4px', borderRadius: 3,
      marginRight: 3, background: bg, color: fg, cursor: 'help',
    }}>{children}</span>
  );
}

/**
 * One frame, wherever it sits: a bin or the queue. The outline is always the
 * colour of the bin the frame belongs to, so the queue reads at a glance.
 */
export function EntryRow({ entry: e, feed, place, onGlass = false, repeat = false, cameraIndex, onClick }: {
  entry: EntryView;
  feed: Feed;
  place: 'sunset' | 'non_sunset' | 'queue';
  onGlass?: boolean;
  repeat?: boolean;
  cameraIndex?: { n: number; m: number };
  onClick: (entry: EntryView) => void;
}) {
  const scores = e.bin === 'sunset'
    ? `q ${(e.quality ?? 0).toFixed(2)} d ${e.detection.toFixed(2)}`
    : `d ${e.detection.toFixed(2)}`;
  const placeText = [e.city, e.country].filter(Boolean).join(', ');
  const title =
    `${e.title} · ${placeText}. Frame ${e.snapshotId}, ${feed} feed` +
    (place === 'queue' ? ', in the queue. ' : '. ') +
    (e.bin === 'sunset' ? 'Sunset bin, ordered by quality. ' : 'Non-sunset bin, ordered by detection. ') +
    (!e.eligible ? 'Below the floor dial; not eligible. ' : '') +
    (repeat ? 'Already appears earlier in the queue; this is a repeat showing. ' : '') +
    `Shown ${e.tally} time${e.tally === 1 ? '' : 's'} today.`;
  return (
    <button type="button" onClick={() => onClick(e)} title={title} style={{
      display: 'grid', gridTemplateColumns: '46px 1fr', gap: 5, alignItems: 'center', width: '100%',
      textAlign: 'left', border: `1.5px solid ${COLOR[e.bin]}`, borderRadius: 5, padding: 3, marginBottom: 4,
      background: '#0e1119', fontFamily: mono, fontSize: 9.5, color: '#9aa3b2', cursor: 'pointer',
      opacity: !e.eligible || repeat ? 0.45 : 1, boxShadow: onGlass ? '0 0 0 2px #f5a344' : undefined,
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
        </div>
        <div style={{ color: '#c3cad6', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.title}</div>
        <div style={{ color: '#6b7280', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{placeText}</div>
      </div>
    </button>
  );
}
