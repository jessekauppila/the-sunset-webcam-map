import { useEffect, useRef } from 'react';
import type { Location } from '../../../lib/types';

export function useFlyTo(
  map: mapboxgl.Map | null,
  mapLoaded: boolean,
  location: Location | null,
  isPaused: boolean = false,
  mode?: string // Add mode to detect when switching between map/globe
) {
  const previousLocationRef = useRef<Location | null>(null);
  const previousModeRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    // Only run on client side
    if (typeof window === 'undefined') return;

    // If mode changed, reset previous location so it flies on mode switch
    if (mode !== undefined && mode !== previousModeRef.current) {
      console.log('🔄 Mode changed, resetting fly-to tracking');
      previousLocationRef.current = null;
      previousModeRef.current = mode;
    }

    console.log('🔍 useFlyTo effect running:', {
      hasMap: !!map,
      mapLoaded,
      hasLocation: !!location,
      isPaused,
      mode,
    });

    if (!map || !mapLoaded || !location) {
      return;
    }

    // Don't fly if paused
    if (isPaused) {
      console.log(
        '🚫 Skipping fly to - paused due to user interaction'
      );
      return;
    }

    // Check if location actually changed OR if mode changed
    const prevLocation = previousLocationRef.current;
    const shouldFly =
      !prevLocation ||
      prevLocation.lat !== location.lat ||
      prevLocation.lng !== location.lng ||
      (mode !== undefined && mode !== previousModeRef.current);

    if (!shouldFly) {
      return; // Location hasn't changed and mode hasn't changed
    }

    console.log('🎯 Flying to location:', location);
    previousLocationRef.current = location;

    // Smoothly fly to sunset location
    map.flyTo({
      center: [location.lng, location.lat],
      zoom: 2,
      duration: 2000,
      easing: (t) => t * (2 - t),
    });
  }, [map, mapLoaded, location, isPaused, mode]); // Add mode to dependencies
}
