/**
 * useUpdateTerminatorRing Hook
 *
 * This hook manages the visualization of the terminator line (day/night boundary) on a Mapbox map.
 * It uses native Mapbox layers (not deck.gl) for better 3D tilt/pitch support.
 *
 * What it does:
 * 1. Calculates the terminator line coordinates based on the current time
 * 2. Creates GeoJSON data for the terminator line, search radius circles, and terminator points
 * 3. Adds/updates native Mapbox sources and layers on the map
 * 4. Handles cleanup when the map is unmounted or disabled
 *
 * Features:
 * - Terminator line: Gray line showing the day/night boundary
 * - Search radius circles: Blue circles showing the search area around each terminator point
 * - Terminator points: Red dots marking the exact points used for API queries
 *
 * The visualization matches the precision and search radius used in the cron jobs
 * (see app/lib/masterConfig.ts for configuration values).
 *
 * Note: This uses native Mapbox layers instead of deck.gl for better 3D support.
 * The layers will properly transform with map tilt/pitch in 3D view.
 */

import { useEffect, useMemo, useRef } from 'react';
import { subsolarPoint } from '../lib/subsolarLocation';
import { createTerminatorVisualizationRing } from '../lib/terminatorRing';
import { createTerminatorRingHiRes } from '../lib/terminatorRingHiRes';
import { createSearchRadiusCircles } from '../lib/searchRadiusCircles';
import {
  TERMINATOR_RING_OFFSETS_DEG,
  TERMINATOR_SUN_ALTITUDE_DEG,
} from '@/app/lib/masterConfig';
import type { Location as TerminatorLocation } from '@/app/lib/types';

