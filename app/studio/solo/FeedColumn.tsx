'use client';

import { useEffect, useState, type ReactNode } from 'react';
import type { EntryView, StateView } from '@/app/api/kiosk/solo/view';
import { nextBoundaryMs } from '@/app/lib/solo/schedule';
import type { Feed, SoloDials } from '@/app/lib/solo/types';
import type { SoloVersionSpec } from '@/app/lib/solo/versions';
import { preludePlan } from '@/app/lib/solo2/prelude';
import type { Solo2Dials } from '@/app/lib/solo2/types';
import type { Stage } from '@/app/lib/solo/stages';
import { EntryRow, type Sequence } from './EntryRow';
import { reasonLine } from './reason';
import { Tape } from './Tape';

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

const STAGE_LABEL: Record<'inLine' | 'resting' | 'underFloor', string> = {
  inLine: 'IN LINE', resting: 'RESTING', underFloor: 'UNDER FLOOR',
};
const STAGE_HINT: Record<'inLine' | 'resting' | 'underFloor', string> = {
  inLine: 'Rested and above the floor, in the order the glass will draw them.',
  resting: 'Shown within the last rest draws; back in line when the count runs out.',
  underFloor: 'Below the bin\'s floor dial; never drawn until the dial or the score moves.',
};

/**
 * One stage of a bin: an outlined box with the stage name up its left edge
 * (stages spec §3.2). Stays as a short box when empty so the three stages
 * never shift.
 */
function StageBox({ kind, color, count, children }: {
  kind: 'inLine' | 'resting' | 'underFloor'; color: string; count: number; children: ReactNode;
}) {
  const label = `${STAGE_LABEL[kind]} · ${count}`;
  const labelStyle = { fontSize: 8.5, fontWeight: 700, letterSpacing: '.06em', color, whiteSpace: 'nowrap', fontFamily: mono, cursor: 'help' } as const;
  const frame = { border: `1px solid ${color}`, borderRadius: 6, padding: 3, marginBottom: 5, background: '#0b0e14' } as const;
  // An empty stage is one flat line, so the label does not stretch the box to its own length.
  if (count === 0) return <div title={STAGE_HINT[kind]} style={{ ...frame, ...labelStyle, paddingLeft: 6 }}>{label}</div>;
  return (
    <div title={STAGE_HINT[kind]} style={{ ...frame, display: 'grid', gridTemplateColumns: '14px 1fr', gap: 4 }}>
      <div style={{ ...labelStyle, writingMode: 'vertical-rl', transform: 'rotate(180deg)', textAlign: 'center' }}>{label}</div>
      <div style={{ minWidth: 0 }}>{children}</div>
    </div>
  );
}

const STAGE_KINDS = ['inLine', 'resting', 'underFloor'] as const;
/** `queued` / `onGlass` never sit in a bin today; the fold keeps the partition total if that changes. */
const byStage = (rows: EntryView[]) => ({
  inLine: rows.filter((e) => e.stage.kind === 'inLine' || e.stage.kind === 'queued' || e.stage.kind === 'onGlass'),
  resting: rows.filter((e) => e.stage.kind === 'resting'),
  underFloor: rows.filter((e) => e.stage.kind === 'underFloor'),
});

const TAPE_OPEN_KEY = 'studio.tape.open';

/** The tape's open/closed state, remembered per browser so a closed tape stays closed across reloads. */
function useTapeOpen(): [boolean, () => void] {
  const [open, setOpen] = useState(true);
  useEffect(() => {
    try {
      if (localStorage.getItem(TAPE_OPEN_KEY) === '0') setOpen(false);
    } catch { /* storage unavailable: stay open */ }
  }, []);
  const toggle = () => setOpen((o) => {
    try { localStorage.setItem(TAPE_OPEN_KEY, o ? '0' : '1'); } catch { /* ignore */ }
    return !o;
  });
  return [open, toggle];
}

