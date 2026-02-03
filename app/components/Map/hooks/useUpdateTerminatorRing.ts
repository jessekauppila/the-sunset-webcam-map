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
  options?: {
    attachToMap?: boolean;
    showSearchRadius?: boolean;
    precisionDeg?: number; // Use same precision as cron job (default: 4°)
    searchRadiusDegrees?: number; // Search radius used in API calls (default: 5°)
  }
) {
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const attachToMap = options?.attachToMap ?? true;
  const showSearchRadius = options?.showSearchRadius ?? false;
  const precisionDeg = options?.precisionDeg ?? 4; // Match cron job precision
  const searchRadiusDegrees = options?.searchRadiusDegrees ?? 5; // Match cron job search radius

  const { lat, lng, raHours, gmstHours } = useMemo(() => {
    return subsolarPoint(currentTime);
  }, [currentTime]);

  const subsolarLocation = useMemo(() => ({ lat, lng }), [lat, lng]);

  const { entireHiResTerminatorRing } = useMemo(() => {
    return createTerminatorRingHiRes(currentTime);
  }, [currentTime]);

  // Use the same precision as the cron job for accurate visualization
  const {
    sunriseCoords,
    sunsetCoords,
    allTerminatorCoords,
    sunrise,
    sunset,
    entireTerminatorRing,
  } = useMemo(() => {
    return createTerminatorRing(currentTime, raHours, gmstHours, precisionDeg);
  }, [currentTime, raHours, gmstHours, precisionDeg]);

  // Memoize the coordinate arrays to prevent unnecessary re-renders

  const memoizedSunriseCoords = useMemo(
    () => sunriseCoords,
    [sunriseCoords]
  );
  const memoizedSunsetCoords = useMemo(
    () => sunsetCoords,
    [sunsetCoords]
  );

  // Combine sunrise and sunset coords to get all terminator points used for API queries
  const allTerminatorPoints = useMemo(() => {
    return [...sunriseCoords, ...sunsetCoords];
  }, [sunriseCoords, sunsetCoords]);

  const sunSetRiseRingLineLayer = makeTerminatorLayers({
    sunrise,
    sunset,
    entireTerminatorRing,
    entireHiResTerminatorRing,
    showSearchRadius,
    searchRadiusDegrees,
    terminatorPoints: allTerminatorPoints,
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
  }, [
    map,
    mapLoaded,
    attachToMap,
    sunSetRiseRingLineLayer,
    showSearchRadius,
  ]);

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
