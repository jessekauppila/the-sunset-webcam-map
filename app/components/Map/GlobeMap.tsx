import { useEffect, useMemo, useRef } from 'react';
import type { Map as MapboxMap } from 'mapbox-gl';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { IconLayer } from '@deck.gl/layers';
import { subsolarPoint } from './lib/subsolarLocation';
import { latLngToUnitVector } from './lib/latLngToUnitVector';
import { SunShadowLayer } from './layers/SunShadowLayer';
import type { WindyWebcam } from '../../lib/types';
import { createWebcamPopupContent } from './lib/webcamPopup';

interface GlobeMapProps {
  map: MapboxMap | null;
  mapLoaded: boolean;
  webcams: WindyWebcam[];
  currentTime: Date;
  targetLocation?: { longitude: number; latitude: number } | null;
  isPaused?: boolean;
}

export default function GlobeMap({
  map,
  mapLoaded,
  webcams,
  currentTime,
  targetLocation = null,
  isPaused = false,
}: GlobeMapProps) {
  const shadowLayerRef = useRef<SunShadowLayer | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);

  // Install SunShadowLayer below the first Mapbox symbol layer.
  useEffect(() => {
    if (!map || !mapLoaded) return;

    const install = () => {
      if (shadowLayerRef.current) return;
      const layer = new SunShadowLayer();
      const firstSymbolId = map
        .getStyle()
        ?.layers?.find((l) => l.type === 'symbol')?.id;
      map.addLayer(layer, firstSymbolId);
      shadowLayerRef.current = layer;
    };

    if (map.isStyleLoaded()) {
      install();
    } else {
      map.once('style.load', install);
    }

    return () => {
      if (shadowLayerRef.current && map.getLayer(shadowLayerRef.current.id)) {
        map.removeLayer(shadowLayerRef.current.id);
      }
      shadowLayerRef.current = null;
    };
  }, [map, mapLoaded]);

  // Push sun direction into the shadow layer whenever currentTime changes.
  useEffect(() => {
    if (!shadowLayerRef.current) return;
    const { lat, lng } = subsolarPoint(currentTime);
    shadowLayerRef.current.setSunDirection(latLngToUnitVector(lat, lng));
  }, [currentTime, mapLoaded]);

  // Filter webcams using spherical distance from the map center (3D culling).
  const filteredWebcams = useMemo(
    () =>
      (webcams || []).filter((webcam) => {
        if (!webcam || !webcam.location || !webcam.webcamId) return false;
        if (!map) return true;
        const cam = map.getCenter();
        const lat1 = (cam.lat * Math.PI) / 180;
        const lng1 = (cam.lng * Math.PI) / 180;
        const lat2 = (webcam.location.latitude * Math.PI) / 180;
        const lng2 = (webcam.location.longitude * Math.PI) / 180;
        const dLat = lat2 - lat1;
        const dLng = lng2 - lng1;
        const a =
          Math.sin(dLat / 2) ** 2 +
          Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
        const angularDistance =
          2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * (180 / Math.PI);
        return angularDistance < 100;
      }),
    [webcams, map],
  );

  // Install the MapboxOverlay as a control (hosts the IconLayer for webcams).
  useEffect(() => {
    if (!map || !mapLoaded) return;

    const overlay = new MapboxOverlay({
      interleaved: true,
      layers: [],
    });
    map.addControl(overlay);
    overlayRef.current = overlay;

    return () => {
      map.removeControl(overlay);
      overlayRef.current = null;
    };
  }, [map, mapLoaded]);

  // Update the overlay's layers whenever webcam data changes.
  useEffect(() => {
    if (!overlayRef.current) return;

    const iconLayer = new IconLayer<WindyWebcam>({
      id: 'webcams',
      data: filteredWebcams,
      getIcon: (w) => {
        const fallback =
          'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" rx="8" ry="8" fill="%23eee"/><text x="8" y="36" font-size="24">🌅</text></svg>';
        const previewUrl = w.images?.current?.preview;
        const isValidUrl =
          previewUrl &&
          (previewUrl.startsWith('http://') ||
            previewUrl.startsWith('https://')) &&
          previewUrl.length > 10;
        const url = isValidUrl ? previewUrl : fallback;
        if (isValidUrl) {
          return { url, width: 64, height: 36, anchorY: 40 };
        }
        return { url, width: 48, height: 48, anchorY: 24 };
      },
      sizeUnits: 'pixels',
      getSize: 48,
      getPosition: (w) => [
        w?.location?.longitude || 0,
        w?.location?.latitude || 0,
        50000,
      ],
      loadOptions: { image: { crossOrigin: 'anonymous' } },
      onError: (error) => {
        console.warn('Failed to load webcam icon:', error);
      },
      pickable: true,
      billboard: true,
      parameters: { depthTest: false } as Record<string, unknown>,
      onHover: ({ object }) => {
        if (!map) return;
        const canvas = map.getCanvasContainer();
        if (!object) {
          canvas.title = '';
          return;
        }
        canvas.title = createWebcamPopupContent(object as WindyWebcam);
      },
    });

    overlayRef.current.setProps({ layers: [iconLayer] });
  }, [filteredWebcams, map]);

  // Fly to targetLocation when it changes (and not paused).
  const previousLocationRef = useRef<{
    longitude: number;
    latitude: number;
  } | null>(null);

  useEffect(() => {
    if (!map || !mapLoaded || !targetLocation || isPaused) return;
    const prev = previousLocationRef.current;
    const changed =
      !prev ||
      prev.longitude !== targetLocation.longitude ||
      prev.latitude !== targetLocation.latitude;
    if (!changed) return;
    previousLocationRef.current = targetLocation;
    map.flyTo({
      center: [targetLocation.longitude, targetLocation.latitude],
      zoom: Math.max(map.getZoom(), 0.8),
      duration: 2000,
    });
  }, [map, mapLoaded, targetLocation, isPaused]);

  return null;
}
