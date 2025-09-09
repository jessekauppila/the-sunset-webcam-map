// Add a marker at sunset location
//import type { Location } from '../../../lib/types';
import mapboxgl from 'mapbox-gl';
import { useEffect, useRef } from 'react';
import type { WindyWebcam } from '../../../lib/types';

export function useSetWebcamMarkers(
  map: mapboxgl.Map | null,
  mapLoaded: boolean,
  webcams: WindyWebcam[]
) {
  const webcamsRef = useRef<WindyWebcam[]>([]);
  const markersRef = useRef<mapboxgl.Marker[]>([]);

  // Update ref when webcams change
  useEffect(() => {
    webcamsRef.current = webcams;
  }, [webcams]);

  useEffect(() => {
    if (!map || !mapLoaded) return;

    // Clear existing markers
    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = [];

    const currentWebcams = webcamsRef.current;
    if (!currentWebcams || currentWebcams.length === 0) return;

    console.log('📍 Setting markers:', currentWebcams);

    for (let i = 0; i < currentWebcams.length; i++) {
      const webcam = currentWebcams[i];
      try {
        const markerElement = document.createElement('div');
        markerElement.className = 'webcam-marker';
        markerElement.style.cssText = `
          width: 60px;
          height: 60px;
          border-radius: 50%;
          border: 1px solid rgba(87, 87, 87, 0.64);
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0);
          overflow: hidden;
          cursor: pointer;
          background: rgba(0, 0, 0, 0);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 24px;
          transition: opacity 300ms ease;
          opacity: 0;
        `;

        // Add image or emoji
        if (webcam.images?.current?.preview) {
          const img = document.createElement('img');
          img.src = webcam.images.current.preview;
          img.style.cssText = `
            width: 100%;
            height: 100%;
            object-fit: cover;
          `;
          img.alt = webcam.title;
          markerElement.appendChild(img);
        } else {
          markerElement.textContent = '🌅';
        }

        // Create popup
        const popupContent = `
          <div style="position: relative; width: 200px; height: 150px; overflow: hidden; margin: 0; padding: 0;">
            ${
              webcam.images?.current?.preview
                ? `<img src="${webcam.images.current.preview}" alt="${webcam.title}" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; object-fit: cover;" />`
                : '<div style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: linear-gradient(135deg, #ff6b35, #f7931e); display: flex; align-items: center; justify-content: center; font-size: 48px;">🌅</div>'
            }
          </div>
        `;

        const popup = new mapboxgl.Popup({ offset: 25 }).setHTML(
          popupContent
        );

        const marker = new mapboxgl.Marker(markerElement)
          .setLngLat([
            webcam.location.longitude,
            webcam.location.latitude,
          ])
          .setPopup(popup)
          .addTo(map);

        markersRef.current.push(marker);

        // Fade in
        setTimeout(() => {
          markerElement.style.opacity = '1';
        }, i * 50); // Staggered fade-in
      } catch (error) {
        console.error('❌ Error creating marker:', error);
      }
    }
  }, [map, mapLoaded]); // Only depend on map and mapLoaded

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];
    };
  }, [map]);
}
