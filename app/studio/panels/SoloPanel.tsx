'use client';

import { useEffect, useMemo, useState } from 'react';
import type { EntryView, StateView } from '@/app/api/kiosk/solo/view';
import type { Feed, SoloDials } from '@/app/lib/solo/types';
import type { SoloVersionSpec } from '@/app/lib/solo/versions';
import type { Solo2Dials } from '@/app/lib/solo2/types';
import { arrivalLook } from '@/app/lib/solo2/veil';
import { FeedColumn } from '../solo/FeedColumn';
import { PairTape } from '../solo/PairTape';
import { projectPair } from '../solo/projectPair';
import { useTapeZoom, type TapeDials } from '../solo/tapeParts';
import { FrameModal } from '../solo/FrameModal';

const mono = 'ui-monospace, SFMono-Regular, Menlo, monospace';

/**
 * How far past now the tape projects. Ten minutes is several dwells on either
 * screen at the live dials, which is enough to show the next rendezvous or two
 * without the strip running off into a projection nobody trusts.
 */
const HORIZON_MS = 10 * 60_000;

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
    veil: look ? look.veilColor : '#000000', beatS: d2.beatS, dwellBeats: d2.dwellBeats, changeBeats: d2.changeBeats,
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

/** One feed's state as `useSoloState` returns it: what the glass is doing, what the studio dials would do, and any fetch error. */
export interface SoloFeedState {
  server: StateView | undefined;
  projected: StateView | undefined;
  error: string | undefined;
}

interface Selected { list: EntryView[]; index: number; feed: Feed }

/**
 * The solo surface: one tape across both screens, the two feed columns under
 * it, and the frame pop-up. A panel the one /studio mounts under the screens
 * wherever a mosaic version would put its own panel.
 *
 * The tape spans the full width above the columns rather than sitting inside
 * either of them (one-tape spec §4.1): a rendezvous is one line through both
 * strips, so the two screens have to share an axis, and an axis wide enough to
 * read time on needs the whole panel. The columns' state comes from
 * `useSoloState` upstream (server data plus the studio-dial re-projection);
 * this panel adds only the projection the tape draws and the pop-up selection.
 *
 * The columns tick — a frame's age, the dwell left — so this panel keeps its
 * own second-hand rather than taking one from the page above, where the same
 * tick would also recompose the mosaic preview.
 */
export function SoloPanel({ version, liveDials, nowMs: fixedNowMs, sunrise, sunset }: {
  version: SoloVersionSpec;
  liveDials: SoloDials;
  /** Tests pin the clock; in the app the panel runs its own. */
  nowMs?: number;
  sunrise: SoloFeedState;
  sunset: SoloFeedState;
}) {
  const [selected, setSelected] = useState<Selected | null>(null);
  const [selfNowMs, setSelfNowMs] = useState(() => Date.now());
  const nowMs = fixedNowMs ?? selfNowMs;
  // One zoom for the whole tape.
  const [tapeZoom, setTapeZoom] = useTapeZoom();
  const [tapeOpen, toggleTape] = useTapeOpen();

  useEffect(() => {
    if (fixedNowMs !== undefined) return;
    const t = setInterval(() => setSelfNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, [fixedNowMs]);

  const serverSunrise = sunrise.server;
  const serverSunset = sunset.server;
  // Both screens project with the STUDIO dials, so a dial move shows on the
  // tape before Deploy — the same promise the queue column already makes.
  const studioDials = sunrise.projected?.dials ?? null;
  /**
   * The minute, not the second. The projection re-runs the engine over both
   * pools, and its inputs — the pools, the draw log, the dials — move on the
   * poll rather than on the clock; keying it to the second would re-run it
   * every tick for an answer that cannot have changed.
   */
  const nowMinuteMs = Math.floor(nowMs / 60_000) * 60_000;
  const projection = useMemo(
    () => (serverSunrise && serverSunset && studioDials
      ? projectPair({
        sunrise: serverSunrise, sunset: serverSunset, dials: studioDials, version,
        nowMs: nowMinuteMs, horizonMs: HORIZON_MS,
      })
      : null),
    [serverSunrise, serverSunset, studioDials, version, nowMinuteMs],
  );

  const select = (entry: EntryView, feed: Feed, list: EntryView[]) =>
    setSelected({ list, index: Math.max(0, list.findIndex((x) => x.snapshotId === entry.snapshotId)), feed });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
      {projection && serverSunrise && serverSunset && studioDials && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
          <h3 style={{ margin: 0, fontSize: 13, color: '#9aa3b2', display: 'flex', gap: 10, alignItems: 'baseline' }}>
            <button type="button" onClick={toggleTape} aria-expanded={tapeOpen}
              title={tapeOpen ? 'Hide the tape' : 'Show the tape: both screens on one clock — past draws, on glass, projected next'}
              style={{ background: 'none', border: '1px solid #2a3242', borderRadius: 4, color: '#9aa3b2', fontFamily: mono, fontSize: 10, padding: '1px 6px', cursor: 'pointer' }}>
              tape {tapeOpen ? '▾' : '▸'}
            </button>
            <span style={{ fontFamily: mono, fontSize: 10, color: '#4b5568' }}>
              sunrise above, sunset below · now at the white line
            </span>
          </h3>
          {tapeOpen && (
            <PairTape sunrise={serverSunrise} sunset={serverSunset} projection={projection}
              liveDials={{ sunrise: tapeDials(liveDials, 'sunrise'), sunset: tapeDials(liveDials, 'sunset') }}
              studioDials={{ sunrise: tapeDials(studioDials, 'sunrise'), sunset: tapeDials(studioDials, 'sunset') }}
              nowMs={nowMs} onSelect={select} zoom={tapeZoom} onZoom={setTapeZoom} />
          )}
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, minWidth: 0 }}>
        {(['sunrise', 'sunset'] as const).map((feed) => {
          const s = feed === 'sunrise' ? sunrise : sunset;
          return s.server && s.projected ? (
            <FeedColumn key={feed} feed={feed} server={s.server} projected={s.projected} liveDials={liveDials}
              nowMs={nowMs} version={version} onSelect={select} />
          ) : (
            <div key={feed} style={{ color: '#4b5568', fontFamily: mono, fontSize: 12 }}>{s.error ?? `loading ${feed}…`}</div>
          );
        })}
      </div>
      {selected && (
        <FrameModal list={selected.list} index={selected.index} feed={selected.feed}
          onIndex={(index) => setSelected({ ...selected, index })} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
