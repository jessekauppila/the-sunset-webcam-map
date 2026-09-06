'use client';

import { useState } from 'react';
import { useLoadTerminatorWebcams } from '@/app/store/useLoadTerminatorWebcams';
import { PANEL_PRESETS, DEFAULT_PANEL_PRESET } from '@/app/kiosk/panelPreview';
import { mergeSettings } from '@/app/lib/settings/schema';
import { SHARED_NAMESPACE } from '@/app/lib/settings/sharedSchema';
import { withCaption } from '@/app/lib/solo/captionSchema';
import { SOLO_VERSIONS, type SoloVersionSpec } from '@/app/lib/solo/versions';
import { runOf } from '@/app/lib/solo2/run';
import { Header } from './Header';
import { Rail, type RailTab } from './Rail';
import { DeployHistory } from './DeployHistory';
import { MosaicPreview } from './MosaicPreview';
import { MosaicPanel } from './panels/MosaicPanel';
import { SoloPanel } from './panels/SoloPanel';
import { GlassPreview } from './solo/GlassPreview';
import { useSoloState } from './solo/useSoloState';
import { restoreSceneDials } from './restoreSceneDials';
import { surfaceFor } from './surfaces';
import { useStudioSettings } from './useStudioSettings';
import { useSceneWebcams, type SceneSource } from './useSceneWebcams';

/**
 * The one `/studio` (one-studio spec §2). There is no second studio page and
 * no per-version chrome: the header's version select names a surface, and the
 * rail, the preview and the panel below all follow it. A mosaic version draws
 * the pool, the gate and the scene selector; a solo version draws the two
 * screens playing and its bins and queue. Everything a version needs is data
 * on its `StudioSurface`, so a new version is a row in `surfaces.ts`, not a
 * page here.
 *
 * The hooks that feed the mosaic surface still run on the solo one — hooks
 * cannot be skipped — so they are idled instead: the terminator load is
 * `paused` and the scene hook is asked for `live`, which fetches only the
 * scene list.
 *
 * This page keeps no clock. The header and the solo panel each run their own,
 * because a clock here re-rendered the mosaic preview once a second: a fresh
 * `effective()` object each tick became a fresh v4 config, a fresh
 * composition, and a `commit()` that restarted the canvas's motion.
 */
