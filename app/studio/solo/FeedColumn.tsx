'use client';

import type { ReactNode } from 'react';
import type { EntryView, StateView } from '@/app/api/kiosk/solo/view';
import { nextBoundaryMs } from '@/app/lib/solo/schedule';
import type { Feed, SoloDials } from '@/app/lib/solo/types';
import type { SoloVersionSpec } from '@/app/lib/solo/versions';
import { captionLines } from '@/app/lib/solo2/caption';
import { preludePlan } from '@/app/lib/solo2/prelude';
import type { Solo2Dials } from '@/app/lib/solo2/types';
import { EntryRow, type Sequence } from './EntryRow';

const mono = 'ui-monospace, SFMono-Regular, Menlo, monospace';
const LABEL: Record<Feed, string> = { sunrise: 'Sunrise · left screen', sunset: 'Sunset · right screen' };

function Bin({ color, title, hint, children }: { color: string; title: string; hint: string; children: ReactNode }) {
  return (
    <div style={{ border: `2px solid ${color}`, borderRadius: 8, background: '#0b0e14', padding: 5, minWidth: 0 }}>
      <h5 title={hint} style={{
        margin: '0 0 6px', fontSize: 10, textTransform: 'uppercase', letterSpacing: '.04em', color, cursor: 'help',
      }}>{title}</h5>
      {children}
    </div>
  );
}

/**
 * One feed: the panel as the glass draws it (live dials), then the two bins
 * and the queue as the STUDIO dials would order them. Every frame appears in
 * exactly one of the three columns; the on-glass frame heads the queue.
 */
