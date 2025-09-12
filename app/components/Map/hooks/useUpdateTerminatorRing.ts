import { useEffect, useState, useMemo, useRef } from 'react';
import { subsolarPoint } from '../lib/subsolarLocation';
import { createTerminatorRing } from '../lib/terminatorRing';
import { makeTerminatorLayers } from '../lib/terminatorRingLineLayer';
import { MapboxOverlay } from '@deck.gl/mapbox';

export function useUpdateTerminatorRing(
  map: mapboxgl.Map | null,
  mapLoaded: boolean,
  options?: { attachToMap?: boolean }
) {
  const [currentTime, setCurrentTime] = useState(new Date());
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const attachToMap = options?.attachToMap ?? true;

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(new Date());
    }, 60000); // 60,000 milliseconds = 1 minute

    return () => {
      console.log('🧹 Cleaning up interval...');
      clearInterval(interval); // Stop the timer
    };
  }, []);

  const { lat, lng, raHours, gmstHours } = subsolarPoint(currentTime);
  const subsolarLocation = { lat, lng };

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
    currentTime,
    subsolarLocation,
    sunriseCoords,
    sunsetCoords,
    allTerminatorCoords,
    sunrise,
    sunset,
    entireTerminatorRing,
    sunSetRiseRingLineLayer,
  };
}
