import { useEffect, useRef, useState } from 'react';
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
  // Flips to true once SunShadowLayer is actually attached. The push-sun-direction
  // effect depends on this so it re-fires after the layer becomes available
  // (the layer install is async — it waits for Mapbox's style.load).
  const [layerInstalled, setLayerInstalled] = useState(false);

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
      setLayerInstalled(true);
    };

    if (map.isStyleLoaded()) {
      install();
    } else {
      map.once('style.load', install);
    }

    return () => {
      // The map's style may already be torn down by the time cleanup runs
      // (e.g. when switching to a mosaic mode unmounts SimpleMap). getLayer
      // throws against an undefined style; same guard pattern as
      // useUpdateTerminatorRing.
      try {
        if (shadowLayerRef.current && map.getLayer(shadowLayerRef.current.id)) {
          map.removeLayer(shadowLayerRef.current.id);
        }
      } catch {
        // ignore — the map is being disposed
      }
      shadowLayerRef.current = null;
      setLayerInstalled(false);
    };
  }, [map, mapLoaded]);

  // Push sun direction into the shadow layer whenever currentTime changes
  // OR the layer becomes available (without this dep, on first load the layer
  // installs after this effect runs and the shader stays at the default
  // [1, 0, 0] sun direction — terminator near Null Island, not the real sun).
  useEffect(() => {
    if (!shadowLayerRef.current || !layerInstalled) return;
    const { lat, lng } = subsolarPoint(currentTime);
    shadowLayerRef.current.setSunDirection(latLngToUnitVector(lat, lng));
  }, [currentTime, layerInstalled]);

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
