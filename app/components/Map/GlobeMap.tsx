import { useEffect, useMemo, useState } from 'react';
import { DeckGL } from '@deck.gl/react';
import {
  COORDINATE_SYSTEM,
  _GlobeView as GlobeView,
  LightingEffect,
  AmbientLight,
  _SunLight as SunLight,
  type GlobeViewState,
  FlyToInterpolator,
} from '@deck.gl/core';
import { GeoJsonLayer, IconLayer } from '@deck.gl/layers';
import { SimpleMeshLayer } from '@deck.gl/mesh-layers';
import { SphereGeometry } from '@luma.gl/engine';
import type { WindyWebcam } from '../../lib/types';
import { createWebcamPopupContent } from './lib/webcamPopup';

const EARTH_RADIUS_METERS = 6.3e6;

const ambientLight = new AmbientLight({
  color: [255, 255, 255],
  intensity: 0.5,
});
const sunLight = new SunLight({
  color: [255, 255, 255],
  intensity: 2.0,
  timestamp: 0,
});
const lightingEffect = new LightingEffect({ ambientLight, sunLight });

interface GlobeMapProps {
  webcams: WindyWebcam[];
  sunrise:
    | GeoJSON.FeatureCollection<GeoJSON.LineString>
    | GeoJSON.Feature<GeoJSON.LineString>;
  sunset:
    | GeoJSON.FeatureCollection<GeoJSON.LineString>
    | GeoJSON.Feature<GeoJSON.LineString>;
  currentTime: Date;
  initialViewState?: GlobeViewState;
  targetLocation?: { longitude: number; latitude: number } | null;
}

export default function GlobeMap({
  webcams,
  sunrise,
  sunset,
  currentTime,
  initialViewState = { longitude: 0, latitude: 20, zoom: 0 },
  targetLocation = null,
}: GlobeMapProps) {
  // Sync lighting with current time
  sunLight.timestamp = currentTime;

  const [viewState, setViewState] =
    useState<GlobeViewState>(initialViewState);

  useEffect(() => {
    setViewState((vs) => ({ ...vs, ...initialViewState }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!targetLocation) return;
    setViewState((prev) => ({
      ...prev,
      longitude: targetLocation.longitude,
      latitude: targetLocation.latitude,
      zoom: Math.max(prev.zoom ?? 0, 0.8),
      transitionDuration: 2000,
      transitionInterpolator: new FlyToInterpolator(),
    }));
  }, [targetLocation]);

  const backgroundLayers = useMemo(
    () => [
      new SimpleMeshLayer({
        id: 'earth-sphere',
        data: [0],
        mesh: new SphereGeometry({
          radius: EARTH_RADIUS_METERS,
          nlat: 18,
          nlong: 36,
        }),
        coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
        getPosition: [0, 0, 0],
        getColor: [255, 255, 255],
      }),
      new GeoJsonLayer({
        id: 'earth-land',
        data: 'https://d2ad6b4ur7yvpq.cloudfront.net/naturalearth-3.3.0/ne_50m_land.geojson',
        stroked: false,
        filled: true,
        opacity: 0.1,
        getFillColor: [30, 80, 120],
      }),
    ],
    []
  );

  const terminatorLayers = useMemo(
    () => [
      new GeoJsonLayer({
        id: 'terminator-sunrise',
        data: sunrise,
        stroked: true,
        filled: false,
        lineWidthMinPixels: 2,
        getLineColor: [120, 170, 255, 200],
        pickable: false,
      }),
      new GeoJsonLayer({
        id: 'terminator-sunset',
        data: sunset,
        stroked: true,
        filled: false,
        lineWidthMinPixels: 2,
        getLineColor: [255, 170, 120, 200],
        pickable: false,
      }),
    ],
    [sunrise, sunset]
  );

  const webcamLayer = useMemo(
    () =>
      new IconLayer<WindyWebcam>({
        id: 'webcams',
        data: webcams,
        getIcon: (w) => {
          const fallback =
            'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" rx="8" ry="8" fill="%23eee"/><text x="8" y="36" font-size="24">🌅</text></svg>';
          const url = w.images?.current?.preview || fallback;

          // For webcam previews, use a more rectangular aspect ratio
          // Most webcam images are wider than tall (16:9 or 4:3)
          if (w.images?.current?.preview) {
            return { url, width: 64, height: 36, anchorY: 40 }; // 16:9 aspect ratio
          }

          // Fallback emoji stays square
          return { url, width: 48, height: 48, anchorY: 24 };
        },
        sizeUnits: 'pixels',
        getSize: 48,
        getPosition: (w) => [
          w.location.longitude,
          w.location.latitude,
        ],
        loadOptions: { image: { crossOrigin: 'anonymous' } },
        pickable: true,
      }),
    [webcams]
  );

  return (
    <DeckGL
      views={new GlobeView()}
      viewState={viewState}
      onViewStateChange={({ viewState }) =>
        setViewState(viewState as GlobeViewState)
      }
      controller={true}
      effects={[lightingEffect]}
      layers={[...backgroundLayers, ...terminatorLayers, webcamLayer]}
      getTooltip={({ object }) =>
        object
          ? {
              html: createWebcamPopupContent(object as WindyWebcam),
              style: { maxWidth: '280px' },
            }
          : null
      }
    />
  );
}
