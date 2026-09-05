'use client';

import type { EntryView } from '@/app/api/kiosk/solo/view';
import type { SoloDials } from '@/app/lib/solo/types';

const mono = 'ui-monospace, SFMono-Regular, Menlo, monospace';

/**
 * One frame filling the panel. The previous frame sits underneath so a fade
 * dial above zero crossfades instead of cutting; at zero the top layer is
 * simply there. Overlays are what the live dials say and nothing else.
 */
export function SoloFrame({ entry, previous, fadeS, dials, width, height }: {
  entry: EntryView;
  previous: EntryView | null;
  fadeS: number;
  dials: SoloDials;
  width: number;
  height: number;
}) {
  const layer = { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' } as const;
  const scale = Math.max(1, Math.min(width, height) / 540); // overlay text scales with the panel
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
      {dials.showPlace && (
        <div style={{
          position: 'absolute', left: 24 * scale, bottom: 20 * scale, color: '#fff',
          textShadow: '0 1px 4px #000', fontSize: 22 * scale, lineHeight: 1.2,
        }}>
          {entry.title}
          <div style={{ fontSize: 15 * scale, opacity: 0.85 }}>
            {[entry.region, entry.country].filter(Boolean).join(', ')}
          </div>
        </div>
      )}
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
