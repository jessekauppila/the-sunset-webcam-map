import { useEffect, useState, useMemo } from 'react';
import { subsolarPoint } from '../lib/subsolarLocation';
import { splitTerminatorSunriseSunset } from '../lib/terminatorRing';
import { makeTerminatorLayers } from '../lib/terminatorRingLineLayer';
import { MapboxOverlay } from '@deck.gl/mapbox';

export function useUpdateTimeAndTerminatorRing(
  map: mapboxgl.Map | null,
  mapLoaded: boolean
) {
  const [currentTime, setCurrentTime] = useState(new Date());

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
    if (!map || !mapLoaded) return;

    const deckGLOverlay = new MapboxOverlay({
      layers: terminatorRingLineLayer,
    });

    map.addControl(deckGLOverlay);

    return () => {
      map.removeControl(deckGLOverlay);
    };
  }, [map, mapLoaded, terminatorRingLineLayer]); // Add terminatorRingLineLayer as dependency

  return {
    subsolarLocation,
    sunriseCoords,
    sunsetCoords,
    sunrise,
    sunset,
    terminatorRingLineLayer,
  };
}
