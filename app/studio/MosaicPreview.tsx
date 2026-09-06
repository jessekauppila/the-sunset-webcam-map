'use client';

import { useState } from 'react';
import { useTerminatorStore } from '@/app/store/useTerminatorStore';
import { resolveMosaic } from '@/app/components/mosaic/registry';
import type { PanelSize } from '@/app/kiosk/panelPreview';
import type { SettingsValues } from '@/app/lib/settings/schema';
import type { SceneSource } from './useSceneWebcams';
import type { SceneState } from '@/app/lib/scenes/types';
import { StudioPanelFrame } from './StudioPanelFrame';
import { poolFor } from './previewPool';
import { FrameLabelCard } from '@/app/components/Webcam/FrameLabelCard';
import { CameraHealthHeader } from '@/app/components/MyCameras/CameraHealthHeader';
import type { WindyWebcam } from '@/app/lib/types';

const mono = 'ui-monospace, SFMono-Regular, Menlo, monospace';
const dim = '#8b95a7';
const hairline = '#232a38';

const FEEDS: Array<'sunrise' | 'sunset'> = ['sunrise', 'sunset'];

/**
 * The two mosaic screens and the tile detail card, lifted out of
 * `PreviewPane` without its chrome (the view control, the scene selector row,
 * the nav slot). `PreviewPane` itself is untouched — a later task deletes it
 * once every caller has moved to this component.
 */
export function MosaicPreview({
  versionName,
  panel,
  settings,
  shared,
  sceneSource,
  sceneState,
  at,
}: {
  versionName: string;
  panel: PanelSize;
  settings?: SettingsValues;
  /** The shared namespace's values; the solo versions draw their caption from it. */
  shared?: SettingsValues;
  sceneSource: SceneSource;
  sceneState: SceneState | null;
  at?: string;
}) {
  const liveSunrise = useTerminatorStore((t) => t.sunrise);
  const liveSunset = useTerminatorStore((t) => t.sunset);
  const Mosaic = resolveMosaic(versionName);

  // A scene is selected but hasn't resolved yet (still loading, 404, or a
  // fetch error) — don't fall through to the live pool and silently show it
  // under the scene's header, and don't render live tiles at all.
  const sceneUnresolved = sceneSource.kind === 'scene' && !sceneState;

  // The camera whose tile was clicked. Cleared whenever the scene changes so
  // a card describing a tile from the previous pool would otherwise sit over
  // a composition that no longer contains it — but this component doesn't
  // track scene identity itself, so callers that swap scenes should remount
  // (as PreviewPane does, keyed on scene id) or this stays selected across
  // the swap.
  const [selected, setSelected] = useState<WindyWebcam | null>(null);

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
        position: 'relative',
      }}
    >
      {sceneUnresolved ? (
        <span
          data-testid="studio-scene-status"
          style={{ fontFamily: mono, fontSize: 11, color: dim }}
        >
          loading scene…
        </span>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            flex: 1,
            minHeight: 0,
            width: '100%',
            alignItems: 'center',
            justifyItems: 'center',
            gap: 24,
          }}
        >
          {FEEDS.map((feed) => (
            <div
              key={feed}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 8,
                height: '100%',
                minWidth: 0,
                width: '100%',
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
                    shared={shared}
                    driveSchedule={false}
                    at={at}
                    onSelect={setSelected}
                  />
                </StudioPanelFrame>
              </div>
            </div>
          ))}
        </div>
      )}

      {selected && (
        <div
          data-testid="studio-tile-detail"
          style={{
            position: 'absolute',
            top: 0,
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
          <FrameLabelCard webcam={selected} allowCapture={sceneSource.kind === 'live'} />
        </div>
      )}
    </div>
  );
}
