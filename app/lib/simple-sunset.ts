import SunCalc from 'suncalc';
import type { Location } from './types';

/**
 * Simple sunset calculator for your project
 * Let's start basic and build up!
 */

export interface SimpleSunsetData {
  sunsetLine: Location[]; // Points where sunset is happening
  timestamp: Date;
}

/**
 * Get a simple sunset line - just a few points for now
 */
export function getSimpleSunsetLine(
  date: Date = new Date()
): SimpleSunsetData {
  const sunsetPoints: Location[] = [];

  // Instead of checking the whole globe, let's just check a line
  // We'll sample every 10 degrees of longitude at latitude 0 (equator)
  for (let lng = -180; lng <= 180; lng += 10) {
    const position = SunCalc.getPosition(date, 0, lng);

    // If sun is near horizon (sunset), add this point
    if (Math.abs(position.altitude) < 0.1) {
      sunsetPoints.push({ lat: 0, lng });
    }
  }

  return {
    sunsetLine: sunsetPoints,
    timestamp: date,
  };
}

/**
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
  return altitude >= -0.1 && altitude <= 0.02; // Roughly sunset time
}

/**
 * Get sun position for a specific location
 */
export function getSunPositionAtLocation(
  location: Location,
  date: Date = new Date()
) {
  const position = SunCalc.getPosition(
    date,
    location.lat,
    location.lng
  );

  return {
    azimuth: position.azimuth, // Direction of sun (radians)
    altitude: position.altitude, // Height of sun above horizon (radians)
    isDay: position.altitude > 0,
    isSunset: isLocationAtSunset(location, date),
  };
}
