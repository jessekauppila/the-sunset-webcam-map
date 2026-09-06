'use client';

import { useEffect, useState } from 'react';
import { useTerminatorStore } from '@/app/store/useTerminatorStore';
import type { SettingsValues } from '@/app/lib/settings/schema';
import type { SceneProvenance, SceneState, SceneSummary } from '@/app/lib/scenes/types';
import type { SceneSource } from '../useSceneWebcams';
import { describeRestore, type RestoreReport } from '../restoreReport';
import { SaveSceneButton } from '../SaveSceneButton';
import { poolFor } from '../previewPool';
import { countGatePasses, resolveGate } from '@/app/components/mosaic/gate';

const mono = 'ui-monospace, SFMono-Regular, Menlo, monospace';
const dim = '#8b95a7';
const hairline = '#1d2432';

type Feed = 'sunrise' | 'sunset';

/**
 * Same reasoning as PreviewPane.tsx's sceneOptionLabel: a live capture and a
 * rebuilt evening are drawn from different populations, so the dropdown must
 * say which one a saved scene is before the operator picks it.
 */
function sceneOptionLabel(scene: SceneSummary): string {
  const marker = scene.source === 'live' ? 'captured' : 'rebuilt';
  return `${scene.label} · ${marker} · ${new Date(scene.representsAt).toLocaleString()}`;
}

function StatTile({
  testId,
  label,
  value,
}: {
  testId: string;
  label: string;
  value: string;
}) {
  return (
    <div
      data-testid={testId}
      style={{
        border: `1px solid ${hairline}`,
        borderRadius: 3,
        padding: '6px 8px',
      }}
    >
      <div
        style={{
          fontSize: 9,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          color: dim,
        }}
      >
        {label}
      </div>
      <div style={{ fontFamily: mono, fontSize: 16 }}>{value}</div>
    </div>
  );
}

export function MosaicPanel({
  versionName,
  settings,
  sceneSource,
  onSceneSourceChange,
  scenes,
  sceneState,
  sceneNotes,
  sceneProvenance,
  sceneError,
  onRestoreDials,
  onSceneSaved,
}: {
  versionName: string;
  settings: SettingsValues;
  sceneSource: SceneSource;
  onSceneSourceChange: (s: SceneSource) => void;
  scenes: SceneSummary[];
  sceneState: SceneState | null;
  sceneNotes: string | null;
  sceneProvenance: SceneProvenance | null;
  sceneError: string | null;
  onRestoreDials?: () => RestoreReport;
  onSceneSaved: (id: number) => void;
}) {
  const liveSunrise = useTerminatorStore((t) => t.sunrise);
  const liveSunset = useTerminatorStore((t) => t.sunset);
  const live = { sunrise: liveSunrise, sunset: liveSunset };
  const gate = resolveGate(versionName);

  // A scene is selected but hasn't resolved yet (loading, 404, fetch error).
  const sceneUnresolved = sceneSource.kind === 'scene' && !sceneState;

  // Cleared when the scene id changes, same as PreviewPane.tsx: a stale
  // report must not go on describing a scene that is no longer selected.
  const [restoreReport, setRestoreReport] = useState<RestoreReport | null>(null);
  const sceneId = sceneSource.kind === 'scene' ? sceneSource.id : null;
  useEffect(() => {
    setRestoreReport(null);
  }, [sceneId]);

  const showSceneRow =
    sceneSource.kind === 'scene' && (sceneNotes || (sceneProvenance && onRestoreDials));

  const hasBands = typeof settings.bandCount === 'number';
  const hasMaxTiles = typeof settings.maxTiles === 'number';

  const feeds: Feed[] = ['sunrise', 'sunset'];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, width: '100%' }}>
        {feeds.map((feed) => {
          const pool = poolFor(feed, sceneSource, sceneState, live);
          const pass = countGatePasses(pool, gate, settings);
          const denominator = hasMaxTiles ? (settings.maxTiles as number) : pass.total;

          return (
            <div key={feed} style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: 8,
                }}
              >
                <span style={{ fontFamily: mono, fontSize: 11, color: dim }}>
                  {feed === 'sunrise' ? '↑ sunrise' : '↓ sunset'}
                </span>
                {feed === 'sunset' && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontFamily: mono, fontSize: 11, color: dim }}>pool</span>
                    <select
                      aria-label="data source"
                      data-testid="studio-scene-select"
                      value={sceneSource.kind === 'live' ? 'live' : String(sceneSource.id)}
                      onChange={(e) => {
                        const raw = e.target.value;
                        onSceneSourceChange(
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
                  </div>
                )}
              </div>

              {feed === 'sunset' && sceneUnresolved && (
                <span
                  data-testid="studio-scene-status"
                  style={{ fontFamily: mono, fontSize: 11, color: sceneError ? '#f0a04b' : dim }}
                >
                  {sceneError ?? 'loading scene…'}
                </span>
              )}

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <StatTile
                  testId={`mosaic-panel-pool-${feed}`}
                  label="pool"
                  value={String(pool.length)}
                />
                <StatTile
                  testId={`mosaic-panel-pass-${feed}`}
                  label="pass gate"
                  value={`${pass.pass} / ${denominator}`}
                />
                {hasBands && (
                  <StatTile
                    testId={`mosaic-panel-bands-${feed}`}
                    label="bands"
                    value={`${settings.bandCount} × ${settings.floorPx}`}
                  />
                )}
              </div>
            </div>
          );
        })}
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
    </div>
  );
}
