import { useMemo } from 'react';
import type { WindyWebcam, Location } from '../../../lib/types';
import { useWebcamFetchArray } from '../../hooks/useWebCamFetchArray';

export function useCombineSunriseSunsetWebcams(
  sunriseCoords: Location[],
  sunsetCoords: Location[]
) {
  const { webcams: sunriseWebcams, isLoading: sunriseLoading } =
    useWebcamFetchArray(sunriseCoords);
  const { webcams: sunsetWebcams, isLoading: sunsetLoading } =
    useWebcamFetchArray(sunsetCoords);

  const combinedWebcams = useMemo(() => {
    // Create a continuous flow: sunrise webcams first, then sunset webcams
    // Sort sunrise webcams by longitude (east to west - following the sun)
    const sortedSunriseWebcams = [...sunriseWebcams].sort(
      (a, b) => b.location.longitude - a.location.longitude
    );

    // Sort sunset webcams by longitude (west to east - following the sunset)
    const sortedSunsetWebcams = [...sunsetWebcams].sort(
      (a, b) => a.location.longitude - b.location.longitude
    );

    return [...sortedSunriseWebcams, ...sortedSunsetWebcams];
  }, [sunriseWebcams, sunsetWebcams]);

  return {
    combinedWebcams,
    sunriseWebcams,
    sunsetWebcams,
    isLoading: sunriseLoading || sunsetLoading,
    sunriseCount: sunriseWebcams.length,
    sunsetCount: sunsetWebcams.length,
    totalCount: combinedWebcams.length,
  };
}
