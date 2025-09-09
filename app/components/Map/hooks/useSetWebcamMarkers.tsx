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
          border: 1px solid rgba(87, 87, 87, 0.64);
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0);
          overflow: hidden;
          cursor: pointer;
          background:rgba(0, 0, 0, 0);
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
          <div style="position:  background:rgb(50, 50, 50); relative; width: 200px; height: 150px; overflow: hidden; margin: 0; padding: 0; border: none; outline: none; box-shadow: none;">
            ${
              webcam.images?.current?.preview
                ? `<img src="${webcam.images.current.preview}" alt="${webcam.title}" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; object-fit: cover; margin: 0; padding: 0; display: block; border: none; outline: none;" />`
                : '<div style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: linear-gradient(135deg,rgba(255, 255, 255, 0),rgba(0, 0, 0, 0)); display: flex; align-items: center; justify-content: center; font-size: 48px; margin: 0; padding: 0; border: none; outline: none;">🌅</div>'
            }
          </div>
        `;

        const popup = new mapboxgl.Popup({
          offset: 25,
          // closeButton: false,
          // closeOnClick: false,
        }).setHTML(popupContent);

        // Attempt to  Override popup styles to remove borders
        // popup.on('open', () => {
        //   const popupElement = popup.getElement();
        //   if (popupElement) {
        //     // Remove all borders, padding, margins
        //     popupElement.style.border = 'none !important';
        //     popupElement.style.outline = 'none !important';
        //     popupElement.style.boxShadow = 'none !important';
        //     popupElement.style.padding = '0 !important';
        //     popupElement.style.margin = '0 !important';
        //     popupElement.style.background = 'transparent !important';
        //     popupElement.style.borderRadius = '0 !important';

        //     // Target Mapbox's specific classes
        //     const mapboxPopup = popupElement.querySelector(
        //       '.mapboxgl-popup-content'
        //     ) as HTMLElement;
        //     if (mapboxPopup) {
        //       mapboxPopup.style.border = 'none !important';
        //       mapboxPopup.style.outline = 'none !important';
        //       mapboxPopup.style.boxShadow = 'none !important';
        //       mapboxPopup.style.padding = '0 !important';
        //       mapboxPopup.style.margin = '0 !important';
        //       mapboxPopup.style.background = 'transparent !important';
        //       mapboxPopup.style.borderRadius = '0 !important';
        //     }

        //     // Target the tip/arrow
        //     const mapboxTip = popupElement.querySelector(
        //       '.mapboxgl-popup-tip'
        //     ) as HTMLElement;
        //     if (mapboxTip) {
        //       mapboxTip.style.border = 'none !important';
        //       mapboxTip.style.outline = 'none !important';
        //       mapboxTip.style.background = 'transparent !important';
        //     }
        //   }
        // });

        const marker = new mapboxgl.Marker(markerElement)
          .setLngLat([
            webcam.location.longitude,
            webcam.location.latitude,
          ])
          .setPopup(popup)
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
