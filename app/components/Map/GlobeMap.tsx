import { useMemo } from 'react';
import { DeckGL } from '@deck.gl/react';
import {
  COORDINATE_SYSTEM,
  _GlobeView as GlobeView,
  LightingEffect,
  AmbientLight,
  _SunLight as SunLight,
  type GlobeViewState,
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
  sunrise: GeoJSON.FeatureCollection | GeoJSON.Feature;
  sunset: GeoJSON.FeatureCollection | GeoJSON.Feature;
  currentTime: Date;
  initialViewState?: GlobeViewState;
}

export default function GlobeMap({
  webcams,
  sunrise,
  sunset,
  currentTime,
  initialViewState = { longitude: 0, latitude: 20, zoom: 0 },
}: GlobeMapProps) {
  // Sync lighting with current time
  sunLight.timestamp = currentTime;

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
        data: sunrise as any,
        stroked: true,
        filled: false,
        lineWidthMinPixels: 2,
        getLineColor: [120, 170, 255, 200],
        pickable: false,
      }),
      new GeoJsonLayer({
        id: 'terminator-sunset',
        data: sunset as any,
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
        getIcon: () => ({
          url: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><text x="0" y="24">🌅</text></svg>',
          width: 32,
          height: 32,
          anchorY: 32,
        }),
        sizeUnits: 'pixels',
        getSize: 28,
        getPosition: (w) => [
          w.location.longitude,
          w.location.latitude,
        ],
        pickable: true,
      }),
    [webcams]
  );

  return (
    <DeckGL
      views={new GlobeView()}
      initialViewState={initialViewState}
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
