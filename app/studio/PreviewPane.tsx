'use client';

import { useTerminatorStore } from '@/app/store/useTerminatorStore';
import { resolveMosaic } from '@/app/components/mosaic/registry';
import type { PanelSize } from '@/app/kiosk/panelPreview';
import type { SettingsValues } from '@/app/lib/settings/schema';
import type { SceneSource } from './useSceneWebcams';
import type { SceneState, SceneSummary } from '@/app/lib/scenes/types';
import { StudioPanelFrame } from './StudioPanelFrame';
import { SaveSceneButton } from './SaveSceneButton';

export type FeedView = 'sunrise' | 'sunset' | 'both';

const SEGMENTS: FeedView[] = ['sunrise', 'sunset', 'both'];

const mono = 'ui-monospace, SFMono-Regular, Menlo, monospace';
const dim = '#8b95a7';
const hairline = '#232a38';

function feedsFor(view: FeedView): Array<'sunrise' | 'sunset'> {
  return view === 'both' ? ['sunrise', 'sunset'] : [view];
}

/**
 * The source marker is not decoration. A live capture and a rebuilt evening
 * are drawn from different populations: a capture files the whole ungated
 * pool, while a rebuild can only return what the archive kept, which is
 * model-gated plus a small random trickle. Comparing one against the other
 * is not like for like, and the dropdown is where that has to be visible.
 */
function sceneOptionLabel(scene: SceneSummary): string {
  const marker = scene.source === 'live' ? 'captured' : 'rebuilt';
  return `${scene.label} · ${marker} · ${new Date(scene.representsAt).toLocaleString()}`;
}

export function PreviewPane({
  view,
  onViewChange,
  panel,
  panelPresetLabel,
  versionName,
  settings,
  scenes = [],
  sceneSource = { kind: 'live' },
  onSceneSourceChange,
  sceneState = null,
  error = null,
  at,
  onSceneSaved,
}: {
  view: FeedView;
  onViewChange: (v: FeedView) => void;
  panel: PanelSize;
  panelPresetLabel: string;
  versionName: string;
  settings?: SettingsValues;
  scenes?: SceneSummary[];
  sceneSource?: SceneSource;
  onSceneSourceChange?: (source: SceneSource) => void;
  sceneState?: SceneState | null;
  error?: string | null;
  at?: string;
  onSceneSaved?: (id: number) => void;
}) {
  const liveSunrise = useTerminatorStore((t) => t.sunrise);
  const liveSunset = useTerminatorStore((t) => t.sunset);
  const Mosaic = resolveMosaic(versionName);
  const feeds = feedsFor(view);

  // A scene is selected but hasn't resolved yet (still loading, 404, or a
  // fetch error) — don't fall through to the live pool and silently show
  // it under the scene's header, and don't render live tiles at all.
  const sceneUnresolved = sceneSource.kind === 'scene' && !sceneState;

  const webcamsFor = (feed: 'sunrise' | 'sunset') => {
    if (sceneSource.kind === 'scene') return sceneState ? sceneState[feed] : [];
    return feed === 'sunrise' ? liveSunrise : liveSunset;
  };

  // Handed to each panel even in single-feed view: the point of the shared
  // scale is that one screen looks the same whether or not you happen to be
  // previewing its twin beside it.
  const peerOf = (feed: 'sunrise' | 'sunset') =>
    webcamsFor(feed === 'sunrise' ? 'sunset' : 'sunrise');

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

        <select
          aria-label="data source"
          data-testid="studio-scene-select"
          value={sceneSource.kind === 'live' ? 'live' : String(sceneSource.id)}
          onChange={(e) => {
            const raw = e.target.value;
            onSceneSourceChange?.(
              raw === 'live' ? { kind: 'live' } : { kind: 'scene', id: Number(raw) }
            );
          }}
          style={{
            fontSize: 12,
            background: '#0e1119',
            color: '#e5e7eb',
            border: `1px solid ${hairline}`,
            borderRadius: 6,
            padding: '4px 8px',
          }}
        >
          <option value="live">live</option>
          {scenes.map((scene) => (
            <option key={scene.id} value={scene.id}>
              {sceneOptionLabel(scene)}
            </option>
          ))}
        </select>

        <SaveSceneButton onSaved={onSceneSaved} />

        {sceneUnresolved && (
          <span
            data-testid="studio-scene-status"
            style={{
              fontFamily: mono,
              fontSize: 11,
              color: error ? '#f0a04b' : dim,
            }}
          >
            {error ?? 'loading scene…'}
          </span>
        )}
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
                  peerWebcams={peerOf(feed)}
                  search=""
                  settings={settings}
                  at={at}
                />
              </StudioPanelFrame>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
