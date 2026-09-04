'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useTerminatorStore } from '@/app/store/useTerminatorStore';
import { resolveMosaic } from '@/app/components/mosaic/registry';
import type { PanelSize } from '@/app/kiosk/panelPreview';
import type { SettingsValues } from '@/app/lib/settings/schema';
import type { SceneSource } from './useSceneWebcams';
import type { SceneProvenance, SceneState, SceneSummary } from '@/app/lib/scenes/types';
import { describeRestore, type RestoreReport } from './restoreReport';
import { StudioPanelFrame } from './StudioPanelFrame';
import { SaveSceneButton } from './SaveSceneButton';
import { poolFor } from './previewPool';
import { FrameLabelCard } from '@/app/components/Webcam/FrameLabelCard';
import { CameraHealthHeader } from '@/app/components/MyCameras/CameraHealthHeader';
import type { WindyWebcam } from '@/app/lib/types';

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
  sceneNotes = null,
  sceneProvenance = null,
  onRestoreDials,
  error = null,
  at,
  onSceneSaved,
  nav,
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
  sceneNotes?: string | null;
  sceneProvenance?: SceneProvenance | null;
  /**
   * Apply the selected scene's saved dials. A BUTTON, not a side effect of
   * selection: viewing a saved pool under the CURRENT dials is a legitimate
   * use — it is exactly the A/B of one pool against two dial sets — and an
   * automatic restore would make it impossible.
   */
  onRestoreDials?: () => RestoreReport;
  error?: string | null;
  at?: string;
  onSceneSaved?: (id: number) => void;
  /**
   * Site navigation, rendered at the right end of the top row. It shares the
   * row with the view controls instead of floating over the pane, so nothing
   * the pane draws (the tile-detail card in particular) can end up under it.
   */
  nav?: ReactNode;
}) {
  const liveSunrise = useTerminatorStore((t) => t.sunrise);
  const liveSunset = useTerminatorStore((t) => t.sunset);
  const Mosaic = resolveMosaic(versionName);
  const feeds = feedsFor(view);

  // A scene is selected but hasn't resolved yet (still loading, 404, or a
  // fetch error) — don't fall through to the live pool and silently show
  // it under the scene's header, and don't render live tiles at all.
  const sceneUnresolved = sceneSource.kind === 'scene' && !sceneState;

  // The last restore's report, cleared when the scene changes so a stale
  // "restored v3 · 4 dials" cannot describe a scene it was not about.
  const [restoreReport, setRestoreReport] = useState<RestoreReport | null>(null);
  const sceneId = sceneSource.kind === 'scene' ? sceneSource.id : null;

  // The camera whose tile was clicked. Cleared alongside the restore report
  // when the source changes: a card describing a tile from the previous pool
  // would otherwise sit over a composition that no longer contains it.
  const [selected, setSelected] = useState<WindyWebcam | null>(null);
  useEffect(() => {
    setRestoreReport(null);
    setSelected(null);
  }, [sceneId]);
  const showSceneRow =
    sceneSource.kind === 'scene' && (sceneNotes || (sceneProvenance && onRestoreDials));

  const webcamsFor = (feed: 'sunrise' | 'sunset') =>
    poolFor(feed, sceneSource, sceneState, {
      sunrise: liveSunrise,
      sunset: liveSunset,
    });

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
        position: 'relative',
      }}
    >
      {/*
        1fr | controls | 1fr keeps the controls centered while the nav sits
        at the right edge. When the pane is too narrow for both, the grid
        columns give way rather than letting the two paint over each other.
      */}
      <div
        style={{
          width: '100%',
          display: 'grid',
          gridTemplateColumns: '1fr auto 1fr',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <div />
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexWrap: 'wrap',
            gap: 12,
          }}
        >
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
        <div style={{ justifySelf: 'end' }}>{nav}</div>
      </div>

      {showSceneRow && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            fontFamily: mono,
            fontSize: 11,
            color: dim,
            maxWidth: '100%',
          }}
        >
          {sceneNotes && (
            <span data-testid="studio-scene-notes" style={{ fontStyle: 'italic' }}>
              {sceneNotes}
            </span>
          )}
          {sceneProvenance && onRestoreDials && (
            <button
              type="button"
              data-testid="studio-restore-dials"
              onClick={() => setRestoreReport(onRestoreDials())}
              title={`saved under ${sceneProvenance.activeVersion}`}
              style={{
                fontSize: 11,
                fontFamily: mono,
                background: '#0e1119',
                color: '#d7dce6',
                border: `1px solid ${hairline}`,
                borderRadius: 6,
                padding: '3px 8px',
                cursor: 'pointer',
              }}
            >
              restore dials ({sceneProvenance.activeVersion})
            </button>
          )}
          {restoreReport && (
            <span
              data-testid="studio-restore-report"
              style={{ color: restoreReport.dropped.length ? '#f0a04b' : '#4cc38a' }}
            >
              {describeRestore(restoreReport)}
            </span>
          )}
        </div>
      )}

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
                  onSelect={setSelected}
                />
              </StudioPanelFrame>
            </div>
          </div>
        ))}
      </div>

      {selected && (
        <div
          data-testid="studio-tile-detail"
          style={{
            position: 'absolute',
            // Below the top row (16 padding + ~28 row + 16 gap), not over it:
            // the nav lives at the row's right end and must stay clickable.
            top: 60,
            right: 16,
            zIndex: 5,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-end',
            gap: 6,
          }}
        >
          <button
            type="button"
            aria-label="close camera detail"
            data-testid="studio-tile-detail-close"
            onClick={() => setSelected(null)}
            style={{
              fontFamily: mono,
              fontSize: 11,
              background: '#0e1119',
              color: '#d7dce6',
              border: `1px solid ${hairline}`,
              borderRadius: 6,
              padding: '3px 8px',
              cursor: 'pointer',
            }}
          >
            close
          </button>
          <CameraHealthHeader webcam={selected} />
          {/*
            A saved scene is a moment in the past. Capturing a frame to label
            there would fetch what the camera sees NOW and put the operator's
            judgment of that evening on tonight's image, so capture is offered
            on the live pool only.
          */}
          <FrameLabelCard
            webcam={selected}
            allowCapture={sceneSource.kind === 'live'}
          />
        </div>
      )}
    </div>
  );
}
