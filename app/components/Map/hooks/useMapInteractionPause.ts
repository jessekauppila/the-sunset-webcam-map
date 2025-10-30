import { useEffect, useState } from 'react';
//import mapboxgl  from 'mapbox-gl';

interface UseMapInteractionPauseProps {
  map: mapboxgl.Map | null;
  mapReady: boolean;
}

export function useMapInteractionPause({
  map,
  mapReady,
}: UseMapInteractionPauseProps) {
  const [hasInteracted, setHasInteracted] = useState(false);

  useEffect(() => {
    if (!map || !mapReady) return;

    // List of events that indicate user interaction
    const interactionEvents = [
      'mousedown',
      'touchstart',
      'wheel',
      'zoomstart',
      'rotatestart',
      'pitchstart',
    ];

    const handleInteraction = () => {
      console.log('🗺️ Map interaction detected - pausing auto-fly');
      setHasInteracted(true);
    };

    // Add event listeners for all interaction events
    interactionEvents.forEach((event) => {
      map.on(event, handleInteraction);
    });

    // Cleanup function
    return () => {
      interactionEvents.forEach((event) => {
        map.off(event, handleInteraction);
      });
    };
  }, [map, mapReady]);

  return {
    isPaused: hasInteracted,
  };
}
