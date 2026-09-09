'use client';

import { useEffect, useState, type ReactNode } from 'react';
import type { EntryView, StateView } from '@/app/api/kiosk/solo/view';
import type { Feed, SoloDials } from '@/app/lib/solo/types';
import type { SoloVersionSpec } from '@/app/lib/solo/versions';
import { budgetS, cameraGroups, capFor, planDialsFor, representative, runOf } from '@/app/lib/solo2/run';
import { fitPlan } from '@/app/lib/solo2/plan';
import { SOLO2_SETTINGS_SCHEMA } from '@/app/lib/solo2/settingsSchema';
import type { Solo2Dials } from '@/app/lib/solo2/types';
import type { Stage } from '@/app/lib/solo/stages';
import { EntryRow, type Run } from './EntryRow';
import { reasonLine } from './reason';
import { Tape, type TapeDials } from './Tape';
import { arrivalLook } from '@/app/lib/solo2/veil';

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

type StageKind = 'inLine' | 'resting' | 'underFloor';
const STAGE_LABEL: Record<StageKind, string> = { inLine: 'IN LINE', resting: 'RESTING', underFloor: 'UNDER FLOOR' };
const STAGE_HINT: Record<StageKind, string> = {
  inLine: 'Rested and above the floor, in the order the glass will draw them.',
  resting: 'Shown within the last rest draws; back in line when the count runs out.',
  underFloor: 'Below the bin\'s floor dial; never drawn until the dial or the score moves.',
};

/**
 * One stage of a bin: an outlined box with the stage name up its left edge
 * (stages spec §3.2). Stays as a short box when empty so the three stages
 * never shift.
 */
function StageBox({ kind, color, count, children }: { kind: StageKind; color: string; count: number; children: ReactNode }) {
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

const STAGE_KINDS: StageKind[] = ['inLine', 'resting', 'underFloor'];
/** `queued` / `onGlass` never sit in a bin today; the fold keeps the partition total if that changes. */
const stageOf = (e: EntryView): StageKind =>
  e.stage.kind === 'resting' ? 'resting' : e.stage.kind === 'underFloor' ? 'underFloor' : 'inLine';

/** One row of a column: a frame, or a camera (its newest frame with the run it plays first). */
interface Box { entry: EntryView; run?: Run }

/** The frames a box stands for, in capture order: the cut ones first, then the run as the dwell plays it. */
const framesOf = (b: Box): EntryView[] => [...(b.run?.skipped ?? []), ...(b.run?.earlier ?? []), b.entry];

const capDial = (bin: 'sunset' | 'non_sunset') => bin === 'sunset' ? 'runFramesSunset' : 'runFramesOther';
// A ranked sunset's cap is its share of the dial, so the label says both.
const capLabelOf = (bin: 'sunset' | 'non_sunset', cap: number, d: Solo2Dials) => {
  const dial = SOLO2_SETTINGS_SCHEMA.find((k) => k.key === capDial(bin))?.label ?? 'most frames';
  return bin === 'sunset' && d.runShape === 'rank' ? `${dial} · ${cap} of ${d.runFramesSunset} by rank` : `${dial} · ${cap}`;
};

/**
 * What the tape needs to draw each seam as the glass will play it. solo's
 * dials have no transition and crossfade; solo2's say what the change is, and
 * `arrivalLook` says what this screen's dip goes through (null: it crossfades).
 */
function tapeDials(d: SoloDials, feed: Feed): TapeDials {
  const d2 = d as Partial<Solo2Dials>;
  if (d2.transition === undefined) return { dwellS: d.dwellS, fadeS: d.fadeS };
  const look = d2.veilStyle !== undefined ? arrivalLook(feed, d2 as Solo2Dials) : null;
  return {
    dwellS: d.dwellS, fadeS: d.fadeS, transition: d2.transition, sameCameraFadeS: d2.sameCameraFadeS,
    veil: look ? look.veilColor : '#000000',
  };
}

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
 * under floor), and its queue as the STUDIO dials would order them. With
 * solo2's camera run on, a camera is one box wherever it sits (camera-run
 * spec §5.2): its frames stacked oldest to newest, the newest last with the
 * row's annotations, and every frame of a queued or on-glass camera leaves
 * the bins. The screen itself is drawn above, by GlassPreview, so nothing
 * here repeats the picture.
 */
