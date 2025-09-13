import { useEffect, useMemo, useRef } from 'react';
import { subsolarPoint } from '../lib/subsolarLocation';
import { createTerminatorRing } from '../lib/terminatorRing';
import { createTerminatorRingHiRes } from '../lib/terminatorRingHiRes';
import { makeTerminatorLayers } from '../lib/terminatorRingLineLayer';
import { MapboxOverlay } from '@deck.gl/mapbox';

export function useUpdateTerminatorRing(
  map: mapboxgl.Map | null,
  mapLoaded: boolean,
  currentTime: Date,
  options?: { attachToMap?: boolean }
) {
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const attachToMap = options?.attachToMap ?? true;

  const { lat, lng, raHours, gmstHours } = subsolarPoint(currentTime);
  const subsolarLocation = { lat, lng };

  const { entireHiResTerminatorRing } = useMemo(() => {
    return createTerminatorRingHiRes(currentTime);
  }, [currentTime, raHours, gmstHours]);

  const {
    sunriseCoords,
    sunsetCoords,
    allTerminatorCoords,
    sunrise,
    sunset,
    entireTerminatorRing,
  } = useMemo(() => {
    return createTerminatorRing(currentTime, raHours, gmstHours);
  }, [currentTime, raHours, gmstHours]);

  const sunSetRiseRingLineLayer = makeTerminatorLayers({
    sunrise,
    sunset,
    entireTerminatorRing,
    entireHiResTerminatorRing,
  });

  // Move overlay management here
  useEffect(() => {
    if (!map || !mapLoaded || !attachToMap) {
      // detach if exists
      if (overlayRef.current && map) {
        try {
          map.removeControl(overlayRef.current);
        } catch {}
      }
      overlayRef.current = null;
      return;
    }

    if (!overlayRef.current) {
      overlayRef.current = new MapboxOverlay({
        interleaved: true,
        layers: sunSetRiseRingLineLayer,
      });
      map.addControl(overlayRef.current);
    } else {
      overlayRef.current.setProps({
        layers: sunSetRiseRingLineLayer,
      });
    }

    return () => {
      if (overlayRef.current) {
        try {
          map.removeControl(overlayRef.current);
        } catch {}
        overlayRef.current = null;
      }
    };
  }, [map, mapLoaded, attachToMap, sunSetRiseRingLineLayer]);

  return {
    subsolarLocation,
    sunriseCoords,
    sunsetCoords,
    allTerminatorCoords,
    sunrise,
    sunset,
    entireTerminatorRing,
    entireHiResTerminatorRing,
    sunSetRiseRingLineLayer,
  };
}
