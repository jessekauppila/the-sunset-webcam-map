import { useEffect, useRef, useCallback, useState } from 'react';
//import type { mapboxgl } from 'mapbox-gl';

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
  resumeDelayMs = 15000, // Resume after 15 seconds
}: UseMapInteractionPauseProps) {
  const pauseTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const resumeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [isPaused, setIsPaused] = useState(false);

  // Debug logging for props
  useEffect(() => {
    console.log('🔍 useMapInteractionPause props:', {
      hasMap: !!map,
      mapReady,
      pauseDelayMs,
      resumeDelayMs,
      mapMethods: map
        ? Object.getOwnPropertyNames(map).slice(0, 10)
        : 'no map',
    });
  }, [map, mapReady, pauseDelayMs, resumeDelayMs]);

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
  const handleInteractionStart = useCallback(
    (eventType: string) => {
      console.log(
        `🗺️ Map interaction detected: ${eventType} - pausing cycling webcams`
      );

      // Clear any existing timeouts
      clearAllTimeouts();

      // If not already paused, pause after the specified delay
      if (!isPaused) {
        pauseTimeoutRef.current = setTimeout(() => {
          console.log('⏸️ Pausing cycling webcams');
          onPause();
          setIsPaused(true);

          // Set resume timeout
          resumeTimeoutRef.current = setTimeout(() => {
            console.log(
              '🔄 Resuming cycling webcams after interaction'
            );
            onResume();
            setIsPaused(false);
          }, resumeDelayMs);
        }, pauseDelayMs);
      }
    },
    [
      onPause,
      onResume,
      pauseDelayMs,
      resumeDelayMs,
      clearAllTimeouts,
      isPaused,
    ]
  );

  // Set up map event listeners
  useEffect(() => {
    console.log('🔍 useEffect triggered for map listeners:', {
      hasMap: !!map,
      mapReady,
      mapType: map ? typeof map : 'null',
    });

    if (!map || !mapReady) {
      console.log('❌ Map not ready for interaction detection:', {
        map: !!map,
        mapReady,
      });
      return;
    }

    console.log('✅ Map is ready! Setting up interaction listeners');

    // Test if map has the 'on' method
    if (typeof map.on !== 'function') {
      console.error('🚨 Map object does not have .on method!', map);
      return;
    }

    console.log('✅ Map has .on method, proceeding with listeners');

    // List of events that indicate user interaction
    const interactionEvents = [
      'mousedown',
      'touchstart',
      'wheel',
      'movestart',
      'zoomstart',
      'rotatestart',
      'pitchstart',
    ];

    // Add event listeners for all interaction events
    interactionEvents.forEach((event) => {
      console.log(`📡 Adding listener for: ${event}`);
      try {
        map.on(event, (e) => {
          console.log(`🎪 Event fired: ${event}`, e);
          handleInteractionStart(event);
        });
        console.log(`✅ Successfully added listener for: ${event}`);
      } catch (error) {
        console.error(
          `❌ Failed to add listener for ${event}:`,
          error
        );
      }
    });

    // Test with a simple click listener
    console.log('🧪 Adding test click listener');
    try {
      map.on('click', (e) => {
        console.log('🖱️ Test click detected!', e);
      });
      console.log('✅ Test click listener added successfully');
    } catch (error) {
      console.error('❌ Failed to add test click listener:', error);
    }

    // Cleanup function
    return () => {
      console.log('🧹 Cleaning up map interaction listeners');
      clearAllTimeouts();
      interactionEvents.forEach((event) => {
        try {
          map.off(event, handleInteractionStart);
        } catch (error) {
          console.error(
            `❌ Failed to remove listener for ${event}:`,
            error
          );
        }
      });
      try {
        map.off('click');
      } catch (error) {
        console.error(
          '❌ Failed to remove test click listener:',
          error
        );
      }
    };
  }, [map, mapReady, handleInteractionStart, clearAllTimeouts]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearAllTimeouts();
    };
  }, [clearAllTimeouts]);

  return {
    isPaused,
    clearTimeouts: clearAllTimeouts,
  };
}
