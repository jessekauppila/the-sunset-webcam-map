'use client';

import type { EntryView } from '@/app/api/kiosk/solo/view';
import type { Feed } from '@/app/lib/solo/types';
import type { Lane } from './queueLayout';
import { COLOR, mono } from './tapeParts';

const ORANGE = '#f5a344';
const GHOST = '#3f4759';
const LANE_H = 40;
const LINK_H = 40;

/**
 * One screen's queue, in the rules' OWN order (scheduler spec §6): a camera is
 * one box holding its series, the frames it will not play drawn dim, the one
 * the rendezvous took ringed. Below it, a line from each camera to where it
 * reached the glass — a line that crosses is a camera pulled out of turn.
 *
 * Every frame clicks through to the same label card and rating as a queue row,
 * with the whole lane as the list so the pop-up's arrows step along it.
 */
export function QueueLane({ feed, lane, onSelect }: {
  feed: Feed;
  lane: Lane<EntryView>;
  onSelect: (entry: EntryView, feed: Feed, list: EntryView[]) => void;
}) {
  const list = lane.items.flatMap((i) => i.frames);
  return (
    <div style={{ position: 'relative', width: lane.width, height: LANE_H + LINK_H }}>
      {lane.items.map((it) => (
        <div
          key={it.entry.webcamId}
          data-testid={`queue-cam-${it.position}`}
          data-took={String(it.took)}
          data-reaches={String(it.reaches)}
          title={`${it.position} in the queue${it.reaches ? ' · reaches the landing' : ''}`}
          style={{
            position: 'absolute', left: it.x, width: it.width, top: 0, height: LANE_H - 14,
            display: 'flex', gap: 1, padding: 2, boxSizing: 'border-box',
            border: `1.5px solid ${COLOR[it.entry.bin]}`, borderRadius: 4, background: '#171c26',
            boxShadow: it.took ? `0 0 0 2px ${ORANGE}` : undefined,
            // A camera that cannot reach the landing is still in the queue and
            // still drawable; it is just not a candidate for this meeting.
            opacity: it.took || it.reaches ? 1 : 0.6,
          }}
        >
          {it.frames.map((fr) => (
            <button
              key={fr.snapshotId}
              type="button"
              data-testid={`queue-frame-${fr.snapshotId}`}
              title={fr.title}
              onClick={() => onSelect(fr, feed, list)}
              style={{
                flex: 1, minWidth: 0, padding: 0, border: 0, borderRadius: 1, background: '#000',
                cursor: 'pointer', position: 'relative', overflow: 'hidden',
                // The frames the cap cuts, or the rendezvous drops: dim, in
                // place, so what a bigger cap would add is visible.
                opacity: it.playedIds.has(fr.snapshotId) ? 1 : 0.28,
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={fr.imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
              {fr.bin === 'sunset' && fr.quality != null && (
                <span aria-hidden style={{
                  position: 'absolute', left: 0, bottom: 0, height: 2,
                  width: `${Math.round(fr.quality * 100)}%`, background: COLOR.sunset, opacity: 0.9,
                }} />
              )}
            </button>
          ))}
          <span style={{
            position: 'absolute', left: 0, bottom: -13, whiteSpace: 'nowrap',
            fontFamily: mono, fontSize: 9, color: it.took ? ORANGE : '#8d95a3',
          }}>
            {it.position} · {it.entry.city || it.entry.title}
          </span>
        </div>
      ))}
      <svg width={lane.width} height={LINK_H} style={{ position: 'absolute', left: 0, top: LANE_H, overflow: 'visible' }}>
        {lane.links.map((l, i) => (
          <line
            key={i}
            data-testid="queue-link"
            x1={l.fromX} y1={0} x2={l.toX} y2={LINK_H}
            stroke={l.took ? ORANGE : GHOST}
            strokeWidth={l.took ? 2 : 1.5}
          />
        ))}
      </svg>
    </div>
  );
}