export function FeedColumn({ feed, server, projected, liveDials, nowMs, version, onSelect, tapeZoom, onTapeZoom }: {
  feed: Feed;
  server: StateView;
  projected: StateView;
  liveDials: SoloDials;
  nowMs: number;
  version?: SoloVersionSpec;
  /** The clicked frame, its screen, and the frames of its column in order, so a pop-up can step through them. */
  onSelect: (entry: EntryView, feed: Feed, list: EntryView[]) => void;
  /** The tape's zoom, owned by the panel so both screens' tapes zoom together. */
  tapeZoom?: number;
  onTapeZoom?: (zoom: number) => void;
}) {
  // The server's published end, not a boundary derived here (spec §5.1). A
  // dwell's length is engine state, so a countdown computed from the dwell
  // dial would be a confident wrong number the moment dwells stop being
  // uniform — and this is a surface an operator reads.
  const boundary = server.schedule.nextBoundaryMs;
  const leftS = Math.max(0, Math.ceil((boundary - nowMs) / 1000));
  const current = server.current;
  const queue: EntryView[] = [...(current ? [current.entry] : []), ...projected.next];
  const differs =
    !!server.next[0] && !!projected.next[0] && server.next[0].snapshotId !== projected.next[0].snapshotId;
  // Roles are parallel to projected.next; the on-glass frame at index 0 has none.
  const showRoles = version?.name === 'solo2' && (liveDials as Partial<Solo2Dials>).valleys !== undefined
    && ((projected.dials as Partial<Solo2Dials>).valleys ?? 0) > 0;
  const roleOf = (i: number) => (showRoles && i > 0 ? projected.nextRoles[i - 1] : undefined);
  // solo2: a row is as tall as its time on glass, and a camera is one box.
  const d2 = version?.name === 'solo2' ? (projected.dials as Solo2Dials) : null;
  // A lone frame's box is as tall as its own budget, which the spread dial swings per draw.
  const rowSFor = (e: EntryView) => (d2 ? budgetS(e, d2, all, !!d2.cameraRun) : undefined);
  const grouping = !!d2?.cameraRun;
  const all: EntryView[] = [...projected.bins.sunset, ...projected.bins.nonSunset, ...queue];
  /**
   * The run a dwell of `e` plays, as the glass plays it: the same cap and the
   * same budget rule as solo2/index.tsx, so a box is as tall as its time on
   * glass — and the frames the cap cuts, so the box also shows what a higher
   * cap would add. Before this the studio stacked every frame of the camera
   * and divided the dwell by all of them; the glass was playing the newest 8.
   */
  const runFor = (e: EntryView): Run | undefined => {
    if (!d2) return undefined;
    const cap = capFor(e, d2, all, true);
    const played = runOf(e, all, true, cap);
    const playedIds = new Set(played.map((f) => f.snapshotId));
    const skipped = runOf(e, all, true).filter((f) => !playedIds.has(f.snapshotId));
    if (played.length <= 1 && skipped.length === 0) return undefined;
    return { earlier: played.slice(0, -1), skipped, capLabel: capLabelOf(e.bin, cap, d2), stepS: fitPlan(planDialsFor(e, d2, all, true), played.length).stepS };
  };

  // The queue: each draw with the run it plays.
  const queueBoxes: Box[] = queue.map((e) => ({ entry: e, run: grouping ? runFor(e) : undefined }));
  // The bins: every frame for itself, or one box per camera not already in the queue.
  const queuedCameras = new Set(queue.map((e) => e.webcamId));
  const binBoxes: Box[] = grouping
    ? [...cameraGroups([...projected.bins.sunset, ...projected.bins.nonSunset]).values()]
      .filter((frames) => !queuedCameras.has(frames[0].webcamId))
      .map((frames) => {
        // The bin's box is the camera's representative; its run is what a dwell of it would play.
        const entry = representative(frames);
        return { entry, run: runFor(entry) };
      })
    : [...projected.bins.sunset, ...projected.bins.nonSunset].map((e) => ({ entry: e }));
  const binOf = (bin: 'sunset' | 'non_sunset') => binBoxes.filter((b) => b.entry.bin === bin);
  const qSun = queue.filter((e) => e.bin === 'sunset').length;
  const qNon = queue.length - qSun;
  const seen = new Set<number>();

  // How many distinct items of a bin the queue holds: cameras with the run on, frames with it off.
  const queuedOf = (bin: 'sunset' | 'non_sunset') =>
    new Set(queue.filter((e) => e.bin === bin).map((e) => (grouping ? e.webcamId : e.snapshotId))).size;

  const column = (bin: 'sunset' | 'non_sunset', color: string, title: string, hint: string) => {
    const boxes = binOf(bin);
    const list = boxes.flatMap(framesOf);
    const queuedHere = queuedOf(bin);
    const unit = grouping ? 'camera' : 'frame';
    // A bin the queue has emptied says so in one line. Three `· 0` stages under
    // a heading that already says `6 queued` read as a broken view (2026-09-06).
    const emptied = boxes.length === 0 && queuedHere > 0;
    return (
      <Bin color={color} title={`${title} · ${boxes.length} waiting · ${bin === 'sunset' ? qSun : qNon} queued`} hint={hint}>
        {emptied && (
          <div data-testid={`bin-emptied-${bin}`} title="Every item of this bin is in the queue on the right, so nothing waits here. A queued item leaves its bin."
            style={{ fontSize: 10, color, fontFamily: mono, padding: '4px 2px', cursor: 'help' }}>
            {queuedHere === 1 ? `its one ${unit} is in the queue` : `all ${queuedHere} ${unit}s are in the queue`}
          </div>
        )}
        {!emptied && STAGE_KINDS.map((kind) => {
          const rows = boxes.filter((b) => stageOf(b.entry) === kind);
          return (
            <StageBox key={kind} kind={kind} color={color} count={rows.length}>
              {rows.map((b) => (
                <EntryRow key={b.entry.snapshotId} entry={b.entry} feed={feed} place={bin} reason={reasonLine(b.entry.stage, b.entry, nowMs)}
                  onClick={(x) => onSelect(x, feed, list)} run={b.run} rowS={rowSFor(b.entry)} />
              ))}
            </StageBox>
          );
        })}
      </Bin>
    );
  };
  const queueList = queueBoxes.flatMap(framesOf);
  const [tapeOpen, toggleTape] = useTapeOpen();
  // The tape's list for the pop-up: the past, then the queue in play order.
  const tapeList: EntryView[] = [...server.tape, ...queueList];

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
        <Tape past={server.tape} current={current?.entry ?? null} currentSince={current?.shownSince ?? null}
          currentEndsAt={current?.endsAtMs ?? null} next={projected.next}
          nextSequences={queueBoxes.slice(current ? 1 : 0).map((b) => b.run)}
          pastDials={tapeDials(liveDials, feed)} nextDials={tapeDials(projected.dials, feed)}
          onSelect={(e) => onSelect(e, feed, tapeList)} zoom={tapeZoom} onZoom={onTapeZoom} />
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.15fr', gap: 6 }}>
        {column('sunset', '#7ee2ac', 'Sunset bin',
          `Frames the detection head calls a sunset${grouping ? ', one box per camera' : ''}. Three stages: in line (draw order), resting, under the rating floor.`)}
        {column('non_sunset', '#c3cad6', 'Non-sunset bin',
          `Frames the detection head does not call a sunset${grouping ? ', one box per camera' : ''}. Three stages: in line (draw order), resting, under the sunset-probability floor.`)}
        <Bin color="#4b5568" title="On glass + next up"
          hint="The play order for this screen, computed from both bins by the five rules with the STUDIO dials. Top row is on glass. Row outline = which bin it came from. A queued frame is no longer in its bin.">
          {differs && (
            <div style={{ fontSize: 10, color: '#f5a344', marginBottom: 4 }}>
              projected with studio dials; glass will draw {server.next[0].title}
            </div>
          )}
          {queueBoxes.map((b, i) => {
            const e = b.entry;
            const repeat = seen.has(e.snapshotId);
            seen.add(e.snapshotId);
            // A repeat row is a later draw than its stored stage says, so the reason comes from its place in the queue.
            const stage: Stage = i === 0 && current ? { kind: 'onGlass' } : { kind: 'queued', position: current ? i : i + 1 };
            return (
              <EntryRow key={`${e.snapshotId}-${i}`} entry={e} feed={feed} place="queue" onGlass={i === 0 && !!current}
                reason={reasonLine(stage, e, nowMs)} repeat={repeat} role={roleOf(i)}
                onClick={(x) => onSelect(x, feed, queueList)} run={b.run} rowS={rowSFor(b.entry)} />
            );
          })}
        </Bin>
      </div>
    </div>
  );
}
