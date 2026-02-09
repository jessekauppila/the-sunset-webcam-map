/**
 * Webcam classification module
 * Classifies webcams into sunrise/sunset phases based on proximity to terminator coordinates
 */

import type { Location, WindyWebcam } from '@/app/lib/types';

/**
 * Classify webcams into sunrise and sunset phases based on their proximity
 * to terminator ring coordinates
 */
export function classifyWebcamsByPhase(
  webcams: WindyWebcam[],
  sunriseCoords: Location[],
  sunsetCoords: Location[]
): { sunrise: WindyWebcam[]; sunset: WindyWebcam[] } {
  const sunriseList: WindyWebcam[] = [];
  const sunsetList: WindyWebcam[] = [];

  for (const webcam of webcams) {
    if (!webcam.location) continue;

    // Calculate distance to nearest sunrise coord
    const sunriseDistances = sunriseCoords.map((coord) =>
      Math.sqrt(
        Math.pow(webcam.location.longitude - coord.lng, 2) +
          Math.pow(webcam.location.latitude - coord.lat, 2)
      )
    );
    const minSunriseDistance = Math.min(...sunriseDistances);

    // Calculate distance to nearest sunset coord
    const sunsetDistances = sunsetCoords.map((coord) =>
      Math.sqrt(
        Math.pow(webcam.location.longitude - coord.lng, 2) +
          Math.pow(webcam.location.latitude - coord.lat, 2)
      )
    );
    const minSunsetDistance = Math.min(...sunsetDistances);

    // Assign to the closer phase
    if (minSunriseDistance < minSunsetDistance) {
      sunriseList.push(webcam);
    } else {
      sunsetList.push(webcam);
    }
  }

  // Sort each list by latitude
  sunriseList.sort(
    (a, b) => b.location.latitude - a.location.latitude // North to South
  );
  sunsetList.sort(
    (a, b) => a.location.latitude - b.location.latitude // South to North
  );

  return { sunrise: sunriseList, sunset: sunsetList };
}

