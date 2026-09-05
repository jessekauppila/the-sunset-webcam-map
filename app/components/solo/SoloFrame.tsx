'use client';

import type { EntryView } from '@/app/api/kiosk/solo/view';
import type { SoloDials } from '@/app/lib/solo/types';
import { pictureRect } from '@/app/lib/solo/caption';
import { Caption } from './Caption';

const mono = 'ui-monospace, SFMono-Regular, Menlo, monospace';

/**
 * One frame on the panel: full-bleed when the caption layout is overlay,
 * inset on black when it is inset (lib/solo/caption.ts says where). The
 * previous frame sits underneath so a fade dial above zero crossfades
 * instead of cutting; at zero the top layer is simply there. Overlays are
 * what the live dials say and nothing else.
 */
export function SoloFrame({ entry, previous, fadeS, dials, width, height }: {
  entry: EntryView;
  previous: EntryView | null;
  fadeS: number;
  dials: SoloDials;
  width: number;
  height: number;
}) {
  const picture = pictureRect(dials, width, height);
  const layer = {
    position: 'absolute', left: picture.left, top: picture.top, width: picture.width, height: picture.height, objectFit: 'cover',
  } as const;
  const scale = Math.max(1, Math.min(width, height) / 540); // score overlay text scales with the panel
  return (
    <div style={{ position: 'relative', width, height, background: '#000', overflow: 'hidden' }}>
      {previous && (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={previous.snapshotId} src={previous.imageUrl} alt="" role="presentation" style={layer} />
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        key={entry.snapshotId}
        src={entry.imageUrl}
        alt=""
        role="presentation"
        style={{
          ...layer,
          animation: fadeS > 0 ? `solo-fade-in ${fadeS}s ease` : undefined,
          transition: `opacity ${fadeS}s ease`,
        }}
      />
      <style>{'@keyframes solo-fade-in { from { opacity: 0 } to { opacity: 1 } }'}</style>
      <Caption entry={entry} dials={dials} picture={picture} width={width} />
      {(dials.showScores || dials.showRank || dials.showTally) && (
        <div style={{
          position: 'absolute', right: 24 * scale, bottom: 20 * scale, color: '#fff',
          textShadow: '0 1px 4px #000', fontFamily: mono, fontSize: 16 * scale, textAlign: 'right', lineHeight: 1.4,
        }}>
          {dials.showTally && <div>shown <b style={{ color: '#f5a344' }}>×{entry.tally}</b></div>}
          {dials.showRank && <div>{entry.bin === 'sunset' ? 'sunset' : 'non-sunset'} bin #{entry.rank}</div>}
          {dials.showScores && (
            <div>{entry.bin === 'sunset' ? `q ${(entry.quality ?? 0).toFixed(2)} · ` : ''}d {entry.detection.toFixed(2)}</div>
          )}
        </div>
      )}
    </div>
  );
}
