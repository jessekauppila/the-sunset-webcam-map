import { useEffect, useMemo, useRef, useState } from 'react';
import type { WindyWebcam } from '../../../lib/types';
import { windyWebcamToLocation } from '../../../lib/types';

type Direction = 'asc' | 'desc';

type CycleConfig = {
  getValue?: (webcam: WindyWebcam) => number | string;
  direction?: Direction;
  intervalMs?: number;
  wrap?: boolean;
  autoStart?: boolean;
  comparator?: (a: WindyWebcam, b: WindyWebcam) => number;
  startIndex?: number;
};

function defaultComparator(
  getValue: (webcam: WindyWebcam) => number | string,
  direction: Direction
) {
  return (a: WindyWebcam, b: WindyWebcam) => {
    const va = getValue(a);
    const vb = getValue(b);

    const isNumber = typeof va === 'number' && typeof vb === 'number';

    let cmp = 0;
    if (isNumber) {
      cmp = (va as number) - (vb as number);
    } else {
      const sa = String(va);
      const sb = String(vb);
      cmp = sa < sb ? -1 : sa > sb ? 1 : 0;
    }

    if (cmp === 0) {
      // Stable tie-breaker by webcamId
      cmp = a.webcamId - b.webcamId;
    }

    return direction === 'asc' ? cmp : -cmp;
  };
}

export function useCyclingWebcams(
  webcams: WindyWebcam[],
  config: CycleConfig = {}
) {
  const {
    getValue = (w: WindyWebcam) => w.location.latitude,
    direction = 'asc',
    intervalMs = 5000,
    wrap = true,
    autoStart = true,
    comparator,
    startIndex = 0,
  } = config;

  const cmp = useMemo(
    () => comparator ?? defaultComparator(getValue, direction),
    [comparator, getValue, direction]
  );

  const sortedWebcams = useMemo(() => {
    const arr = [...webcams];
    arr.sort(cmp);
    return arr;
  }, [webcams, cmp]);

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
