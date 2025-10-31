import { useEffect, useMemo, useState, useRef } from 'react';
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
  isPaused?: boolean;
  mode?: string; // Add mode to detect when switching
}

export default function GlobeMap({
  webcams,
  // sunrise,
  // sunset,
  currentTime,
  initialViewState = { longitude: 0, latitude: 20, zoom: 0 },
  targetLocation = null,
  isPaused = false,
  mode, // Add mode parameter
}: GlobeMapProps) {
  // Sync lighting with current time
  sunLight.timestamp = currentTime.getTime();

  const [viewState, setViewState] =
    useState<GlobeViewState>(initialViewState);

  useEffect(() => {
    setViewState((vs) => ({ ...vs, ...initialViewState }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const previousLocationRef = useRef<{
    longitude: number;
    latitude: number;
  } | null>(null);
  const previousModeRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    // If mode changed, reset previous location so it flies on mode switch
    if (mode !== undefined && mode !== previousModeRef.current) {
      console.log('🔄 Globe mode changed, resetting fly-to tracking');
      previousLocationRef.current = null;
      previousModeRef.current = mode;
    }

    if (!targetLocation || isPaused) return;

    // Check if location changed OR mode changed
    const prevLocation = previousLocationRef.current;
    const shouldFly =
      !prevLocation ||
      prevLocation.longitude !== targetLocation.longitude ||
      prevLocation.latitude !== targetLocation.latitude ||
      (mode !== undefined && mode !== previousModeRef.current);

    if (!shouldFly) return;

    console.log('🎯 Globe flying to location:', targetLocation);
    previousLocationRef.current = targetLocation;

    setViewState((prev) => ({
      ...prev,
      longitude: targetLocation.longitude,
      latitude: targetLocation.latitude,
      zoom: Math.max(prev.zoom ?? 0, 0.8),
      transitionDuration: 2000,
      transitionInterpolator: new FlyToInterpolator(),
    }));
  }, [targetLocation, isPaused, mode]); // Add mode to dependencies

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

  // const terminatorLayers = useMemo(
  //   () => [
  //     new GeoJsonLayer({
  //       id: 'terminator-sunrise',
  //       data: sunrise,
  //       stroked: true,
  //       filled: false,
  //       lineWidthMinPixels: 2,
  //       getLineColor: [120, 170, 255, 200],
  //       pickable: false,
  //     }),
  //     new GeoJsonLayer({
  //       id: 'terminator-sunset',
  //       data: sunset,
  //       stroked: true,
  //       filled: false,
  //       lineWidthMinPixels: 2,
  //       getLineColor: [255, 170, 120, 200],
  //       pickable: false,
  //     }),
  //   ],
  //   [sunrise, sunset]
  // );

  const webcamLayer = useMemo(
    () =>
      new IconLayer<WindyWebcam>({
        id: 'webcams',
        data: (webcams || []).filter((webcam) => {
          // Filter out null/undefined webcams and missing location data
          if (!webcam || !webcam.location || !webcam.webcamId) {
            return false;
          }

          // 3D culling: hide webcams that are on the far side of the globe
          const webcamLat = webcam.location.latitude;
          const webcamLng = webcam.location.longitude;
          const cameraLat = viewState.latitude;
          const cameraLng = viewState.longitude;

          // Convert to radians
          const lat1 = (cameraLat * Math.PI) / 180;
          const lng1 = (cameraLng * Math.PI) / 180;
          const lat2 = (webcamLat * Math.PI) / 180;
          const lng2 = (webcamLng * Math.PI) / 180;

          // Calculate angular distance using haversine formula
          const dLat = lat2 - lat1;
          const dLng = lng2 - lng1;
          const a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1) *
              Math.cos(lat2) *
              Math.sin(dLng / 2) *
              Math.sin(dLng / 2);
          const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
          const angularDistance = c * (180 / Math.PI); // Convert to degrees

          //This controls the angle at which webcams on the other side of the world disappear
          return angularDistance < 100;
        }),
        getIcon: (w) => {
          const fallback =
            'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" rx="8" ry="8" fill="%23eee"/><text x="8" y="36" font-size="24">🌅</text></svg>';

          // Validate URL before using it
          const previewUrl = w.images?.current?.preview;
          const isValidUrl =
            previewUrl &&
            (previewUrl.startsWith('http://') ||
              previewUrl.startsWith('https://')) &&
            previewUrl.length > 10; // Basic validation

          const url = isValidUrl ? previewUrl : fallback;

          // For webcam previews, use a more rectangular aspect ratio
          // Most webcam images are wider than tall (16:9 or 4:3)
          if (isValidUrl) {
            return { url, width: 64, height: 36, anchorY: 40 }; // 16:9 aspect ratio
          }

          // Fallback emoji stays square
          return { url, width: 48, height: 48, anchorY: 24 };
        },
        sizeUnits: 'pixels',
        getSize: 48,
        getPosition: (w) => [
          w?.location?.longitude || 0,
          w?.location?.latitude || 0,
          50000, // Higher elevation to ensure icons are above everything
        ],
        loadOptions: { image: { crossOrigin: 'anonymous' } },
        onError: (error) => {
          console.warn('Failed to load webcam icon:', error);
        },
        pickable: true,
        billboard: true, // Always face the camera
        //these eliminate the intersection of the icons with the globe,
        //but then you can also see them on the otherside of the globe
        parameters: {
          depthTest: false, // Disable depth testing completely
          //depthMask: false,
        } as Record<string, unknown>,
      }),
    [webcams, viewState.longitude, viewState.latitude]
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
      layers={[...backgroundLayers, webcamLayer]} //...terminatorLayers
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
