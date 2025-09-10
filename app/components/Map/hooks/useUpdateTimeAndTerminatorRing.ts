import { useEffect, useState, useMemo, useRef } from 'react';
import { subsolarPoint } from '../lib/subsolarLocation';
import { splitTerminatorSunriseSunset } from '../lib/terminatorRing';
import { makeTerminatorLayers } from '../lib/terminatorRingLineLayer';
import { MapboxOverlay } from '@deck.gl/mapbox';

export function useUpdateTimeAndTerminatorRing(
  map: mapboxgl.Map | null,
  mapLoaded: boolean,
  options?: { attachToMap?: boolean }
) {
  const [currentTime, setCurrentTime] = useState(new Date());
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const attachToMap = options?.attachToMap ?? true;

  useEffect(() => {
    // 🎯 SETUP: What happens when the component mounts
    // console.log('🚀 Setting up interval...');

    // ⏰ INTERVAL: Create a timer that runs every 60,000ms (1 minute)
    const interval = setInterval(() => {
      // console.log('⏰ Interval fired! Updating time...');

      // 🔄 UPDATE: Change the state to trigger a re-render
      setCurrentTime(new Date());
    }, 60000); // 60,000 milliseconds = 1 minute

    // 🧹 CLEANUP: What happens when the component unmounts
    return () => {
      console.log('🧹 Cleaning up interval...');
      clearInterval(interval); // Stop the timer
    };
  }, []); // 📋 DEPENDENCIES: Empty array = run once on mount

  const { lat, lng, raHours, gmstHours } = subsolarPoint(currentTime);
  const subsolarLocation = { lat, lng };

  // console.log('🔍 Subsolar location:', subsolarLocation);
  // console.log('raHours: ', raHours);
  // console.log('gmstHours: ', gmstHours);

  const { sunriseCoords, sunsetCoords, sunrise, sunset } =
    useMemo(() => {
      return splitTerminatorSunriseSunset(
        currentTime,
        raHours,
        gmstHours
      );
    }, [currentTime, raHours, gmstHours]);

  const terminatorRingLineLayer = makeTerminatorLayers({
    sunrise,
    sunset,
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
        layers: terminatorRingLineLayer,
      });
      map.addControl(overlayRef.current);
    } else {
      overlayRef.current.setProps({
        layers: terminatorRingLineLayer,
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
  }, [map, mapLoaded, attachToMap, terminatorRingLineLayer]);

  return {
    currentTime,
    subsolarLocation,
    sunriseCoords,
    sunsetCoords,
    sunrise,
    sunset,
    terminatorRingLineLayer,
  };
}