export function useUpdateTerminatorRing(
  map: mapboxgl.Map | null,
  mapLoaded: boolean,
  currentTime: Date,
  options?: {
    attachToMap?: boolean;
    showSearchRadius?: boolean;
    precisionDeg?: number; // Use same precision as cron job (default: 4°)
    searchRadiusDegrees?: number; // Search radius used in API calls (default: 5°)
  }
) {
  const sourcesAddedRef = useRef<Set<string>>(new Set());
  const layersAddedRef = useRef<Set<string>>(new Set());
  const attachToMap = options?.attachToMap ?? true;
  const showSearchRadius = options?.showSearchRadius ?? false;
  const precisionDeg = options?.precisionDeg ?? 4; // Match cron job precision
  const searchRadiusDegrees = options?.searchRadiusDegrees ?? 5; // Match cron job search radius

  const { lat, lng, raHours, gmstHours } = useMemo(() => {
    return subsolarPoint(currentTime);
  }, [currentTime]);

  const subsolarLocation = useMemo(() => ({ lat, lng }), [lat, lng]);

  const { entireHiResTerminatorRing } = useMemo(() => {
    return createTerminatorRingHiRes(currentTime);
  }, [currentTime]);

  // Use the same precision as the cron job for accurate visualization
  const ringResults = useMemo(() => {
    return TERMINATOR_RING_OFFSETS_DEG.map((offsetDeg) =>
      createTerminatorVisualizationRing(
        currentTime,
        raHours,
        gmstHours,
        precisionDeg,
        TERMINATOR_SUN_ALTITUDE_DEG,
        offsetDeg
      )
    );
  }, [currentTime, raHours, gmstHours, precisionDeg]);

  const mainRing = ringResults[0];
  const offsetRing = ringResults[1];

  const {
    sunriseCoords,
    sunsetCoords,
    allTerminatorCoords,
    sunrise,
    sunset,
    entireTerminatorRing,
  } = mainRing;

  // Memoize the coordinate arrays to prevent unnecessary re-renders

  const memoizedSunriseCoords = useMemo(
    () => sunriseCoords,
    [sunriseCoords]
  );
  const memoizedSunsetCoords = useMemo(
    () => sunsetCoords,
    [sunsetCoords]
  );

  // Combine sunrise and sunset coords to get all terminator points used for API queries
  const allTerminatorPoints: TerminatorLocation[] = useMemo(() => {
    const allPoints = ringResults.flatMap((ring) => [
      ...ring.sunriseCoords,
      ...ring.sunsetCoords,
    ]);
    const byKey = new Map<string, TerminatorLocation>();
    for (const point of allPoints) {
      const key = `${point.lat.toFixed(6)},${point.lng.toFixed(6)}`;
      if (!byKey.has(key)) byKey.set(key, point);
    }
    return [...byKey.values()];
  }, [ringResults]);

  // Convert GeoJSON features to format for Mapbox
  const terminatorGeoJSON = useMemo(() => {
    if ('geometry' in entireHiResTerminatorRing) {
      return {
        type: 'FeatureCollection' as const,
        features: [entireHiResTerminatorRing],
      };
    }
    return entireHiResTerminatorRing;
  }, [entireHiResTerminatorRing]);

  const offsetTerminatorGeoJSON = useMemo(() => {
    if (!offsetRing) return null;
    return {
      type: 'FeatureCollection' as const,
      features: [offsetRing.entireTerminatorRing],
    };
  }, [offsetRing]);

  // Create search radius circles GeoJSON if enabled
  const searchRadiusGeoJSON = useMemo(() => {
    if (!showSearchRadius || allTerminatorPoints.length === 0 || !searchRadiusDegrees) {
      return null;
    }
    const circles = createSearchRadiusCircles(allTerminatorPoints, searchRadiusDegrees);
    return {
      type: 'FeatureCollection' as const,
      features: circles,
    };
  }, [showSearchRadius, allTerminatorPoints, searchRadiusDegrees]);

  // Create points GeoJSON if enabled
  const pointsGeoJSON = useMemo(() => {
    if (!showSearchRadius || allTerminatorPoints.length === 0) {
      return null;
    }
    return {
      type: 'FeatureCollection' as const,
      features: allTerminatorPoints.map((point, index) => ({
        type: 'Feature' as const,
        properties: { pointIndex: index },
        geometry: {
          type: 'Point' as const,
          coordinates: [point.lng, point.lat],
        },
      })),
    };
  }, [showSearchRadius, allTerminatorPoints]);

  // Use native Mapbox layers instead of deck.gl for better 3D support
  useEffect(() => {
    if (!map || !mapLoaded || !attachToMap) {
      // Clean up sources and layers
      if (map) {
        try {
          layersAddedRef.current.forEach((layerId) => {
            if (map.getLayer(layerId)) {
              map.removeLayer(layerId);
            }
          });
          sourcesAddedRef.current.forEach((sourceId) => {
            if (map.getSource(sourceId)) {
              map.removeSource(sourceId);
            }
          });
        } catch (e) {
          console.warn('Error cleaning up Mapbox layers:', e);
        }
      }
      sourcesAddedRef.current.clear();
      layersAddedRef.current.clear();
      return;
    }

    // Wait for style to be loaded
    if (!map.isStyleLoaded()) {
      return;
    }

    try {
      // Add main terminator line source and layer
      const terminatorSourceId = 'terminator-line-source';
      const terminatorLayerId = 'terminator-line-layer';

      if (!map.getSource(terminatorSourceId)) {
        map.addSource(terminatorSourceId, {
          type: 'geojson',
          data: terminatorGeoJSON,
        });
        sourcesAddedRef.current.add(terminatorSourceId);
      } else {
        (map.getSource(terminatorSourceId) as mapboxgl.GeoJSONSource).setData(terminatorGeoJSON);
      }

      if (!map.getLayer(terminatorLayerId)) {
        map.addLayer({
          id: terminatorLayerId,
          type: 'line',
          source: terminatorSourceId,
          paint: {
            'line-color': '#c8c8c8', // Light gray (RGB: 200, 200, 200)
            'line-width': 3,
            'line-opacity': 0.2, // 50/255 ≈ 0.2 opacity (matches terminatorRingLineLayer.ts)
          },
        });
        layersAddedRef.current.add(terminatorLayerId);
      } else {
        // Update existing layer opacity when data changes
        map.setPaintProperty(terminatorLayerId, 'line-opacity', 0.2);
      }

      // Add offset terminator line if configured
      if (offsetTerminatorGeoJSON) {
        const offsetSourceId = 'terminator-line-offset-source';
        const offsetLayerId = 'terminator-line-offset-layer';

        if (!map.getSource(offsetSourceId)) {
          map.addSource(offsetSourceId, {
            type: 'geojson',
            data: offsetTerminatorGeoJSON,
          });
          sourcesAddedRef.current.add(offsetSourceId);
        } else {
          (map.getSource(offsetSourceId) as mapboxgl.GeoJSONSource).setData(
            offsetTerminatorGeoJSON
          );
        }

        if (!map.getLayer(offsetLayerId)) {
          map.addLayer({
            id: offsetLayerId,
            type: 'line',
            source: offsetSourceId,
            paint: {
              'line-color': '#96a6c8', // Slightly bluish gray for offset ring
              'line-width': 2,
              'line-opacity': 0.2,
            },
          });
          layersAddedRef.current.add(offsetLayerId);
        } else {
          map.setPaintProperty(offsetLayerId, 'line-opacity', 0.2);
        }
      }

      // Add search radius circles if enabled
      if (searchRadiusGeoJSON) {
        const circlesSourceId = 'search-radius-circles-source';
        const circlesLayerId = 'search-radius-circles-layer';

        if (!map.getSource(circlesSourceId)) {
          map.addSource(circlesSourceId, {
            type: 'geojson',
            data: searchRadiusGeoJSON,
          });
          sourcesAddedRef.current.add(circlesSourceId);
        } else {
          (map.getSource(circlesSourceId) as mapboxgl.GeoJSONSource).setData(searchRadiusGeoJSON);
        }

        if (!map.getLayer(circlesLayerId)) {
          map.addLayer({
            id: circlesLayerId,
            type: 'fill',
            source: circlesSourceId,
            paint: {
              'fill-color': '#6496ff', // RGB: 100, 150, 255
              'fill-opacity': 0.08, // 20/255 ≈ 0.08 opacity (matches terminatorRingLineLayer.ts)
            },
          });
          layersAddedRef.current.add(circlesLayerId);
        } else {
          // Update existing layer opacity
          map.setPaintProperty(circlesLayerId, 'fill-opacity', 0.08);
        }

        // Add outline for circles
        const circlesOutlineLayerId = 'search-radius-circles-outline-layer';
        if (!map.getLayer(circlesOutlineLayerId)) {
          map.addLayer({
            id: circlesOutlineLayerId,
            type: 'line',
            source: circlesSourceId,
            paint: {
              'line-color': '#6496ff', // RGB: 100, 150, 255
              'line-width': 2,
              'line-opacity': 0.2, // 50/255 ≈ 0.2 opacity (matches terminatorRingLineLayer.ts)
            },
          });
          layersAddedRef.current.add(circlesOutlineLayerId);
        } else {
          // Update existing layer opacity
          map.setPaintProperty(circlesOutlineLayerId, 'line-opacity', 0.2);
        }
      }

      // Add points if enabled
      if (pointsGeoJSON) {
        const pointsSourceId = 'terminator-points-source';
        const pointsLayerId = 'terminator-points-layer';

        if (!map.getSource(pointsSourceId)) {
          map.addSource(pointsSourceId, {
            type: 'geojson',
            data: pointsGeoJSON,
          });
          sourcesAddedRef.current.add(pointsSourceId);
        } else {
          (map.getSource(pointsSourceId) as mapboxgl.GeoJSONSource).setData(pointsGeoJSON);
        }

        if (!map.getLayer(pointsLayerId)) {
          map.addLayer({
            id: pointsLayerId,
            type: 'circle',
            source: pointsSourceId,
            paint: {
              'circle-radius': 4,
              'circle-color': '#ff0000',
              'circle-opacity': 1,
            },
          });
          layersAddedRef.current.add(pointsLayerId);
        }
      }

      console.log('✅ Native Mapbox layers added/updated');
    } catch (error) {
      console.error('❌ Error adding Mapbox layers:', error);
    }

    // Store refs in local variables for cleanup
    const layersToRemove = new Set(layersAddedRef.current);
    const sourcesToRemove = new Set(sourcesAddedRef.current);

    return () => {
      if (map) {
        try {
          layersToRemove.forEach((layerId) => {
            if (map.getLayer(layerId)) {
              map.removeLayer(layerId);
            }
          });
          sourcesToRemove.forEach((sourceId) => {
            if (map.getSource(sourceId)) {
              map.removeSource(sourceId);
            }
          });
        } catch (e) {
          console.warn('Error cleaning up Mapbox layers:', e);
        }
        // Note: We don't clear the refs here as they're managed by the effect
        // The refs will be cleared when the effect runs again
      }
    };
  }, [
    map,
    mapLoaded,
    attachToMap,
    terminatorGeoJSON,
    offsetTerminatorGeoJSON,
    searchRadiusGeoJSON,
    pointsGeoJSON,
    showSearchRadius,
  ]);

  return {
    subsolarLocation,
    sunriseCoords: memoizedSunriseCoords,
    sunsetCoords: memoizedSunsetCoords,
    allTerminatorCoords,
    sunrise,
    sunset,
    entireTerminatorRing,
    entireHiResTerminatorRing,
  };
}
