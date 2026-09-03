'use client';

import { useMemo, useState } from 'react';
import { useLoadTerminatorWebcams } from '@/app/store/useLoadTerminatorWebcams';
import { useTerminatorStore } from '@/app/store/useTerminatorStore';
import { PreviewPane, type FeedView } from './PreviewPane';
import { StudioRail } from './StudioRail';
import { MapMosaicModeToggle } from '@/app/components/MapMosaicModeToggle';
import { useStudioSettings } from './useStudioSettings';
import { useSceneWebcams, type SceneSource } from './useSceneWebcams';
import { DeployButton } from './DeployButton';
import { StatusStrip } from './StatusStrip';
import { resolveMosaicName } from '@/app/components/mosaic/registry';
import { mergeSettings } from '@/app/lib/settings/schema';
import { SHARED_NAMESPACE, SHARED_SCHEMA } from '@/app/lib/settings/sharedSchema';
import { passesGate } from '@/app/components/mosaic/v1/qualitySignal';
import type { PanelSize } from '@/app/kiosk/panelPreview';

/**
 * `/studio` chrome: left rail (dial controls, Task 11) + preview + a bottom
 * status strip (Task 13). This task lays out the grid, keeps `railCollapsed`
 * state and the collapse pill, and wires the preview to the live terminator
 * store. The rail (Task 11) and its settings wiring are now real: panel
 * size, version, and preview settings all flow from `useStudioSettings`.
 */

const PANEL_PRESETS: Record<string, PanelSize> = {
  dell: { width: 1080, height: 1920 },
  ktc: { width: 1440, height: 2560 },
};

const bg = '#0b0e14';
const railBg = '#10141d';
const railBorder = '#1d2432';
const stripBg = '#0e1119';
const stripBorder = '#1d2432';
const pillBg = 'rgba(16,20,29,.85)';
const pillBorder = '#232a38';

export function StudioClient() {
  const [sceneSource, setSceneSource] = useState<SceneSource>({ kind: 'live' });
  useLoadTerminatorWebcams({ paused: sceneSource.kind === 'scene' });
  const { scenes, sceneState, sceneRepresentsAt, error: sceneError, refreshScenes } =
    useSceneWebcams(sceneSource);
  const settingsApi = useStudioSettings();
  const sunriseWebcams = useTerminatorStore((t) => t.sunrise);
  const sunsetWebcams = useTerminatorStore((t) => t.sunset);

  const [railCollapsed, setRailCollapsed] = useState(false);
  const [view, setView] = useState<FeedView>('both');

  const sharedSettings = settingsApi.effective('shared');
  const panelPreset = (sharedSettings.panelPreset as string) ?? 'dell';
  const panel = PANEL_PRESETS[panelPreset] ?? PANEL_PRESETS.dell;
  const panelPresetLabel = `${panelPreset} · ${panel.width}×${panel.height}`;
  const versionName = resolveMosaicName(sharedSettings.activeVersion as string | undefined);
  const previewSettings = settingsApi.effective(versionName);

  // What's actually on glass right now, NOT the studio dial position — the
  // strip reports the deployed state, so this reads the live profile's
  // deviations merged over SHARED_SCHEMA rather than settingsApi.effective
  // (which merges over the studio profile).
  const glassVersion = resolveMosaicName(
    mergeSettings(SHARED_SCHEMA, settingsApi.live?.namespaces?.[SHARED_NAMESPACE])
      .activeVersion as string | undefined
  );

  const sunrisePass = useMemo(
    () => ({
      pass: sunriseWebcams.filter(passesGate).length,
      total: sunriseWebcams.length,
    }),
    [sunriseWebcams]
  );
  const sunsetPass = useMemo(
    () => ({
      pass: sunsetWebcams.filter(passesGate).length,
      total: sunsetWebcams.length,
    }),
    [sunsetWebcams]
  );

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: railCollapsed ? '1fr' : '320px 1fr',
        gridTemplateRows: '1fr 28px',
        height: '100vh',
        width: '100%',
        background: bg,
        color: '#e5e7eb',
        overflow: 'hidden',
      }}
    >
      {!railCollapsed && (
        <aside
          style={{
            gridColumn: '1 / 2',
            gridRow: '1 / 2',
            background: railBg,
            borderRight: `1px solid ${railBorder}`,
            overflow: 'hidden',
            padding: 16,
            boxSizing: 'border-box',
          }}
        >
          <StudioRail
            api={settingsApi}
            onCollapse={() => setRailCollapsed(true)}
            deploySlot={
              <DeployButton
                diffCount={settingsApi.diffCount}
                onDeploy={settingsApi.deploy}
                onRevert={settingsApi.revert}
              />
            }
          />
        </aside>
      )}

      <main
        style={{
          gridColumn: railCollapsed ? '1 / 2' : '2 / 3',
          gridRow: '1 / 2',
          position: 'relative',
          minWidth: 0,
          minHeight: 0,
          overflow: 'hidden',
        }}
      >
        <PreviewPane
          view={view}
          onViewChange={setView}
          panel={panel}
          panelPresetLabel={panelPresetLabel}
          versionName={versionName}
          settings={previewSettings}
          scenes={scenes}
          sceneSource={sceneSource}
          onSceneSourceChange={setSceneSource}
          sceneState={sceneState}
          error={sceneError}
          at={sceneRepresentsAt ?? undefined}
          onSceneSaved={refreshScenes}
        />

        {/* Same control as the homepage, so the two surfaces are reachable
            from each other. No onModeChange: there is no homepage view state
            here, so picking one navigates. */}
        <MapMosaicModeToggle mode="studio" />

        {railCollapsed && (
          <div
            style={{
              position: 'absolute',
              left: 12,
              bottom: 12,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              background: pillBg,
              border: `1px solid ${pillBorder}`,
              borderRadius: 999,
              padding: '6px 8px',
              backdropFilter: 'blur(4px)',
            }}
          >
            <button
              type="button"
              onClick={() => setRailCollapsed(false)}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#e5e7eb',
                fontSize: 12,
                padding: '4px 10px',
                cursor: 'pointer',
              }}
            >
              » dials
            </button>
            <DeployButton
              compact
              diffCount={settingsApi.diffCount}
              onDeploy={settingsApi.deploy}
              onRevert={settingsApi.revert}
            />
          </div>
        )}
      </main>

      <div
        style={{
          gridColumn: '1 / -1',
          gridRow: '2 / 3',
          background: stripBg,
          borderTop: `1px solid ${stripBorder}`,
          display: 'flex',
          alignItems: 'center',
          padding: '0 12px',
          boxSizing: 'border-box',
        }}
      >
        <StatusStrip
          glassVersion={glassVersion}
          liveRevision={settingsApi.liveRevision}
          lastPollAt={settingsApi.lastPollAt}
          deployedAtMs={settingsApi.deployedAtMs}
          diffCount={settingsApi.diffCount}
          sunrisePass={sunrisePass}
          sunsetPass={sunsetPass}
        />
      </div>
    </div>
  );
}
