'use client';

import { useState } from 'react';
import type { EntryView, StateView } from '@/app/api/kiosk/solo/view';
import type { Feed, SoloDials } from '@/app/lib/solo/types';
import type { SoloVersionSpec } from '@/app/lib/solo/versions';
import { FeedColumn } from '../solo/FeedColumn';
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
 */
export function SoloPanel({ version, liveDials, nowMs, sunrise, sunset }: {
  version: SoloVersionSpec;
  liveDials: SoloDials;
  nowMs: number;
  sunrise: SoloFeedState;
  sunset: SoloFeedState;
}) {
  const [selected, setSelected] = useState<Selected | null>(null);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, minWidth: 0 }}>
      {(['sunrise', 'sunset'] as const).map((feed) => {
        const s = feed === 'sunrise' ? sunrise : sunset;
        return s.server && s.projected ? (
          <FeedColumn key={feed} feed={feed} server={s.server} projected={s.projected} liveDials={liveDials}
            nowMs={nowMs} version={version}
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
