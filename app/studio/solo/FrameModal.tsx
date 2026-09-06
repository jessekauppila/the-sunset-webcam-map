'use client';

import { useEffect } from 'react';
import type { EntryView } from '@/app/api/kiosk/solo/view';
import type { Feed } from '@/app/lib/solo/types';
import { formatTime } from '@/app/lib/solo/caption';
import { FrameLabelCard } from '@/app/components/Webcam/FrameLabelCard';
import { toWebcam } from './toWebcam';

const railBg = '#10141d';
const border = '#1d2432';
const mono = 'ui-monospace, SFMono-Regular, Menlo, monospace';

/** `7:14 pm there · 5 Sep`, or the UTC clock when the camera's zone is unknown. */
export function takenLine(e: Pick<EntryView, 'capturedAt' | 'timezone'>): string {
  const clock = formatTime('12h-there', e.capturedAt, e.timezone, null)
    ?? new Date(e.capturedAt).toISOString().slice(11, 16) + ' UTC';
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: e.timezone ?? 'UTC', day: 'numeric', month: 'short' }).formatToParts(new Date(e.capturedAt));
  const part = (t: string) => parts.find((x) => x.type === t)?.value ?? '';
  return `taken ${clock} · ${part('day')} ${part('month')}`;
}

/**
 * The frame pop-up (camera-run spec §5.3): the label card for one frame,
 * with arrows that step through the frames of the column the row came
 * from, and a line saying when the picture was taken.
 */
export function FrameModal({ list, index, feed, onIndex, onClose }: {
  list: EntryView[];
  index: number;
  feed: Feed;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const entry = list[index];
  const prev = index > 0 ? index - 1 : null;
  const next = index < list.length - 1 ? index + 1 : null;
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'ArrowLeft' && prev != null) onIndex(prev);
      else if (ev.key === 'ArrowRight' && next != null) onIndex(next);
      else if (ev.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [prev, next, onIndex, onClose]);
  if (!entry) return null;
  const arrow = (label: string, to: number | null, title: string) => (
    <button type="button" disabled={to == null} onClick={() => { if (to != null) onIndex(to); }} title={title} style={{
      background: 'transparent', color: to == null ? '#3a4356' : '#c3cad6', border: `1px solid ${border}`,
      borderRadius: 6, padding: '3px 10px', cursor: to == null ? 'default' : 'pointer', fontFamily: mono,
    }}>{label}</button>
  );
  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, background: '#000a', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <div style={{ background: railBg, border: `1px solid ${border}`, borderRadius: 10, width: 'min(760px, 92vw)', padding: 14 }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8 }}>
          {arrow('←', prev, 'Previous frame in this column (←)')}
          {arrow('→', next, 'Next frame in this column (→)')}
          <span style={{ fontFamily: mono, fontSize: 11, color: '#6b7280' }}>{index + 1} of {list.length}</span>
          <button type="button" onClick={onClose} style={{
            marginLeft: 'auto', background: 'transparent', color: '#8b95a7', border: `1px solid ${border}`,
            borderRadius: 6, padding: '3px 8px', cursor: 'pointer',
          }}>close</button>
        </div>
        <div data-testid="frame-line" style={{ fontFamily: mono, fontSize: 12, color: '#9aa3b2', marginBottom: 8 }}>
          frame {entry.snapshotId} · {entry.bin === 'sunset' ? 'sunset' : 'non-sunset'} bin · shown ×{entry.tally} · {takenLine(entry)}
        </div>
        <FrameLabelCard key={entry.snapshotId} webcam={toWebcam(entry, feed)} allowCapture={false} />
      </div>
    </div>
  );
}
