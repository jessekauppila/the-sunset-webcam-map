import { useEffect, useState } from 'react';
import { subsolarPoint } from '../lib/subsolarLocation';
import { splitTerminatorSunriseSunset } from '../lib/terminatorRing';
import { makeTerminatorLayers } from '../lib/terminatorRingLineLayer';

export function useUpdateTimeAndTerminatorRing() {
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    // 🎯 SETUP: What happens when the component mounts
    console.log('🚀 Setting up interval...');

    // ⏰ INTERVAL: Create a timer that runs every 60,000ms (1 minute)
    const interval = setInterval(() => {
      console.log('⏰ Interval fired! Updating time...');

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

  console.log('🔍 Subsolar location:', subsolarLocation);
  console.log('raHours: ', raHours);
  console.log('gmstHours: ', gmstHours);

  const { sunriseCoords, sunsetCoords, sunrise, sunset } =
    splitTerminatorSunriseSunset(currentTime, raHours, gmstHours);
  console.log('Sunrise coordinates', sunsetCoords);

  const terminatorRingLineLayer = makeTerminatorLayers({
    sunrise,
    sunset,
  });

  return {
    subsolarLocation,
    sunriseCoords,
    sunsetCoords,
    sunrise,
    sunset,
  };
}
