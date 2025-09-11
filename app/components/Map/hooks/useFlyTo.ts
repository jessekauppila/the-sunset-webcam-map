import { useEffect, useRef } from 'react';
import type { Location } from '../../../lib/types';

function haversineKm(a: Location, b: Location) {
  const R = 6371,
    toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat),
    dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat),
    lat2 = toRad(b.lat);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

export function useFlyTo(
  map: mapboxgl.Map | null,
  mapLoaded: boolean,
  location: Location | null,
  opts: { minKm?: number; cooldownMs?: number } = {}
) {
  const prev = useRef<Location | null>(null);
  const lastTs = useRef(0);
  const minKm = opts.minKm ?? 500;
  const cooldownMs = opts.cooldownMs ?? 10000;

  useEffect(() => {
    if (!map || !mapLoaded || !location) return;

    const now = Date.now();
    if (now - lastTs.current < cooldownMs) return;

    if (prev.current && haversineKm(prev.current, location) < minKm)
      return;

    prev.current = location;
    lastTs.current = now;

    map.flyTo({
      center: [location.lng, location.lat],
      zoom: 2,
      duration: 2000,
      easing: (t) => t * (2 - t),
    });
  }, [map, mapLoaded, location, minKm, cooldownMs]);
}
