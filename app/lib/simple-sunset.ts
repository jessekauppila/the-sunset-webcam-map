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
