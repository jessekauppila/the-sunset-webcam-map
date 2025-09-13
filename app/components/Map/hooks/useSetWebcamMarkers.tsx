// Add a marker at sunset location
//import type { Location } from '../../../lib/types';
import { useEffect, useRef } from 'react';
import type { WindyWebcam } from '../../../lib/types';
import { createWebcamPopupContent } from '../lib/webcamPopup';

type MarkerInstance = {
  remove: () => void;
  getElement: () => HTMLElement;
};

export function useSetWebcamMarkers(
  map: mapboxgl.Map | null, // Use any to avoid SSR issues with mapboxgl types
  mapLoaded: boolean,
  webcams: WindyWebcam[]
) {
  const markersRef = useRef<Map<number, MarkerInstance>>(new Map());
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  //const firstBatchAppliedRef = useRef(false);
  const INITIAL_IMMEDIATE_BATCHES = 17; // or pass this in from caller later
  const immediateBatchesLeftRef = useRef(INITIAL_IMMEDIATE_BATCHES);

  useEffect(() => {
    // Only run on client side
    if (typeof window === 'undefined') return;

    console.log('🔍 useSetWebcamMarkers effect running:', {
      hasMap: !!map,
      mapLoaded,
      webcamsCount: webcams.length,
      mapType: typeof map,
      mapConstructor: map?.constructor?.name,
    });

    if (!map || !mapLoaded) {
      console.log(
        '⚠️ Skipping webcam markers - missing requirements:',
        {
          hasMap: !!map,
          mapLoaded,
        }
      );
      return;
    }

    // Dynamic import to avoid SSR issues
    import('mapbox-gl').then((mapboxgl) => {
      // Clear any existing timeout
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      const updateMarkers = () => {
        const existing = markersRef.current;
        const incomingIds = new Set(webcams.map((w) => w.webcamId));

        let added = 0;
        let removed = 0;

        // Only add markers for webcams that don't exist yet
        webcams.forEach((webcam, index) => {
          if (existing.has(webcam.webcamId)) {
            // Marker already exists, skip (no blinking!)
            return;
          }

          // Create new marker
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

          // Create POPUP with dark gray styling
          const popup = new mapboxgl.default.Popup({
            offset: 25,
            className: 'custom-popup',
          }).setHTML(createWebcamPopupContent(webcam));

          const marker = new mapboxgl.default.Marker(markerElement)
            .setLngLat([
              webcam.location.longitude,
              webcam.location.latitude,
            ])
            .setPopup(popup)
            .addTo(map);

          // Store in ref
          existing.set(webcam.webcamId, marker);

          // Fade in new marker
          setTimeout(() => {
            markerElement.style.opacity = '1';
          }, index * 30);
          added++;
        });

        // Remove markers that are no longer in the webcams list
        [...existing.keys()].forEach((webcamId) => {
          if (!incomingIds.has(webcamId)) {
            const marker = existing.get(webcamId)!;
            const element = marker.getElement();

            // Fade out
            element.style.opacity = '0';
            setTimeout(() => {
              marker.remove();
              existing.delete(webcamId);
            }, 300);
            removed++;
          }
        });

        console.log(
          '[markers] update applied: +',
          added,
          ' -',
          removed,
          ' total=',
          existing.size
        );
      };

      // immediate first non-empty batch
      if (webcams.length > 0 && immediateBatchesLeftRef.current > 0) {
        console.log(
          `[markers] immediate batch ${
            INITIAL_IMMEDIATE_BATCHES -
            immediateBatchesLeftRef.current +
            1
          }/${INITIAL_IMMEDIATE_BATCHES}:`,
          webcams.length
        );

        // Apply staggered fade-in for immediate batches too
        const existing = markersRef.current;

        webcams.forEach((webcam, index) => {
          if (existing.has(webcam.webcamId)) return;

          // Create marker (same as in updateMarkers)
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

          // Create popup with dark gray styling
          const popup = new mapboxgl.default.Popup({
            offset: 25,
            className: 'custom-popup',
          }).setHTML(createWebcamPopupContent(webcam));

          const marker = new mapboxgl.default.Marker(markerElement)
            .setLngLat([
              webcam.location.longitude,
              webcam.location.latitude,
            ])
            .setPopup(popup)
            .addTo(map);

          // Store in ref
          existing.set(webcam.webcamId, marker);

          // Staggered fade-in for initial load
          setTimeout(() => {
            markerElement.style.opacity = '1';
          }, index * 30);
        });

        immediateBatchesLeftRef.current -= 1;
      } else if (webcams.length > 0) {
        // debounced subsequent updates
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        timeoutRef.current = setTimeout(() => {
          console.log('[markers] debounced update:', webcams.length);
          updateMarkers();
        }, 800);
      }

      return () => {
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
        }
      };
    }); // Close the dynamic import
  }, [map, mapLoaded, webcams]);

  // Cleanup on unmount
  useEffect(() => {
    const markers = markersRef.current;
    const timeout = timeoutRef.current;

    return () => {
      markers.forEach((marker) => marker.remove());
      markers.clear();
      if (timeout) {
        clearTimeout(timeout);
      }
    };
  }, [map]);
}
