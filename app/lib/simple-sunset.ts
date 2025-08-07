// simple-sunset.ts - SIMPLIFIED VERSION
import SunCalc from 'suncalc';
import type { Location } from './types';

/**
 * The ONLY function you really need!
 * Check if a location is experiencing sunset right now
 */
export function isLocationAtSunset(
  location: Location,
  date: Date = new Date()
): boolean {
  const sunPos = SunCalc.getPosition(
    date,
    location.lat,
    location.lng
  );

  // Sunset is when sun altitude is between -6° and +1° (civil twilight)
  const altitude = sunPos.altitude;
  return altitude >= -0.1047 && altitude <= 0.0175; // -6° to 1° in radians
}

/**
 * Filter webcams to only those experiencing sunset
 * This is what you'll use with your webcam list!
 */
export function getWebcamsAtSunset<T extends Location>(
  webcams: T[],
  date: Date = new Date()
): T[] {
  return webcams.filter((webcam) => isLocationAtSunset(webcam, date));
}

/**
 * Find the nearest sunset location directly west of user's position
 * This is the most intuitive way people think about sunsets!
 */
export function findNearestSunsetWest(
  userLocation: Location,
  date: Date = new Date()
): Location | null {
  const { lat } = userLocation;

  // Check every degree of longitude going west from user
  for (let lngOffset = 0; lngOffset <= 180; lngOffset += 1) {
    const sunsetLng = userLocation.lng - lngOffset;

    // Wrap around the globe if necessary
    const normalizedLng =
      sunsetLng < -180 ? sunsetLng + 360 : sunsetLng;

    const checkLocation = { lat, lng: normalizedLng };

    if (isLocationAtSunset(checkLocation, date)) {
      return checkLocation;
    }
  }

  return null; // No sunset found (shouldn't happen in practice)
}
