import { useEffect, useMemo, useRef, useState } from 'react';
import type { WindyWebcam } from '../../../lib/types';
import { windyWebcamToLocation } from '../../../lib/types';

type CycleConfig = {
  intervalMs?: number;
  wrap?: boolean;
  autoStart?: boolean;
  startIndex?: number;
};

// Terminator-specific sorting: sunrise first, then sunset, both by rank
function terminatorComparator(a: WindyWebcam, b: WindyWebcam) {
  // First sort by phase: sunrise comes before sunset
  const phaseOrder = { sunrise: 0, sunset: 1 };
  const aPhase = a.phase || 'sunset';
  const bPhase = b.phase || 'sunset';

  if (aPhase !== bPhase) {
    return phaseOrder[aPhase] - phaseOrder[bPhase];
  }

  // Then sort by rank within the same phase
  const aRank = a.rank ?? 0;
  const bRank = b.rank ?? 0;

  if (aRank !== bRank) {
    return aRank - bRank;
  }

  // Stable tie-breaker by webcamId
  return a.webcamId - b.webcamId;
}

export function useCyclingWebcams(
  webcams: WindyWebcam[],
  config: CycleConfig = {}
) {
  const {
    intervalMs = 5000,
    wrap = true,
    autoStart = true,
    startIndex = 0,
  } = config;

  const sortedWebcams = useMemo(() => {
    const arr = [...webcams];
    arr.sort(terminatorComparator);
    return arr;
  }, [webcams]);

  const [index, setIndex] = useState<number>(
    sortedWebcams.length
      ? Math.min(Math.max(startIndex, 0), sortedWebcams.length - 1)
      : -1
  );
  const [running, setRunning] = useState<boolean>(autoStart);

  // Keep selection stable on list changes when possible
  const currentIdRef = useRef<number | null>(null);
  useEffect(() => {
    if (index >= 0 && sortedWebcams[index]) {
      currentIdRef.current = sortedWebcams[index].webcamId;
    }
  }, [index, sortedWebcams]);

  useEffect(() => {
    if (sortedWebcams.length === 0) {
      setIndex(-1);
      return;
    }

    const currentId = currentIdRef.current;
    if (currentId != null) {
      const foundIndex = sortedWebcams.findIndex(
        (w) => w.webcamId === currentId
      );
      if (foundIndex !== -1) {
        setIndex(foundIndex);
        return;
      }
    }

    // If current not found (or was null), reset to start of sorted list
    setIndex(0);
  }, [sortedWebcams]);

  // Auto-advance timer
  useEffect(() => {
    if (!running || sortedWebcams.length === 0) return;

    const timer = setInterval(() => {
      setIndex((prev) => {
        if (sortedWebcams.length === 0) return -1;
        if (prev < 0) return 0;
        if (prev < sortedWebcams.length - 1) return prev + 1;
        return wrap ? 0 : prev;
      });
    }, intervalMs);

    return () => clearInterval(timer);
  }, [running, sortedWebcams, intervalMs, wrap]);

  const next = () => {
    setIndex((prev) => {
      if (sortedWebcams.length === 0) return -1;
      if (prev < 0) return 0;
      if (prev < sortedWebcams.length - 1) return prev + 1;
      return wrap ? 0 : prev;
    });
  };

  const prev = () => {
    setIndex((prev) => {
      if (sortedWebcams.length === 0) return -1;
      if (prev < 0) return sortedWebcams.length - 1;
      if (prev > 0) return prev - 1;
      return wrap ? sortedWebcams.length - 1 : prev;
    });
  };

  const pause = () => setRunning(false);
  const resume = () => setRunning(true);

  const currentWebcam =
    index >= 0 && index < sortedWebcams.length
      ? sortedWebcams[index]
      : null;

  const currentWebcamLocation = windyWebcamToLocation(
    currentWebcam || undefined
  );
  return {
    currentWebcam,
    currentWebcamLocation,
    currentIndex: index,
    sortedWebcams,
    isRunning: running,
    next,
    prev,
    pause,
    resume,
  };
}