/**
 * One feed's tape, its two bins, each as three stages (in line, resting,
 * under floor), and its queue as the STUDIO dials would order them. Every frame appears in
 * exactly one of the three columns; the on-glass frame heads the queue. The
 * screen itself is drawn above, by GlassPreview, so nothing here repeats the
 * picture.
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
  const [tapeOpen, toggleTape] = useTapeOpen();
  const preludedInQueue = new Set(queueSeqs.flatMap((s) => s?.earlier.map((f) => f.snapshotId) ?? []));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
      <h3 style={{ margin: 0, fontSize: 13, color: '#9aa3b2', display: 'flex', justifyContent: 'space-between' }}>
        <span>{LABEL[feed]}</span>
        <span style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
          <button type="button" onClick={toggleTape} aria-expanded={tapeOpen}
            title={tapeOpen ? 'Hide the tape' : 'Show the tape: past draws, on glass, projected next, width is time'}
            style={{ background: 'none', border: '1px solid #2a3242', borderRadius: 4, color: '#9aa3b2', fontFamily: mono, fontSize: 10, padding: '1px 6px', cursor: 'pointer' }}>
            tape {tapeOpen ? '▾' : '▸'}
          </button>
          <span title="Time until this screen changes, on the live dials' clock">
            next frame in <b style={{ color: '#f5a344', fontFamily: mono }}>{leftS} s</b>
          </span>
        </span>
      </h3>
      {tapeOpen && (
        <Tape past={server.tape} current={current?.entry ?? null} currentSince={current?.shownSince ?? null} next={projected.next}
          nextSequences={queueSeqs.slice(current ? 1 : 0)}
          pastDials={{ dwellS: liveDials.dwellS, fadeS: liveDials.fadeS }} nextDials={{ dwellS: projected.dials.dwellS, fadeS: projected.dials.fadeS }}
          onSelect={(e) => onSelect(e, feed)} />
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.15fr', gap: 6 }}>
        <Bin color="#7ee2ac" title={`Sunset bin · ${projected.bins.sunset.length} waiting · ${qSun} queued`}
          hint="Frames the detection head calls a sunset. Three stages: in line (draw order), resting, under the rating floor.">
          {STAGE_KINDS.map((kind) => {
            const rows = byStage(projected.bins.sunset)[kind];
            return (
              <StageBox key={kind} kind={kind} color="#7ee2ac" count={rows.length}>
                {rows.map((e) => (
                  <EntryRow key={e.snapshotId} entry={e} feed={feed} place="sunset" reason={reasonLine(e.stage, e, nowMs)}
                    onClick={(x) => onSelect(x, feed)} sequence={seqFor(e, null)} rowS={rowS} preluded={preludedInQueue.has(e.snapshotId)} />
                ))}
              </StageBox>
            );
          })}
        </Bin>
        <Bin color="#c3cad6" title={`Non-sunset bin · ${projected.bins.nonSunset.length} waiting · ${qNon} queued`}
          hint="Frames the detection head does not call a sunset. Three stages: in line (draw order), resting, under the sunset-probability floor.">
          {STAGE_KINDS.map((kind) => {
            const rows = byStage(projected.bins.nonSunset)[kind];
            return (
              <StageBox key={kind} kind={kind} color="#c3cad6" count={rows.length}>
                {rows.map((e) => (
                  <EntryRow key={e.snapshotId} entry={e} feed={feed} place="non_sunset" reason={reasonLine(e.stage, e, nowMs)}
                    onClick={(x) => onSelect(x, feed)} sequence={seqFor(e, null)} rowS={rowS} preluded={preludedInQueue.has(e.snapshotId)} />
                ))}
              </StageBox>
            );
          })}
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
            // A repeat row is a later draw than its stored stage says, so the reason comes from its place in the queue.
            const stage: Stage = i === 0 && current ? { kind: 'onGlass' } : { kind: 'queued', position: current ? i : i + 1 };
            return (
              <EntryRow key={`${e.snapshotId}-${i}`} entry={e} feed={feed} place="queue" onGlass={i === 0 && !!current}
                reason={reasonLine(stage, e, nowMs)}
                repeat={repeat} cameraIndex={m > 1 ? { n, m } : undefined} role={roleOf(i)} onClick={(x) => onSelect(x, feed)}
                sequence={queueSeqs[i]} rowS={rowS} preluded={preluded} />
            );
          })}
        </Bin>
      </div>
    </div>
  );
}
