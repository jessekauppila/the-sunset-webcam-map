import { useEffect } from "react";
import { Location } from "@/app/lib/types";


export function useFlyTo(Location:)

useEffect(() => {
    if (!map.current || !mapLoaded || !sunsetLocation) {
      console.log('⚠️ Skipping map center - missing requirements:', {
        hasMap: !!map.current,
        mapLoaded,
        hasSunsetLocation: !!sunsetLocation,
      });
      return;
    }

    console.log('🎯 Centering map on sunset:', sunsetLocation);

    // Calculate distance for logging
    const distance = Math.abs(userLocation.lng - sunsetLocation.lng);
    console.log(`📏 Distance west: ${distance.toFixed(1)}°`);

    // Smoothly fly to sunset location
    map.current.flyTo({
      center: [sunsetLocation.lng, sunsetLocation.lat],
      zoom: 8,
      duration: 2000,
    });

    // Add a marker at sunset location
    const marker = new mapboxgl.Marker({ color: '#ff6b35' })
      .setLngLat([sunsetLocation.lng, sunsetLocation.lat])
      .setPopup(
        new mapboxgl.Popup().setHTML(
          `<div class="text-center">
            <div class="text-lg">🌅</div>
            <div><strong>Sunset Location</strong></div>
            <div class="text-sm">${sunsetLocation.lat.toFixed(
              4
            )}, ${sunsetLocation.lng.toFixed(4)}</div>
            <div class="text-xs">Distance: ${distance.toFixed(
              1
            )}° west</div>
          </div>`
        )
      )
      .addTo(map.current);

    console.log('📍 Added sunset marker');
  }, [sunsetLocation, mapLoaded, userLocation]);
