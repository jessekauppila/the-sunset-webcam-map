import { useEffect, useRef, useCallback } from 'react';
//import mapboxgl  from 'mapbox-gl';

interface UseMapInteractionPauseProps {
  map: mapboxgl.Map | null;
  mapReady: boolean;
  onPause: () => void;
  onResume: () => void;
  pauseDelayMs?: number;
  resumeDelayMs?: number;
}

export function useMapInteractionPause({
  map,
  mapReady,
  onPause,
  onResume,
  pauseDelayMs = 0, // Immediate pause when interaction starts
  resumeDelayMs = 10000, // Resume after 15 seconds
}: UseMapInteractionPauseProps) {
  const pauseTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const resumeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isPausedRef = useRef(false);

  // Clear all timeouts
  const clearAllTimeouts = useCallback(() => {
    if (pauseTimeoutRef.current) {
      clearTimeout(pauseTimeoutRef.current);
      pauseTimeoutRef.current = null;
    }
    if (resumeTimeoutRef.current) {
      clearTimeout(resumeTimeoutRef.current);
      resumeTimeoutRef.current = null;
    }
  }, []);

  // Handle map interaction start
  const handleInteractionStart = useCallback(() => {
    console.log(
      '🗺️ Map interaction started - pausing cycling webcams'
    );

    // Clear any existing timeouts
    clearAllTimeouts();

    // If not already paused, pause after the specified delay
    if (!isPausedRef.current) {
      pauseTimeoutRef.current = setTimeout(() => {
        onPause();
        isPausedRef.current = true;

        // Set resume timeout
        resumeTimeoutRef.current = setTimeout(() => {
          console.log(
            '🔄 Resuming cycling webcams after interaction'
          );
          onResume();
          isPausedRef.current = false;
        }, resumeDelayMs);
      }, pauseDelayMs);
    }
  }, [
    onPause,
    onResume,
    pauseDelayMs,
    resumeDelayMs,
    clearAllTimeouts,
  ]);

  // Set up map event listeners
  useEffect(() => {
    if (!map || !mapReady) return;

    // List of events that indicate user interaction
    const interactionEvents = [
      'mousedown',
      'touchstart',
      'wheel',
      //'movestart',
      'zoomstart',
      'rotatestart',
      'pitchstart',
    ];

    // Add event listeners for all interaction events
    interactionEvents.forEach((event) => {
      map.on(event, handleInteractionStart);
    });

    // Cleanup function
    return () => {
      clearAllTimeouts();
      interactionEvents.forEach((event) => {
        map.off(event, handleInteractionStart);
      });
    };
  }, [map, mapReady, handleInteractionStart, clearAllTimeouts]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearAllTimeouts();
    };
  }, [clearAllTimeouts]);

  return {
    isPaused: isPausedRef.current,
    clearTimeouts: clearAllTimeouts,
  };
}
