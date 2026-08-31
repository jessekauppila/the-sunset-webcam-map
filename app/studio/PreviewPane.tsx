'use client';

import { useTerminatorStore } from '@/app/store/useTerminatorStore';
import { resolveMosaic } from '@/app/components/mosaic/registry';
import type { PanelSize } from '@/app/kiosk/panelPreview';
import type { SettingsValues } from '@/app/lib/settings/schema';
import { StudioPanelFrame } from './StudioPanelFrame';

export type FeedView = 'sunrise' | 'sunset' | 'both';

const SEGMENTS: FeedView[] = ['sunrise', 'sunset', 'both'];

const mono = 'ui-monospace, SFMono-Regular, Menlo, monospace';
const dim = '#8b95a7';
const hairline = '#232a38';

function feedsFor(view: FeedView): Array<'sunrise' | 'sunset'> {
  return view === 'both' ? ['sunrise', 'sunset'] : [view];
}

export function PreviewPane({
  view,
  onViewChange,
  panel,
  panelPresetLabel,
  versionName,
  settings,
}: {
  view: FeedView;
  onViewChange: (v: FeedView) => void;
  panel: PanelSize;
  panelPresetLabel: string;
  versionName: string;
  settings?: SettingsValues;
}) {
  const sunrise = useTerminatorStore((t) => t.sunrise);
  const sunset = useTerminatorStore((t) => t.sunset);
  const Mosaic = resolveMosaic(versionName);
  const feeds = feedsFor(view);

  const webcamsFor = (feed: 'sunrise' | 'sunset') =>
    feed === 'sunrise' ? sunrise : sunset;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        width: '100%',
        height: '100%',
        gap: 16,
        padding: 16,
        boxSizing: 'border-box',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div
          role="group"
          aria-label="feed view"
          style={{
            display: 'flex',
            border: `1px solid ${hairline}`,
            borderRadius: 6,
            overflow: 'hidden',
          }}
        >
          {SEGMENTS.map((seg) => (
            <button
              key={seg}
              type="button"
              aria-pressed={view === seg}
              onClick={() => onViewChange(seg)}
              style={{
                padding: '4px 14px',
                fontSize: 12,
                textTransform: 'capitalize',
                cursor: 'pointer',
                border: 'none',
                background: view === seg ? '#1d2432' : 'transparent',
                color: view === seg ? '#e5e7eb' : dim,
              }}
            >
              {seg}
            </button>
          ))}
        </div>

        <span
          data-testid="studio-geometry-chip"
          style={{
            fontFamily: mono,
            fontSize: 11,
            letterSpacing: '0.05em',
            color: dim,
            border: `1px solid ${hairline}`,
            borderRadius: 999,
            padding: '3px 12px',
          }}
        >
          {panelPresetLabel}
        </span>
      </div>

      <div
        style={{
          display: 'flex',
          flex: 1,
          minHeight: 0,
          width: '100%',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 24,
        }}
      >
        {feeds.map((feed) => (
          <div
            key={feed}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 8,
              height: '100%',
              minWidth: 0,
              flex: 1,
            }}
          >
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: dim,
              }}
            >
              {feed}
            </span>
            <div style={{ flex: 1, width: '100%', minHeight: 0 }}>
              <StudioPanelFrame panel={panel}>
                <Mosaic
                  webcams={webcamsFor(feed)}
                  width={panel.width}
                  height={panel.height}
                  feed={feed}
                  search=""
                  settings={settings}
                />
              </StudioPanelFrame>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
