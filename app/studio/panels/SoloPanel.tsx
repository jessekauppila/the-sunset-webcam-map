'use client';

import { useEffect, useState } from 'react';
import type { EntryView, StateView } from '@/app/api/kiosk/solo/view';
import type { Feed, SoloDials } from '@/app/lib/solo/types';
import type { SoloVersionSpec } from '@/app/lib/solo/versions';
import { FeedColumn } from '../solo/FeedColumn';
import { useTapeZoom } from '../solo/Tape';
import { FrameModal } from '../solo/FrameModal';

const mono = 'ui-monospace, SFMono-Regular, Menlo, monospace';

/** One feed's state as `useSoloState` returns it: what the glass is doing, what the studio dials would do, and any fetch error. */
export interface SoloFeedState {
  server: StateView | undefined;
  projected: StateView | undefined;
  error: string | undefined;
}

interface Selected { list: EntryView[]; index: number; feed: Feed }

/**
 * The solo surface's two feed columns and the frame pop-up, a panel the one
 * /studio mounts under the screens wherever a mosaic version would put its
 * own panel. Owns only the click-to-pop-up selection; both columns'
 * state comes from `useSoloState` upstream (server data plus the studio-dial
 * re-projection) so this component stays a pure renderer of it.
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
  // One zoom for both tapes: they sit side by side and read as one instrument.
  const [tapeZoom, setTapeZoom] = useTapeZoom();

  useEffect(() => {
    if (fixedNowMs !== undefined) return;
    const t = setInterval(() => setSelfNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, [fixedNowMs]);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, minWidth: 0 }}>
      {(['sunrise', 'sunset'] as const).map((feed) => {
        const s = feed === 'sunrise' ? sunrise : sunset;
        return s.server && s.projected ? (
          <FeedColumn key={feed} feed={feed} server={s.server} projected={s.projected} liveDials={liveDials}
            nowMs={nowMs} version={version} tapeZoom={tapeZoom} onTapeZoom={setTapeZoom}
            onSelect={(entry, f, list) => setSelected({ list, index: Math.max(0, list.findIndex((x) => x.snapshotId === entry.snapshotId)), feed: f })} />
        ) : (
          <div key={feed} style={{ color: '#4b5568', fontFamily: mono, fontSize: 12 }}>{s.error ?? `loading ${feed}…`}</div>
        );
      })}
      {selected && (
        <FrameModal list={selected.list} index={selected.index} feed={selected.feed}
          onIndex={(index) => setSelected({ ...selected, index })} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
