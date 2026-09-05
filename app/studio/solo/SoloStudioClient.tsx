'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useStudioSettings } from '../useStudioSettings';
import { DeployButton } from '../DeployButton';
import { DeployHistory } from '../DeployHistory';
import { SoloRail, type RailTab } from './SoloRail';
import { CaptionPreview } from './CaptionPreview';
import { FeedColumn } from './FeedColumn';
import { SoloStatusStrip } from './SoloStatusStrip';
import { useSoloState } from './useSoloState';
import { toWebcam } from './toWebcam';
import { SOLO_VERSIONS, type SoloVersionSpec } from '@/app/lib/solo/versions';
import { mergeSettings } from '@/app/lib/settings/schema';
import { SHARED_NAMESPACE } from '@/app/lib/settings/sharedSchema';
import { PANEL_PRESETS } from '@/app/kiosk/panelPreview';
import type { EntryView } from '@/app/api/kiosk/solo/view';
import type { Feed } from '@/app/lib/solo/types';
import { FrameLabelCard } from '@/app/components/Webcam/FrameLabelCard';

const bg = '#0b0e14';
const railBg = '#10141d';
const border = '#1d2432';
const mono = 'ui-monospace, SFMono-Regular, Menlo, monospace';

/**
 * /studio/solo: the bins transparency surface (spec §6.4). Dials edit the
 * studio profile through the same hook /studio uses; the queue columns
 * re-project with those dials at once, while the panels and countdowns run
 * on the live profile, because that is what the glass runs.
 */
export function SoloStudioClient({ version = SOLO_VERSIONS.solo as SoloVersionSpec }: { version?: SoloVersionSpec }) {
  const api = useStudioSettings();
  const studioDials = version.dialsFrom(api.effective(version.namespace));
  const liveDials = version.dialsFrom(mergeSettings(version.schema, api.live?.namespaces?.[version.namespace]));
  const sunrise = useSoloState('sunrise', studioDials, version);
  const sunset = useSoloState('sunset', studioDials, version);
  const other = version.name === 'solo2'
    ? { href: '/studio/solo', label: '← solo studio', title: 'The original solo kiosk\'s studio' }
    : { href: '/studio/solo2', label: 'solo2 studio →', title: 'solo with rhythm, lead, prelude, transitions and local time' };
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [selected, setSelected] = useState<{ entry: EntryView; feed: Feed } | null>(null);
  // Which rail page is up. The caption page swaps the queue columns for the
  // screens drawn with the studio dials, so a caption dial shows its effect.
  const [tab, setTab] = useState<RailTab>('dials');
  const panelPreset = String(api.effective(SHARED_NAMESPACE).panelPreset ?? '');
  const panel = PANEL_PRESETS[panelPreset] ?? PANEL_PRESETS['dell-l'];

  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '250px 1fr', gridTemplateRows: '30px 1fr', height: '100vh',
      background: bg, color: '#e5e7eb', overflow: 'hidden',
    }}>
      <div style={{ gridColumn: '1 / -1', background: '#0e1119', borderBottom: `1px solid ${border}`, display: 'flex', alignItems: 'center' }}>
        <SoloStatusStrip nowMs={nowMs} sunrise={sunrise.server} sunset={sunset.server}
          liveRevision={api.liveRevision} diffCount={api.diffCount} zone={sunset.server?.zone ?? sunrise.server?.zone} />
        <Link href={other.href} style={{ marginLeft: 'auto', marginRight: 14, fontSize: 11, color: '#f5a344' }} title={other.title}>
          {other.label}
        </Link>
        <Link href="/studio" style={{ marginRight: 12, fontSize: 11, color: '#8b95a7' }} title="The mosaic studio">
          ← mosaic studio
        </Link>
      </div>
      <aside style={{ background: railBg, borderRight: `1px solid ${border}`, padding: 10, overflowY: 'auto' }}>
        <SoloRail api={api} version={version} tab={tab} onTab={setTab} deploySlot={
          <>
            <DeployButton diffCount={api.diffCount} onDeploy={api.deploy} onRevert={api.revert} />
            <DeployHistory api={api} />
          </>
        } />
      </aside>
      <main style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, padding: 12, overflowY: 'auto', minWidth: 0 }}>
        {tab === 'caption' && (
          <CaptionPreview dials={studioDials} panel={panel} screens={[
            { feed: 'sunrise', server: sunrise.server ?? null, error: sunrise.error },
            { feed: 'sunset', server: sunset.server ?? null, error: sunset.error },
          ]} />
        )}
        {tab === 'dials' && (['sunrise', 'sunset'] as const).map((feed) => {
          const s = feed === 'sunrise' ? sunrise : sunset;
          return s.server && s.projected ? (
            <FeedColumn key={feed} feed={feed} server={s.server} projected={s.projected} liveDials={liveDials}
              studioDials={studioDials} nowMs={nowMs} version={version} onSelect={(entry, f) => setSelected({ entry, feed: f })} />
          ) : (
            <div key={feed} style={{ color: '#4b5568', fontFamily: mono, fontSize: 12 }}>{s.error ?? `loading ${feed}…`}</div>
          );
        })}
      </main>
      {selected && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) setSelected(null); }}
          style={{ position: 'fixed', inset: 0, background: '#000a', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <div style={{ background: railBg, border: `1px solid ${border}`, borderRadius: 10, width: 'min(760px, 92vw)', padding: 14 }}>
            <button type="button" onClick={() => setSelected(null)} style={{
              float: 'right', background: 'transparent', color: '#8b95a7', border: `1px solid ${border}`,
              borderRadius: 6, padding: '3px 8px', cursor: 'pointer',
            }}>close</button>
            <div style={{ fontFamily: mono, fontSize: 12, color: '#9aa3b2', marginBottom: 8 }}>
              frame {selected.entry.snapshotId} · {selected.entry.bin === 'sunset' ? 'sunset' : 'non-sunset'} bin · shown ×{selected.entry.tally}
            </div>
            <FrameLabelCard webcam={toWebcam(selected.entry, selected.feed)} allowCapture={false} />
          </div>
        </div>
      )}
    </div>
  );
}
