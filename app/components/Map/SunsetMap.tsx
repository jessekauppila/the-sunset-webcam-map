'use client';

import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import { useSunsetPosition } from '../../hooks/useSunsetPosition';
import { useWebcams } from '../../hooks/useWebcams';
import type { SunsetMapProps } from '../../lib/types';
import 'mapbox-gl/dist/mapbox-gl.css';

// Set your Mapbox access token here
// In production, this should come from environment variables
mapboxgl.accessToken =
  process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN || '';

/**
 * Main map component that displays the sunset terminator and webcam locations
 */
export default function SunsetMap({
  className = '',
  userLocation,
  onWebcamHover,
  onWebcamClick,
}: SunsetMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);

  // Get sunset and webcam data
  const {
    sunsetData,
    isLoading: sunsetLoading,
    error: sunsetError,
  } = useSunsetPosition(userLocation);
  const { webcams, isLoading: webcamsLoading } = useWebcams(
    userLocation,
    {
      onlySunset: true,
      radiusKm: 1000,
    }
  );

  // Initialize map
  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/satellite-v9',
      center: userLocation
        ? [userLocation.lng, userLocation.lat]
        : [0, 0],
      zoom: userLocation ? 8 : 2,
      projection: 'globe' as any,
    });

    map.current.on('load', () => {
      setMapLoaded(true);
    });

    return () => {
      if (map.current) {
        map.current.remove();
        map.current = null;
      }
    };
  }, [userLocation]);

  // Add sunset terminator line
  useEffect(() => {
    if (!map.current || !mapLoaded || !sunsetData) return;

    // Remove existing sunset layer if it exists
    if (map.current.getLayer('sunset-terminator')) {
      map.current.removeLayer('sunset-terminator');
    }
    if (map.current.getSource('sunset-terminator')) {
      map.current.removeSource('sunset-terminator');
    }

    // Add sunset terminator as a line
    const terminatorCoordinates = sunsetData.terminator.map(
      (point) => [point.lng, point.lat]
    );

    map.current.addSource('sunset-terminator', {
      type: 'geojson',
      data: {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: terminatorCoordinates,
        },
      },
    });

    map.current.addLayer({
      id: 'sunset-terminator',
      type: 'line',
      source: 'sunset-terminator',
      layout: {
        'line-join': 'round',
        'line-cap': 'round',
      },
      paint: {
        'line-color': '#ff6b35',
        'line-width': 3,
        'line-opacity': 0.8,
      },
    });
  }, [mapLoaded, sunsetData]);

  // Add webcam markers
  useEffect(() => {
    if (!map.current || !mapLoaded || !webcams.length) return;

    // Remove existing webcam markers
    webcams.forEach((_, index) => {
      const markerId = `webcam-${index}`;
      if (map.current!.getLayer(markerId)) {
        map.current!.removeLayer(markerId);
      }
      if (map.current!.getSource(markerId)) {
        map.current!.removeSource(markerId);
      }
    });

    // Add webcam markers
    webcams.forEach((webcam, index) => {
      const markerId = `webcam-${index}`;

      map.current!.addSource(markerId, {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {
            id: webcam.id,
            name: webcam.name,
          },
          geometry: {
            type: 'Point',
            coordinates: [webcam.lng, webcam.lat],
          },
        },
      });

      map.current!.addLayer({
        id: markerId,
        type: 'circle',
        source: markerId,
        paint: {
          'circle-radius': 8,
          'circle-color': '#ff6b35',
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
        },
      });

      // Add click handlers
      if (onWebcamClick) {
        map.current!.on('click', markerId, () => {
          onWebcamClick(webcam);
        });
      }

      // Add hover handlers
      if (onWebcamHover) {
        map.current!.on('mouseenter', markerId, () => {
          map.current!.getCanvas().style.cursor = 'pointer';
          onWebcamHover(webcam);
        });

        map.current!.on('mouseleave', markerId, () => {
          map.current!.getCanvas().style.cursor = '';
          onWebcamHover(null);
        });
      }
    });
  }, [mapLoaded, webcams, onWebcamClick, onWebcamHover]);

  if (sunsetError) {
    return (
      <div
        className={`flex items-center justify-center h-full ${className}`}
        data-testid="sunset-map"
      >
        <div className="text-center">
          <h3 className="text-lg font-medium text-red-600 mb-2">
            Error loading sunset data
          </h3>
          <p className="text-gray-500">{sunsetError}</p>
        </div>
      </div>
    );
  }

  if (sunsetLoading) {
    return (
      <div
        className={`flex items-center justify-center h-full ${className}`}
        data-testid="sunset-map"
      >
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading sunset data...</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`relative h-full ${className}`}
      data-testid="sunset-map"
    >
      <div ref={mapContainer} className="h-full w-full" />

      {/* Loading overlay for webcams */}
      {webcamsLoading && (
        <div className="absolute top-4 right-4 bg-white bg-opacity-90 rounded-lg p-3 shadow-lg">
          <div className="flex items-center space-x-2">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-orange-500"></div>
            <span className="text-sm text-gray-600">
              Loading webcams...
            </span>
          </div>
        </div>
      )}

      {/* Webcam count indicator */}
      {!webcamsLoading && webcams.length > 0 && (
        <div className="absolute top-4 left-4 bg-white bg-opacity-90 rounded-lg p-3 shadow-lg">
          <span className="text-sm font-medium text-gray-700">
            {webcams.length} webcam{webcams.length !== 1 ? 's' : ''}{' '}
            showing sunset
          </span>
        </div>
      )}
    </div>
  );
}
