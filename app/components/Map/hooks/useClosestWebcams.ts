import { useMemo } from 'react';
import type { WindyWebcam, Location } from '@/app/lib/types';
import { windyWebcamToLocation } from '@/app/lib/types';

function calculateDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371; // Earth's radius in kilometers
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // Distance in kilometers
}

export function useClosestWebcams(
  userLocation: Location,
  webcams: WindyWebcam[]
  // map: mapboxgl.Map | null,
  // mapLoaded: boolean
) {
  return useMemo(() => {
    // Add distance to each webcam and sort by distance
    const webcamsWithDistance = webcams
      .map((webcam) => ({
        ...webcam,
        distanceFromUser: calculateDistance(
          userLocation.lat,
          userLocation.lng,
          webcam.location.latitude,
          webcam.location.longitude
        ),
      }))
      .sort((a, b) => a.distanceFromUser - b.distanceFromUser);

    const closestWebcam = webcamsWithDistance[0];

    const closestLocation = windyWebcamToLocation(closestWebcam);

    return {
      closestWebcam,
      webcamsWithDistance,
      closestLocation,
    };
  }, [userLocation, webcams]);
}
