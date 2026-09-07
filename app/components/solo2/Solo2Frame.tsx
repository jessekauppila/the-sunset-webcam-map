'use client';

import type { EntryView, ViewEntry } from '@/app/api/kiosk/solo/view';
import { pictureRect } from '@/app/lib/solo/caption';
import { scoreLine } from '@/app/lib/solo/scores';
import type { Feed } from '@/app/lib/solo/types';
import { Caption } from '@/app/components/solo/Caption';
import { stepFadeS, type DwellPlan, type Stage } from '@/app/lib/solo2/plan';
import type { Solo2Dials } from '@/app/lib/solo2/types';

const mono = 'ui-monospace, SFMono-Regular, Menlo, monospace';

/** A frame of the run: a view entry, with its bin rank when the caller has one. */
export type RunFrame = ViewEntry & { rank?: number };

const KEYFRAMES = `
@keyframes solo2-fade-in { from { opacity: 0 } to { opacity: 1 } }
@keyframes solo2-dip { from { opacity: 0 } to { opacity: 1 } }
`;

/**
 * How this dwell arrives (rhythm spec §4.2). The same camera always
 * dissolves, over the same-camera fade; a camera change uses the transition
 * dial and its fade. Exported so the studio can say the same thing about a
 * queued row.
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
 * One dwell on one panel (camera-run spec §4). Layers, bottom to top: the
 * previous frame (unless the arrival is a cut), the dip's black veil, then
 * the run: every frame stacked oldest first, each opaque once the
 * clock-driven stage has reached it and dissolving in over the same-camera
 * fade capped at its share. The caption and the score overlays follow the
 * frame that is up, so the words and the score on glass are always those of
 * the picture on glass. The caption arrives on the picture's own transition —
 * the outgoing words sit under the veil, the new ones fade in with the new
 * frame — and inside a run, where every frame is the same camera, the title
 * and the place hold still while only the clock steps.
 */
export function Solo2Frame({ entry, run, previous, stage, plan, dials, width, height, feed, dwellKey }: {
  /** The drawn frame: the run's last. */
  entry: EntryView;
  /**
   * What identifies this dwell, so a new one rebuilds rather than fades. The
   * drawn frame is not enough on its own: the studio preview replays the same
   * frame whenever there is no queue behind it, and a run that restarts inside
   * a mounted stack lowers `shown`, leaving the layers above it to dissolve
   * away and reveal the oldest picture. Callers pass the dwell's start.
   */
  dwellKey?: string | number;
  /** What the dwell plays, oldest first, `entry` last (run.ts `runOf`). */
  run: RunFrame[];
  previous: ViewEntry | null;
  stage: Stage;
  plan: DwellPlan;
  dials: Solo2Dials;
  width: number;
  height: number;
  /** The screen, for the caption's prefix dial. */
  feed?: Feed;
}) {
  const layer = { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' } as const;
  // Where the picture sits (full-bleed or inset on black, per the caption
  // dials). The previous frame and the stack take this box; the layers inside
  // the stack fill it.
  const picture = pictureRect(dials, width, height);
  const pictureLayer = {
    position: 'absolute', left: picture.left, top: picture.top, width: picture.width, height: picture.height, objectFit: 'cover',
  } as const;
  // The caption is panel-relative, not picture-relative, so its layers span
  // the panel rather than the picture box. Never a click target.
  const captionLayer = { position: 'absolute', inset: 0, pointerEvents: 'none' } as const;
  const scale = Math.max(1, Math.min(width, height) / 540); // score overlay text scales with the panel
  const sequence: RunFrame[] = run.length > 0 ? run : [entry];
  const shown = Math.min(stage.index, sequence.length - 1);
  const up = sequence[shown];
  const rank = up.rank ?? entry.rank;
  // Every per-dwell key hangs off this, so one dwell is one stack.
  const dwellId = dwellKey ?? entry.snapshotId;
  const stepFade = stepFadeS(dials.sameCameraFadeS, plan);

  const arrive = arrival(entry, previous, dials);
  const showPrevious = arrive.kind !== 'cut' && !!previous;
  const inAnimation =
    arrive.kind === 'crossfade' ? `solo2-fade-in ${arrive.fadeS}s ease both`
    : arrive.kind === 'dip' ? `solo2-fade-in ${arrive.fadeS / 2}s ease ${arrive.fadeS / 2}s both`
    : undefined;

  // The lead: a slow push over the last seconds, driven by the clock stage
  // so a late tab is in sync. No transition when the progress is 0, so a
  // new frame lands at scale 1 without shrinking into place.
  const leadProgress = stage.leadProgress;
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
      {showPrevious && (
        // The words being left behind, under the veil and under the arriving
        // caption, so the caption dissolves exactly as the picture does.
        <div key={`caption-prev-${previous.snapshotId}`} data-testid="caption-prev" style={captionLayer}>
          <Caption entry={previous} dials={dials} picture={picture} width={width} height={height} feed={feed} />
        </div>
      )}
      {arrive.kind === 'dip' && showPrevious && (
        <div key={`dip-${dwellId}`} data-testid="dip" style={{
          ...layer, background: '#000', animation: `solo2-dip ${arrive.fadeS / 2}s linear both`,
        }} />
      )}
      {/* keyed by the drawn frame so the arrival runs once per dwell; the stage only changes opacities inside */}
      <div key={`stack-${dwellId}`} data-testid="stack" style={{ ...pictureLayer, animation: inAnimation }}>
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
      {/* keyed like the stack, so the words arrive with the picture and once
          per dwell; inside the dwell only the clock moves. */}
      <div key={`caption-${dwellId}`} data-testid="caption-layer" style={{ ...captionLayer, animation: inAnimation }}>
        <Caption entry={up} dials={dials} picture={picture} width={width} height={height} feed={feed}
          step={shown > 0 ? { from: sequence[shown - 1], fadeS: stepFade } : null} />
      </div>
      {(dials.showScores || dials.showRank || dials.showTally) && (
        <div style={{
          position: 'absolute', right: 24 * scale, bottom: 20 * scale, color: '#fff',
          textShadow: '0 1px 4px #000', fontFamily: mono, fontSize: 16 * scale, textAlign: 'right', lineHeight: 1.4,
        }}>
          {dials.showTally && <div>shown <b style={{ color: '#f5a344' }}>×{up.tally}</b></div>}
          {dials.showRank && <div>{up.bin === 'sunset' ? 'sunset' : 'non-sunset'} bin #{rank}</div>}
          {dials.showScores && (
            <div>{scoreLine(up)}</div>
          )}
        </div>
      )}
    </div>
  );
}
