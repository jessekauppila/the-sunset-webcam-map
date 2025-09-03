// simple-sunset.ts - SIMPLIFIED VERSION
import SunCalc from 'suncalc';
import type { Location } from './types';

/**
 * Check if a location is experiencing sunset right now
 * Used in the webcam list to filter webcams for one's experiencing sunset
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
 * Find the nearest sunset location directly west of user's position
 * This is the most intuitive way people think about sunsets!
 */
export function findNearestSunsetWest(
  userLocation: Location,
  date: Date = new Date()
): Location | null {
  const { lat } = userLocation;

  console.log(
    `🔍 Searching for sunset west of (${lat}, ${
      userLocation.lng
    }) at ${date.toISOString()}`
  );

  // Check every degree of longitude going west from user
  for (let lngOffset = 0; lngOffset <= 180; lngOffset += 1) {
    const sunsetLng = userLocation.lng - lngOffset;

    // Wrap around the globe if necessary
    const normalizedLng =
      sunsetLng < -180 ? sunsetLng + 360 : sunsetLng;

    const checkLocation = { lat, lng: normalizedLng };

    if (isLocationAtSunset(checkLocation, date)) {
      console.log(`🌅 Found sunset at: ${lat}, ${normalizedLng}`);
      return checkLocation;
    }
  }

  console.log('❌ No sunset found in 180° west search');
  return null;
}
