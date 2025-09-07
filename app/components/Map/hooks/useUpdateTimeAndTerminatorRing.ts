import { useEffect, useState } from 'react';
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
    const interval = setInterval(() => {
      setCurrentTime(new Date());
    }, 60000);

    return () => clearInterval(interval);
  }, []);

  const { lat, lng, raHours, gmstHours } = subsolarPoint(currentTime);
  const subsolarLocation = { lat, lng };

  const { sunriseCoords, sunsetCoords, sunrise, sunset } =
    splitTerminatorSunriseSunset(currentTime, raHours, gmstHours);

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