export function FeedColumn({ feed, server, projected, liveDials, nowMs, version, onSelect }: {
  feed: Feed;
  server: StateView;
  projected: StateView;
  liveDials: SoloDials;
  studioDials: SoloDials;
  nowMs: number;
  version?: SoloVersionSpec;
  onSelect: (entry: EntryView, feed: Feed) => void;
}) {
  const boundary = nextBoundaryMs(nowMs, feed, liveDials.dwellS, liveDials.offsetS);
  const leftS = Math.max(0, Math.ceil((boundary - nowMs) / 1000));
  const current = server.current;
  const queue: EntryView[] = [...(current ? [current.entry] : []), ...projected.next];
  const seen = new Set<number>();
  const camCount = new Map<number, number>();
  for (const e of queue) camCount.set(e.webcamId, (camCount.get(e.webcamId) ?? 0) + 1);
  const camSeen = new Map<number, number>();
  const differs =
    !!server.next[0] && !!projected.next[0] && server.next[0].snapshotId !== projected.next[0].snapshotId;
  const qSun = queue.filter((e) => e.bin === 'sunset').length;
  const qNon = queue.length - qSun;
  // Roles are parallel to projected.next; the on-glass frame at index 0 has none.
  const showRoles = version?.name === 'solo2' && (liveDials as Partial<Solo2Dials>).valleys !== undefined
    && ((projected.dials as Partial<Solo2Dials>).valleys ?? 0) > 0;
  const roleOf = (i: number) => (showRoles && i > 0 ? projected.nextRoles[i - 1] : undefined);
  // solo2: a row is as tall as its time on glass, and a dwell with a prelude
  // is one group. The pool is every frame the studio holds (bins ∪ queue),
  // which is every entry; the queue's predecessor is the "previous" frame so
  // the group continues from it, as the glass does.
  const d2 = version?.name === 'solo2' ? (projected.dials as Solo2Dials) : null;
  const rowS = d2 ? d2.dwellS : undefined;
  const all: EntryView[] = [...projected.bins.sunset, ...projected.bins.nonSunset, ...queue];
  const seqFor = (e: EntryView, prev: EntryView | null): Sequence | undefined => {
    if (!d2 || !d2.prelude) return undefined;
    const { frames, plan } = preludePlan(e, all, d2, prev);
    if (frames.length === 0) return undefined;
    return { earlier: frames, stepS: plan.preludeStepS, holdS: plan.dwellS - frames.length * plan.preludeStepS };
  };
  const queueSeqs = queue.map((e, i) => seqFor(e, i > 0 ? queue[i - 1] : null));
  const preludedInQueue = new Set(queueSeqs.flatMap((s) => s?.earlier.map((f) => f.snapshotId) ?? []));
  const cap = current && captionLines(current.entry, {
    showPlace: liveDials.showPlace, timeStyle: (liveDials as Partial<Solo2Dials>).timeStyle ?? 'off',
  });

  const caption = current && (
    <>
      {cap && (
        <div style={{ position: 'absolute', left: 12, bottom: 10, color: '#fff', textShadow: '0 1px 3px #000', fontSize: 14 }}>
          {cap.title}
          <small style={{ display: 'block', fontSize: 11, opacity: 0.8 }}>{cap.sub}</small>
        </div>
      )}
      <div style={{
        position: 'absolute', right: 12, bottom: 10, color: '#fff', textShadow: '0 1px 3px #000',
        fontFamily: mono, fontSize: 12, textAlign: 'right',
      }}>
        {liveDials.showTally && <div>shown <b style={{ color: '#f5a344' }}>×{current.entry.tally}</b></div>}
        {liveDials.showRank && <div>{current.entry.bin === 'sunset' ? 'sunset' : 'non-sunset'} bin #{current.entry.rank}</div>}
        {liveDials.showScores && (
          <div>
            {current.entry.bin === 'sunset' ? `q ${(current.entry.quality ?? 0).toFixed(2)} · ` : ''}
            d {current.entry.detection.toFixed(2)}
          </div>
        )}
      </div>
      <div style={{
        position: 'absolute', left: 0, bottom: 0, height: 3, background: '#f5a344',
        width: `${(leftS / liveDials.dwellS) * 100}%`,
      }} />
    </>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
      <h3 style={{ margin: 0, fontSize: 13, color: '#9aa3b2', display: 'flex', justifyContent: 'space-between' }}>
        <span>{LABEL[feed]}</span>
        <span title="Time until this screen changes, on the live dials' clock">
          next frame in <b style={{ color: '#f5a344', fontFamily: mono }}>{leftS} s</b>
        </span>
      </h3>
      <div
        title={current
          ? 'What this screen is drawing right now, with the on-glass overlays as deployed'
          : 'Nothing on glass yet: the solo renderer is not live, or no frame is eligible'}
        onClick={() => current && onSelect(current.entry, feed)}
        style={{
          position: 'relative', aspectRatio: '16 / 9', background: '#000', border: '1px solid #2a3242',
          borderRadius: 6, overflow: 'hidden', cursor: current ? 'pointer' : 'default',
        }}
      >
        {current ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={current.entry.imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        ) : (
          <div style={{ color: '#4b5568', fontFamily: mono, fontSize: 12, padding: 12 }}>nothing on glass yet</div>
        )}
        {caption}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.15fr', gap: 6 }}>
        <Bin color="#7ee2ac" title={`Sunset bin · ${projected.bins.sunset.length} waiting · ${qSun} queued`}
          hint="Frames the detection head calls a sunset, ordered by quality. Shown frames sink below unshown ones. Dimmed rows are below the quality floor.">
          {projected.bins.sunset.map((e) => (
            <EntryRow key={e.snapshotId} entry={e} feed={feed} place="sunset" onClick={(x) => onSelect(x, feed)}
              sequence={seqFor(e, null)} rowS={rowS} preluded={preludedInQueue.has(e.snapshotId)} />
          ))}
        </Bin>
        <Bin color="#c3cad6" title={`Non-sunset bin · ${projected.bins.nonSunset.length} waiting · ${qNon} queued`}
          hint="Frames the detection head does not call a sunset, ordered by detection probability so 'almost a sunset' is on top. Dimmed rows are below the detection floor.">
          {projected.bins.nonSunset.map((e) => (
            <EntryRow key={e.snapshotId} entry={e} feed={feed} place="non_sunset" onClick={(x) => onSelect(x, feed)}
              sequence={seqFor(e, null)} rowS={rowS} preluded={preludedInQueue.has(e.snapshotId)} />
          ))}
        </Bin>
        <Bin color="#4b5568" title="On glass + next up"
          hint="The play order for this screen, computed from both bins by the five rules with the STUDIO dials. Top row is on glass. Row outline = which bin it came from. A queued frame is no longer in its bin.">
          {differs && (
            <div style={{ fontSize: 10, color: '#f5a344', marginBottom: 4 }}>
              projected with studio dials; glass will draw {server.next[0].title}
            </div>
          )}
          {queue.map((e, i) => {
            const repeat = seen.has(e.snapshotId);
            seen.add(e.snapshotId);
            const m = camCount.get(e.webcamId) ?? 1;
            const n = (camSeen.get(e.webcamId) ?? 0) + 1;
            camSeen.set(e.webcamId, n);
            // Flagged when a dwell above this one already played the frame inside its prelude.
            const preluded = queueSeqs.slice(0, i).some((s) => s?.earlier.some((f) => f.snapshotId === e.snapshotId));
            return (
              <EntryRow key={`${e.snapshotId}-${i}`} entry={e} feed={feed} place="queue" onGlass={i === 0 && !!current}
                repeat={repeat} cameraIndex={m > 1 ? { n, m } : undefined} role={roleOf(i)} onClick={(x) => onSelect(x, feed)}
                sequence={queueSeqs[i]} rowS={rowS} preluded={preluded} />
            );
          })}
        </Bin>
      </div>
    </div>
  );
}
