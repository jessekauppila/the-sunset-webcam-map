import { model } from 'geomagnetism';

/** Magnetic declination (degrees, east-positive) for a location at the current WMM epoch. */
export function declinationDeg(lat: number, lng: number): number {
  return model().point([lat, lng]).decl;
}
