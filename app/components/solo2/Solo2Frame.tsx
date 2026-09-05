'use client';

import type { EntryView } from '@/app/api/kiosk/solo/view';
import { captionLines } from '@/app/lib/solo2/caption';
import type { DwellPlan, Stage } from '@/app/lib/solo2/plan';
import type { Solo2Dials } from '@/app/lib/solo2/types';

const mono = 'ui-monospace, SFMono-Regular, Menlo, monospace';

export interface PreludeFrame {
  snapshotId: number;
  imageUrl: string;
}

const KEYFRAMES = `
@keyframes solo2-fade-in { from { opacity: 0 } to { opacity: 1 } }
@keyframes solo2-dip { from { opacity: 0 } to { opacity: 1 } }
`;

/**
 * One dwell on one panel (spec §4). Layers, bottom to top: the previous
 * frame (unless the transition is a cut), the dip's black veil, and the top
 * image, which is a prelude frame or the chosen frame depending on the
 * stage. The chosen frame's overlays mount only when it is on; prelude
 * frames carry nothing, so the score on glass is always the score of the
 * picture on glass.
 */
export function Solo2Frame({ entry, prelude, previous, stage, plan, dials, width, height }: {
  entry: EntryView;
  prelude: PreludeFrame[];
  previous: EntryView | null;
  stage: Stage;
  plan: DwellPlan;
  dials: Solo2Dials;
  width: number;
  height: number;
}) {
  const layer = { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' } as const;
  const scale = Math.max(1, Math.min(width, height) / 540); // overlay text scales with the panel
  const onMain = stage.layer === 'main';
  const top = onMain ? entry : prelude[Math.min(stage.index, prelude.length - 1)] ?? entry;
  const fade = dials.transition === 'cut' ? 0 : dials.fadeS;
  const showPrevious = fade > 0 && !!previous;

  const inAnimation =
    dials.transition === 'crossfade' && fade > 0 ? `solo2-fade-in ${fade}s ease both`
    : dials.transition === 'dip' && fade > 0 ? `solo2-fade-in ${fade / 2}s ease ${fade / 2}s both`
    : undefined;

  // The lead: a slow push over the last seconds, driven by the clock stage
  // so a late tab is in sync. No transition when the progress is 0, so a
  // new frame lands at scale 1 without shrinking into place.
  const leadProgress = onMain ? stage.leadProgress : 0;
  const push = 1 + (dials.leadScale - 1) * leadProgress;
  const pushStyle = {
    position: 'absolute', inset: 0,
    transform: `scale(${push.toFixed(4)})`,
    transition: leadProgress > 0 && plan.leadS > 0 ? 'transform 260ms linear' : 'none',
  } as const;

  const caption = onMain ? captionLines(entry, dials) : null;

  return (
    <div style={{ position: 'relative', width, height, background: '#000', overflow: 'hidden' }}>
      <style>{KEYFRAMES}</style>
      {showPrevious && (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={`prev-${previous.snapshotId}`} src={previous.imageUrl} alt="" role="presentation" style={layer} />
      )}
      {dials.transition === 'dip' && showPrevious && (
        <div key={`dip-${entry.snapshotId}`} data-testid="dip" style={{
          ...layer, background: '#000', animation: `solo2-dip ${fade / 2}s linear both`,
        }} />
      )}
      {/* keyed by the chosen frame so the entry animation runs once per dwell; prelude steps only swap the src */}
      <div key={`top-${entry.snapshotId}`} style={{ ...layer, animation: inAnimation }}>
        <div style={pushStyle} data-testid="push">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={top.imageUrl} alt="" role="presentation" data-testid="top" style={layer} />
        </div>
      </div>
      {caption && (
        <div style={{
          position: 'absolute', left: 24 * scale, bottom: 20 * scale, color: '#fff',
          textShadow: '0 1px 4px #000', fontSize: 22 * scale, lineHeight: 1.2,
        }}>
          {caption.title}
          <div style={{ fontSize: 15 * scale, opacity: 0.85 }}>{caption.sub}</div>
        </div>
      )}
      {onMain && (dials.showScores || dials.showRank || dials.showTally) && (
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
