import { useEffect, useRef } from 'react';
import type { Map as MapboxMap } from 'mapbox-gl';
import { subsolarPoint } from './lib/subsolarLocation';
import { latLngToUnitVector } from './lib/latLngToUnitVector';
import { SunShadowLayer } from './layers/SunShadowLayer';

interface GlobeMapProps {
  map: MapboxMap | null;
  mapLoaded: boolean;
  currentTime: Date;
  targetLocation?: { longitude: number; latitude: number } | null;
  isPaused?: boolean;
}

/**
 * Side-effects-only component. Installs the SunShadowLayer below the first
 * Mapbox symbol layer and pushes the current sun direction into it whenever
 * `currentTime` changes. Webcam markers are owned by `useSetWebcamMarkers` in
 * SimpleMap (native Mapbox markers, shared across modes), so this component
 * has no responsibility for icons or the deck.gl overlay.
 */
export default function GlobeMap({
  map,
  mapLoaded,
  currentTime,
  targetLocation = null,
  isPaused = false,
}: GlobeMapProps) {
  const shadowLayerRef = useRef<SunShadowLayer | null>(null);

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
  }, [currentTime]);

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
