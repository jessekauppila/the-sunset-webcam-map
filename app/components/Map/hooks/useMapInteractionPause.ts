import { useEffect, useState, RefObject } from 'react';

interface UseMapInteractionPauseProps {
  containerRef: RefObject<HTMLDivElement | null>;
  mode?: string; // Add mode to detect mode changes
}

export function useMapInteractionPause({
  containerRef,
  mode,
}: UseMapInteractionPauseProps) {
  const [hasInteracted, setHasInteracted] = useState(false);

  // Reset interaction state when mode changes
  useEffect(() => {
    if (mode !== undefined) {
      console.log(
        '🔄 Mode changed, resetting interaction pause state'
      );
      setHasInteracted(false);
    }
  }, [mode]);

  useEffect(() => {
    if (!containerRef?.current) return;

    const container = containerRef.current;

    const handleInteraction = () => {
      console.log('🗺️ Interaction detected - pausing auto-fly');
      setHasInteracted(true);
    };

    // List of DOM events that indicate user interaction
    const interactionEvents = [
      'mousedown',
      'touchstart',
      'wheel',
      'pointerdown',
    ];

    // Add event listeners for all interaction events
    interactionEvents.forEach((event) => {
      container.addEventListener(event, handleInteraction, {
        passive: true,
      });
    });

    // Cleanup function
    return () => {
      interactionEvents.forEach((event) => {
        container.removeEventListener(event, handleInteraction);
      });
    };
  }, [containerRef]);

  return {
    isPaused: hasInteracted,
  };
}
