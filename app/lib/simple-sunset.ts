// simple-sunset.ts - SIMPLIFIED VERSION
import SunCalc from 'suncalc';
import type { Location } from './types';

// Ok this goes west until it finds a sunset west, but what
//  if I wanted to find the whole band of where sunsets are
// on the globe. I guess I could basically go west on the
// longitude and then have a newst for loop saying to go up
// and down on the latitude and see if that was it... The
// trick is that I'd basically want all areas around the globe
//  where this is happening so there'd basically be a crescent
// across the globe showing where all the sunsets are occuring.
//  We'd also want to use altitude to create basically an inside
//  and outside of this crescent so it's 2d rather than a one
//  dimensional curve.  Does this all make sense?

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
      // console.log(`🌅 Found sunset at: ${lat}, ${normalizedLng}`);
      return checkLocation;
    }
  }

  console.log('❌ No sunset found in 180° west search');
  return null;
}
