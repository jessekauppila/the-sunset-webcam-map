'use client';

import type { EntryView } from '@/app/api/kiosk/solo/view';
import { pictureRect } from '@/app/lib/solo/caption';
import { Caption } from '@/app/components/solo/Caption';
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
 * How this dwell arrives (spec §4.2). The same camera always dissolves, over
 * the same-camera fade; a camera change uses the transition dial and its
 * fade. Exported so the studio can say the same thing about a queued row.
 */
export function arrival(
  entry: { webcamId: number }, previous: { webcamId: number } | null, d: Pick<Solo2Dials, 'transition' | 'fadeS' | 'sameCameraFadeS'>,
): { kind: Solo2Dials['transition']; fadeS: number } {
  if (previous && previous.webcamId === entry.webcamId) {
    return d.sameCameraFadeS > 0 ? { kind: 'crossfade', fadeS: d.sameCameraFadeS } : { kind: 'cut', fadeS: 0 };
  }
  return d.transition === 'cut' || d.fadeS <= 0 ? { kind: 'cut', fadeS: 0 } : { kind: d.transition, fadeS: d.fadeS };
}

/**
 * One dwell on one panel (spec §4). Layers, bottom to top: the previous
 * frame (unless the arrival is a cut), the dip's black veil, then the
 * sequence: every prelude frame and the chosen frame stacked in capture
 * order, each opaque once the clock-driven stage has reached it and
 * dissolving in over the same-camera fade. The chosen frame's overlays mount
 * only when it is on; prelude frames carry nothing, so the score on glass is
 * always the score of the picture on glass.
 */
export function Solo2Frame({ entry, prelude, previous, stage, plan, dials, width, height }: {
  entry: EntryView;
  /** Already cut to what the plan shows (preludePlan), oldest first. */
  prelude: PreludeFrame[];
  previous: EntryView | null;
  stage: Stage;
  plan: DwellPlan;
  dials: Solo2Dials;
  width: number;
  height: number;
}) {
  const layer = { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' } as const;
  // Where the picture sits (full-bleed or inset on black, per the caption
  // dials). The previous frame and the stack take this box; the layers inside
  // the stack fill it.
  const picture = pictureRect(dials, width, height);
  const pictureLayer = {
    position: 'absolute', left: picture.left, top: picture.top, width: picture.width, height: picture.height, objectFit: 'cover',
  } as const;
  const scale = Math.max(1, Math.min(width, height) / 540); // score overlay text scales with the panel
  const onMain = stage.layer === 'main';
  const sequence: PreludeFrame[] = [...prelude, entry];
  const shown = onMain ? sequence.length - 1 : Math.min(stage.index, prelude.length - 1);
  const stepFade = Math.min(Math.max(0, dials.sameCameraFadeS), plan.preludeStepS);

  const arrive = arrival(entry, previous, dials);
  const showPrevious = arrive.kind !== 'cut' && !!previous;
  const inAnimation =
    arrive.kind === 'crossfade' ? `solo2-fade-in ${arrive.fadeS}s ease both`
    : arrive.kind === 'dip' ? `solo2-fade-in ${arrive.fadeS / 2}s ease ${arrive.fadeS / 2}s both`
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

  return (
    <div style={{ position: 'relative', width, height, background: '#000', overflow: 'hidden' }}>
      <style>{KEYFRAMES}</style>
      {showPrevious && (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={`prev-${previous.snapshotId}`} src={previous.imageUrl} alt="" role="presentation" style={pictureLayer} />
      )}
      {arrive.kind === 'dip' && showPrevious && (
        <div key={`dip-${entry.snapshotId}`} data-testid="dip" style={{
          ...layer, background: '#000', animation: `solo2-dip ${arrive.fadeS / 2}s linear both`,
        }} />
      )}
      {/* keyed by the chosen frame so the arrival runs once per dwell; the stage only changes opacities inside */}
      <div key={`stack-${entry.snapshotId}`} data-testid="stack" style={{ ...pictureLayer, animation: inAnimation }}>
        <div style={pushStyle} data-testid="push">
          {sequence.map((f, i) => (
            <div key={f.snapshotId} data-testid={`seq-${i}`} style={{
              ...layer, opacity: i <= shown ? 1 : 0,
              transition: i > 0 && stepFade > 0 ? `opacity ${stepFade}s linear` : 'none',
            }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={f.imageUrl} alt="" role="presentation" data-testid={i === shown ? 'top' : undefined} style={layer} />
            </div>
          ))}
        </div>
      </div>
      {onMain && <Caption entry={entry} dials={dials} picture={picture} width={width} />}
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
