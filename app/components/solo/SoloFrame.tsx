'use client';

import type { EntryView } from '@/app/api/kiosk/solo/view';
import type { Feed, SoloDials } from '@/app/lib/solo/types';
import { pictureRect } from '@/app/lib/solo/caption';
import { scoreLine } from '@/app/lib/solo/scores';
import { Caption } from './Caption';

const mono = 'ui-monospace, SFMono-Regular, Menlo, monospace';

/**
 * One frame on the panel: full-bleed when the caption layout is overlay,
 * inset on black when it is inset (lib/solo/caption.ts says where). The
 * previous frame sits underneath so a fade dial above zero crossfades
 * instead of cutting; at zero the top layer is simply there. The caption
 * crossfades on the same dial, so the words never cut while the picture
 * dissolves. Overlays are what the live dials say and nothing else.
 */
export function SoloFrame({ entry, previous, fadeS, dials, width, height, feed }: {
  entry: EntryView;
  previous: EntryView | null;
  fadeS: number;
  dials: SoloDials;
  width: number;
  height: number;
  /** The screen, for the caption's prefix dial. */
  feed?: Feed;
}) {
  const picture = pictureRect(dials, width, height);
  const layer = {
    position: 'absolute', left: picture.left, top: picture.top, width: picture.width, height: picture.height, objectFit: 'cover',
  } as const;
  const scale = Math.max(1, Math.min(width, height) / 540); // score overlay text scales with the panel
  // The caption is panel-relative, not picture-relative, so its layers span
  // the panel rather than the picture box. Never a click target.
  const captionLayer = { position: 'absolute', inset: 0, pointerEvents: 'none' } as const;
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
      <style>{'@keyframes solo-fade-in { from { opacity: 0 } to { opacity: 1 } }\n@keyframes solo-fade-out { from { opacity: 1 } to { opacity: 0 } }'}</style>
      {previous && fadeS > 0 && (
        // The words being left behind. They have to dissolve, not merely be
        // covered: the arriving picture is opaque, but a caption is
        // transparent between its letters, so words left at full opacity stay
        // legible under the new ones for the whole dwell. Both halves name the
        // same timing function, which makes their opacities sum to 1 at every
        // instant — the mismatch PR #160 fixed, avoided here by construction.
        // Only while the dial fades: at a cut they would sit under identical text.
        <div key={`caption-prev-${previous.snapshotId}`} data-testid="caption-prev"
          style={{ ...captionLayer, animation: `solo-fade-out ${fadeS}s ease both` }}>
          <Caption entry={previous} dials={dials} picture={picture} width={width} height={height} feed={feed} />
        </div>
      )}
      <div key={`caption-${entry.snapshotId}`} data-testid="caption-layer" style={{
        ...captionLayer, animation: fadeS > 0 ? `solo-fade-in ${fadeS}s ease` : undefined,
      }}>
        <Caption entry={entry} dials={dials} picture={picture} width={width} height={height} feed={feed} />
      </div>
      {(dials.showScores || dials.showRank || dials.showTally) && (
        <div style={{
          position: 'absolute', right: 24 * scale, bottom: 20 * scale, color: '#fff',
          textShadow: '0 1px 4px #000', fontFamily: mono, fontSize: 16 * scale, textAlign: 'right', lineHeight: 1.4,
        }}>
          {dials.showTally && <div>shown <b style={{ color: '#f5a344' }}>×{entry.tally}</b></div>}
          {dials.showRank && <div>{entry.bin === 'sunset' ? 'sunset' : 'non-sunset'} bin #{entry.rank}</div>}
          {dials.showScores && (
            <div>{scoreLine(entry)}</div>
          )}
        </div>
      )}
    </div>
  );
}
