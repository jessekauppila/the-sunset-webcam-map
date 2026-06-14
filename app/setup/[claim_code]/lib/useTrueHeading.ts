'use client';

import { useEffect, useState } from 'react';
import { useDeviceOrientation, type Orientation } from './useDeviceOrientation';

// Magnetic heading from the phone (useDeviceOrientation) converted to true
// north using the server-side WMM declination endpoint. Declination is
// fetched once per location. Reconciliation spec step 4 + integration
// contract: "magnetic -> true via declination".
export function useTrueHeading({ lat, lng }: { lat: number | null; lng: number | null }): {
  orientation: Orientation | null;
  permissionState: ReturnType<typeof useDeviceOrientation>['permissionState'];
  requestPermission: () => Promise<void>;
  declinationDeg: number | null;
  trueHeading: number | null;
  error: string | null;
} {
  const { orientation, permissionState, requestPermission, error } = useDeviceOrientation();
  const [declinationDeg, setDeclinationDeg] = useState<number | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    if (lat == null || lng == null || declinationDeg != null) return;
    let cancelled = false;
    fetch(`/api/setup/declination?lat=${lat}&lng=${lng}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`declination ${r.status}`))))
      .then((d: { declinationDeg: number }) => {
        if (!cancelled) setDeclinationDeg(d.declinationDeg);
      })
      .catch((e) => {
        if (!cancelled) setFetchError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [lat, lng, declinationDeg]);

  const trueHeading =
    orientation != null && declinationDeg != null
      ? (orientation.azimuthDeg + declinationDeg + 360) % 360
      : null;

  return {
    orientation,
    permissionState,
    requestPermission,
    declinationDeg,
    trueHeading,
    error: error ?? fetchError,
  };
}
