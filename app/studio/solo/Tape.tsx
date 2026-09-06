'use client';

import { useEffect, useRef } from 'react';
import type { EntryView } from '@/app/api/kiosk/solo/view';
import type { TapeFrame } from '@/app/lib/solo/store';
import type { BinKind } from '@/app/lib/solo/types';

const COLOR: Record<BinKind, string> = { sunset: '#7ee2ac', non_sunset: '#c3cad6' };
const NEUTRAL = '#2a3242';
const REPEAT = '#8b2e2e';
const RING = '0 0 0 2px #f5a344';
const mono = 'ui-monospace, SFMono-Regular, Menlo, monospace';
export const THUMB_W = 40;
export const THUMB_H = 22;

const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const place = (f: { city: string; country: string }) => [f.city, f.country].filter(Boolean).join(', ');

function Thumb({ testId, src, color, dashed = false, ring = false, repeat = false, title, onClick }: {
  testId: string; src: string; color: string; dashed?: boolean; ring?: boolean; repeat?: boolean; title: string;
  onClick?: () => void;
}) {
  return (
    <button type="button" data-testid={testId} title={title} onClick={onClick} disabled={!onClick} style={{
      flex: 'none', width: THUMB_W, height: THUMB_H, padding: 0, background: '#000', cursor: onClick ? 'pointer' : 'default',
      borderWidth: 1.5, borderStyle: dashed ? 'dashed' : 'solid', borderColor: color, borderTopColor: repeat ? REPEAT : color,
      borderTopWidth: repeat ? 3 : 1.5, borderRadius: 3, boxShadow: ring ? RING : undefined, boxSizing: 'border-box',
    }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
    </button>
  );
}

/**
 * The tape (stages-and-tape spec §4): what this screen drew, is drawing, and
 * will draw, in one strip. Past thumbs are fact from the draw log; the frame
 * on glass wears the orange ring; a seam separates fact from the projection,
 * whose thumbs are dashed. A frame already seen earlier on the strip carries
 * a red top edge, the REPEAT tag's colour. Scrolls sideways; on mount and
 * whenever the past grows, the seam is brought to about two thirds across.
 */
export function Tape({ past, current, next, onSelect }: {
  past: TapeFrame[];
  current: EntryView | null;
  next: EntryView[];
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

  return (
    <div ref={strip} data-testid="tape" title="The tape: past draws, the frame on glass, then the projected next draws"
      style={{ display: 'flex', gap: 3, alignItems: 'center', overflowX: 'auto', padding: '4px 2px', minHeight: THUMB_H + 12 }}>
      {past.length === 0 && (
        <span style={{ fontFamily: mono, fontSize: 9.5, color: '#4b5568', whiteSpace: 'nowrap', paddingRight: 6 }}>no draws logged yet</span>
      )}
      {past.map((f) => (
        <Thumb key={`${f.snapshotId}-${f.slot}`} testId={`tape-past-${f.snapshotId}-${f.slot}`} src={f.imageUrl}
          color={f.bin ? COLOR[f.bin] : NEUTRAL} repeat={repeatOf(f.snapshotId)}
          title={`${f.title}${place(f) ? ` · ${place(f)}` : ''} · draw at ${clock(f.shownAt)}`} />
      ))}
      {current && (
        <Thumb testId="tape-current" src={current.imageUrl} color={COLOR[current.bin]} ring repeat={repeatOf(current.snapshotId)}
          title={`on glass · ${current.title}${place(current) ? ` · ${place(current)}` : ''}`} onClick={() => onSelect(current)} />
      )}
      <div ref={seam} data-testid="tape-seam" title="Left: what happened. Right: what the studio dials project."
        style={{ flex: 'none', width: 2, height: THUMB_H + 6, background: '#f5a344', opacity: 0.6, margin: '0 2px' }} />
      {next.map((e, i) => (
        <Thumb key={`${e.snapshotId}-${i}`} testId={`tape-next-${i}`} src={e.imageUrl} color={COLOR[e.bin]} dashed
          repeat={repeatOf(e.snapshotId)} title={`draw ${i + 1} · ${e.title}${place(e) ? ` · ${place(e)}` : ''}`}
          onClick={() => onSelect(e)} />
      ))}
    </div>
  );
}
