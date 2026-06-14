'use client';

import { useMemo, useState } from 'react';
import SimpleMap from '@/app/components/Map/SimpleMap';
import type { Location } from '@/app/lib/types';
import { useMyCamerasStore } from '@/app/store/useMyCamerasStore';
import { useLoadMyCameras } from '@/app/store/useLoadMyCameras';
import { myCameraToWindyWebcam } from '@/app/lib/myCameras';
import { sortByHealthWorstFirst, summarizeHealth } from './healthOrdering';
import { healthVisual } from '@/app/components/Map/cameraHealthVisual';

export function MyCamerasView({ userLocation }: { userLocation: Location }) {
  const [showDecommissioned, setShowDecommissioned] = useState(false);
  useLoadMyCameras({ includeEnded: showDecommissioned });
  const cameras = useMyCamerasStore((s) => s.cameras);

  const [inRangeOnly, setInRangeOnly] = useState(false); // default: All
  const [listCollapsed, setListCollapsed] = useState(false);
  const [focusId, setFocusId] = useState<number | null>(null);

  // Exclude ended markers unless the toggle is on
  const activeCameras = useMemo(
    () => showDecommissioned ? cameras : cameras.filter((c) => c.state !== 'ended' && c.ended_at == null),
    [cameras, showDecommissioned]
  );

  const visible = useMemo(
    () => (inRangeOnly ? activeCameras.filter((c) => c.isInWindowNow) : activeCameras),
    [activeCameras, inRangeOnly]
  );
  const summary = useMemo(() => summarizeHealth(visible), [visible]);
  const sorted = useMemo(() => sortByHealthWorstFirst(visible), [visible]);
  const markerWebcams = useMemo(() => visible.map(myCameraToWindyWebcam), [visible]);

  return (
    <section className="map-container w-full h-screen" style={{ position: 'relative' }}>
      <SimpleMap
        userLocation={userLocation}
        mode="my-cameras"
        cameraWebcams={markerWebcams}
        focusWebcamId={focusId}
      />

      {/* Summary chips: live/stale/offline. "Never reported" cameras are
          surfaced in the list below (sorted near the top), not as a chip. */}
      <div
        style={{
          position: 'absolute', top: 16, left: 16, zIndex: 3, display: 'flex',
          gap: 8, alignItems: 'center', background: 'rgba(0,0,0,0.7)',
          padding: '6px 10px', borderRadius: 999, color: 'white', fontSize: 12,
        }}
      >
        <strong style={{ fontSize: 12 }}>My Cameras</strong>
        <span data-testid="summary-live" style={{ color: healthVisual('live').color }}>
          {summary.live} live
        </span>
        <span data-testid="summary-stale" style={{ color: healthVisual('stale').color }}>
          {summary.stale} stale
        </span>
        <span data-testid="summary-offline" style={{ color: healthVisual('offline').color }}>
          {summary.offline} off
        </span>
        <button
          type="button"
          aria-label="In-range filter"
          aria-pressed={inRangeOnly}
          onClick={() => setInRangeOnly((v) => !v)}
          style={{
            marginLeft: 8, fontSize: 11, padding: '2px 8px', borderRadius: 999,
            background: inRangeOnly ? '#37607a' : 'rgba(255,255,255,0.15)', color: 'white',
          }}
        >
          {inRangeOnly ? 'In range' : 'All'}
        </button>
        <button
          type="button"
          aria-label="Show decommissioned"
          aria-pressed={showDecommissioned}
          onClick={() => setShowDecommissioned((v) => !v)}
          style={{
            marginLeft: 4, fontSize: 11, padding: '2px 8px', borderRadius: 999,
            background: showDecommissioned ? '#5a3e6b' : 'rgba(255,255,255,0.15)',
            color: showDecommissioned ? '#d4aaff' : 'white',
          }}
        >
          {showDecommissioned ? 'Incl. decommissioned' : 'Show decommissioned'}
        </button>
      </div>

      {/* Camera list panel */}
      <div
        style={{
          position: 'absolute', top: 16, right: 16, bottom: 16, zIndex: 3,
          width: 200, background: 'rgba(14,19,27,0.92)', borderRadius: 10,
          color: '#e8edf4', display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}
      >
        <button
          type="button"
          onClick={() => setListCollapsed((v) => !v)}
          aria-label={listCollapsed ? 'Expand list' : 'Collapse list'}
          style={{
            padding: '8px 10px', fontSize: 11, textAlign: 'left',
            borderBottom: '1px solid #2a2f3a', color: '#aeb6c2',
          }}
        >
          {listCollapsed ? 'Expand list ▾' : 'Collapse list ▴'}
        </button>
        {!listCollapsed && (
          <div style={{ overflowY: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {sorted.map((cam) => {
              const isEnded = cam.state === 'ended' || cam.ended_at != null;
              const visual = healthVisual(cam.health);
              return (
                <button
                  key={cam.markerId}
                  type="button"
                  data-testid="camera-row"
                  data-title={cam.title}
                  onClick={() => setFocusId(cam.markerId)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, fontSize: 11,
                    background: isEnded ? '#1a1520' : '#151b25',
                    borderRadius: 6, padding: '5px 6px', textAlign: 'left',
                    opacity: isEnded ? 0.6 : 1,
                  }}
                >
                  <span
                    style={{
                      width: 8, height: 8, borderRadius: '50%',
                      background: isEnded ? '#6b6b7a' : visual.color,
                      flex: 'none',
                    }}
                  />
                  <span style={{ overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                    {cam.title}
                  </span>
                  {isEnded ? (
                    <span
                      data-testid="decommissioned-badge"
                      style={{ marginLeft: 'auto', color: '#8a8a9a', fontSize: 10 }}
                    >
                      decommissioned
                    </span>
                  ) : (
                    <span style={{ marginLeft: 'auto', color: visual.color }}>{visual.label}</span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
