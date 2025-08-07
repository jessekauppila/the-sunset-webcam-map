// useSunsetPosition.ts - SIMPLIFIED VERSION
import { useState, useEffect } from 'react';
import { getWebcamsAtSunset } from '../lib/simple-sunset';
import { getMockWebcams } from '../lib/webcam-api';

export function useSunsetWebcams() {
  const [sunsetWebcams, setSunsetWebcams] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const allWebcams = getMockWebcams();
    const webcamsAtSunset = getWebcamsAtSunset(allWebcams);
    setSunsetWebcams(webcamsAtSunset);
    setIsLoading(false);
  }, []);

  return { sunsetWebcams, isLoading };
}
