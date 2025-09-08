// Add a marker at sunset location
//import type { Location } from '../../../lib/types';
import mapboxgl from 'mapbox-gl';
import { useEffect } from 'react';
import type { WindyWebcam } from '../../../lib/types';

export function useSetWebcamMarkers(
  map: mapboxgl.Map | null,
  mapLoaded: boolean,
  //locations: Location[]
  webcams: WindyWebcam[]
) {
  useEffect(() => {
    if (!map || !mapLoaded || !webcams || webcams.length === 0) {
      console.log(
        '⚠️ Skipping marker setting - missing requirements:',
        {
          hasMap: !!map,
          mapLoaded,
          hasLocation: !!webcams,
        }
      );
      return;
    }

    console.log('📍 Setting markers:', webcams);
    const markers: mapboxgl.Marker[] = [];

    for (let i = 0; i < webcams.length; i++) {
      const webcam = webcams[i];
      try {
        // Create custom marker element with image
        const markerElement = document.createElement('div');
        markerElement.className = 'webcam-marker';
        markerElement.style.cssText = `
          width: 60px;
          height: 60px;
          border-radius: 50%;
          border: 1px solid #fff;
          box-shadow: 0 2px 8px rgba(0,0,0,0.3);
          overflow: hidden;
          cursor: pointer;
          background: #ff6b35;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 24px;
        `;

        // Add webcam image if available, otherwise use sunset emoji
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

        // Create popup content with proper interpolation
        const popupContent = `
          <div style="text-align: center; padding: 10px; max-width: 200px;">
            <div style="font-size: 18px; margin-bottom: 8px;">🌅</div>
            <div style="font-weight: bold; margin-bottom: 4px;">${
              webcam.title
            }</div>
            <div style="font-size: 12px; color: #666; margin-bottom: 4px;">
              📍 ${webcam.location?.city || 'Unknown'}, ${
          webcam.location?.region || ''
        } ${webcam.location?.country || 'Unknown'}
            </div>
            <div style="font-size: 11px; color: #888;">
              📊 Views: ${webcam.viewCount?.toLocaleString() || 'N/A'}
            </div>
            <div style="font-size: 11px; color: #888;">
              🎥 Status: ${webcam.status || 'Unknown'}
            </div>
          </div>
        `;

        const marker = new mapboxgl.Marker(markerElement)
          .setLngLat([
            webcam.location.longitude,
            webcam.location.latitude,
          ])
          .setPopup(
            new mapboxgl.Popup({ offset: 25 }).setHTML(popupContent)
          )
          .addTo(map);

        markers.push(marker);
        console.log('📍 Added webcam marker successfully');
      } catch (error) {
        console.error('❌ Error creating marker:', error);
      }
    }

    return () => {
      markers.forEach((marker) => marker.remove());
    };
  }, [map, mapLoaded, webcams]);
}

//const marker = new mapboxgl.Marker({ color: '#ff6b35' })

//     .setLngLat([location.lng, location.lat])
//     .setPopup(
//       new mapboxgl.Popup().setHTML(
//         `<div class="text-center">
//           <div class="text-lg">🌅</div>
//           <div><strong>Sunset Location</strong></div>

//         </div>`
//       )
//     )
//     .addTo(map);
