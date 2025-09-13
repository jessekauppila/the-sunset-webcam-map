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

  const { lat, lng, raHours, gmstHours } = useMemo(() => {
    return subsolarPoint(currentTime);
  }, [currentTime]);

  const subsolarLocation = useMemo(() => ({ lat, lng }), [lat, lng]);

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

  // Memoize the coordinate arrays to prevent unnecessary re-renders
  // Create a stable key based on the actual content
  const sunriseKey = useMemo(
    () => sunriseCoords.map((c) => `${c.lat},${c.lng}`).join('|'),
    [sunriseCoords]
  );

  const sunsetKey = useMemo(
    () => sunsetCoords.map((c) => `${c.lat},${c.lng}`).join('|'),
    [sunsetCoords]
  );

  const memoizedSunriseCoords = useMemo(
    () => sunriseCoords,
    [sunriseKey]
  );
  const memoizedSunsetCoords = useMemo(
    () => sunsetCoords,
    [sunsetKey]
  );

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
    sunriseCoords: memoizedSunriseCoords,
    sunsetCoords: memoizedSunsetCoords,
    allTerminatorCoords,
    sunrise,
    sunset,
    entireTerminatorRing,
    entireHiResTerminatorRing,
    sunSetRiseRingLineLayer,
  };
}
