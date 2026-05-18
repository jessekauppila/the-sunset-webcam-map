'use client';

import { useEffect, useState } from 'react';

export type GeoResult = {
  lat: number;
  lng: number;
  elevationM: number | null;
};

// Wrapper around navigator.geolocation. Resolves once with a high-accuracy
// fix, then idles. The wizard calls this when the operator advances past
// the initial confirm screen so the permission prompt arrives in context.
export function useGeolocation(enabled: boolean): {
  result: GeoResult | null;
  error: string | null;
  pending: boolean;
} {
  const [result, setResult] = useState<GeoResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!enabled || result !== null) return;
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setError('Geolocation not supported on this device.');
      return;
    }
    setPending(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setResult({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          elevationM:
            typeof pos.coords.altitude === 'number' ? pos.coords.altitude : null,
        });
        setPending(false);
        setError(null);
      },
      (err) => {
        setError(err.message || 'Could not get location.');
        setPending(false);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60_000 }
    );
  }, [enabled, result]);

  return { result, error, pending };
}