export function StudioClient() {
  const api = useStudioSettings();
  const shared = api.effective(SHARED_NAMESPACE);
  const surface = surfaceFor(shared.activeVersion as string | undefined);
  const panel = PANEL_PRESETS[String(shared.panelPreset)] ?? PANEL_PRESETS[DEFAULT_PANEL_PRESET];
  const [tab, setTab] = useState<RailTab>('play');
  const [sceneSource, setSceneSource] = useState<SceneSource>({ kind: 'live' });

  // Before the first poll answers, `effective()` is the schema defaults, which
  // name v1 — not necessarily the version the operator is on. Rendering that
  // guess would flash the wrong surface and start its pool fetch for one paint,
  // so the page waits with the header alone until the studio profile arrives.
  const gated = api.loading && !api.studio;

  // Mosaic surface inputs. Both hooks always run; they idle on the solo surface.
  useLoadTerminatorWebcams({
    paused: gated || surface.kind !== 'mosaic' || sceneSource.kind === 'scene',
  });
  const scene = useSceneWebcams(surface.kind === 'mosaic' ? sceneSource : { kind: 'live' });
  const settings = api.effective(surface.namespace);

  // Solo surface inputs. `studioDials` are what the dials say; `liveDials` are
  // what the glass is running, so the queue can mark the difference.
  const solo = surface.solo;
  const studioDials = solo ? solo.dialsFrom(withCaption(settings, shared)) : null;
  const liveDials = solo
    ? solo.dialsFrom(withCaption(
      mergeSettings(solo.schema, api.live?.namespaces?.[solo.namespace]),
      api.live?.namespaces?.[SHARED_NAMESPACE],
    ))
    : null;
  // useSoloState is a hook, so it runs on the mosaic surface too; `enabled`
  // false makes its SWR key null and nothing is fetched. The fallback spec
  // only exists to give the disabled call well-typed arguments.
  const fallback = SOLO_VERSIONS.solo as SoloVersionSpec;
  const sunrise = useSoloState('sunrise', studioDials ?? fallback.dialsFrom({}), solo ?? fallback, solo !== null);
  const sunset = useSoloState('sunset', studioDials ?? fallback.dialsFrom({}), solo ?? fallback, solo !== null);
  // solo2's dwell readout reads the camera on glass: the longer run of the two screens.
  const runFrames = solo?.name === 'solo2' && studioDials
    ? Math.max(1, ...[sunset, sunrise].map((s) => (s.server?.current
      ? runOf(s.server.current.entry, s.server.entries, (studioDials as { cameraRun?: boolean }).cameraRun !== false).length
      : 0)))
    : 1;

  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '250px 1fr', gridTemplateRows: '34px 1fr',
      height: '100vh', background: '#0b0e14', color: '#e5e7eb', overflow: 'hidden',
    }}>
      <div style={{ gridColumn: '1 / -1' }}>
        <Header api={api} />
      </div>

      {gated ? (
        <main data-testid="surface-loading" style={{ gridColumn: '1 / -1' }} />
      ) : (
        <>
          {/* A flex column, so the Rail's `minHeight: 100%` has a height to be
              100% of: the takes list sits at the bottom when the dials are short
              and the whole column scrolls when they are long. */}
          <aside style={{
            background: '#10141d', borderRight: '1px solid #1d2432', padding: 10,
            display: 'flex', flexDirection: 'column', overflowY: 'auto',
          }}>
            <Rail api={api} surface={surface} tab={tab} onTab={setTab} runFrames={runFrames}>
              <DeployHistory api={api} />
            </Rail>
          </aside>

          <main
            data-testid={`surface-${surface.kind}`}
            style={{
              display: 'grid', gridTemplateRows: 'clamp(220px, 36vh, 520px) auto',
              gap: 12, padding: 12, overflowY: 'auto', minWidth: 0,
            }}
          >
            {/* `solo`, `studioDials` and `liveDials` are all derived from
                `surface.solo`, so they are non-null exactly on this branch. */}
            {surface.kind === 'solo' ? (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, minHeight: 0 }}>
                  <GlassPreview dials={studioDials!} panel={panel} version={solo!} screens={[
                    { feed: 'sunrise', server: sunrise.server ?? null, error: sunrise.error },
                    { feed: 'sunset', server: sunset.server ?? null, error: sunset.error },
                  ]} />
                </div>
                <SoloPanel version={solo!} liveDials={liveDials!} sunrise={sunrise} sunset={sunset} />
              </>
            ) : (
              <>
                {/* Remounted per scene: MosaicPreview keeps the selected tile in
                    state, and a tile from the previous scene is not in this one. */}
                <MosaicPreview
                  key={sceneSource.kind === 'scene' ? sceneSource.id : 'live'}
                  versionName={surface.name} panel={panel} settings={settings} shared={shared}
                  sceneSource={sceneSource} sceneState={scene.sceneState}
                  at={scene.sceneRepresentsAt ?? undefined}
                />
                <MosaicPanel
                  versionName={surface.name} settings={settings}
                  sceneSource={sceneSource} onSceneSourceChange={setSceneSource}
                  scenes={scene.scenes} sceneState={scene.sceneState} sceneNotes={scene.sceneNotes}
                  sceneProvenance={scene.sceneProvenance} sceneError={scene.error}
                  onSceneSaved={scene.refreshScenes}
                  onRestoreDials={scene.sceneProvenance
                    ? () => restoreSceneDials(api, scene.sceneProvenance!)
                    : undefined}
                />
              </>
            )}
          </main>
        </>
      )}
    </div>
  );
}
