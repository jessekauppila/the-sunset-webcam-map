import { GeoJsonLayer } from '@deck.gl/layers';
import type { Location } from '../../../lib/types';
import { createSearchRadiusCircles } from './searchRadiusCircles';

type LineStringFC =
  | GeoJSON.Feature<GeoJSON.LineString>
  | GeoJSON.FeatureCollection;

export function makeTerminatorLayers(opts: {
  sunrise: LineStringFC;
  sunset: LineStringFC;
  entireTerminatorRing: LineStringFC;
  entireHiResTerminatorRing: LineStringFC;
  sunriseColor?: [number, number, number, number];
  sunsetColor?: [number, number, number, number];
  terminatorColor?: [number, number, number, number];
  lineWidth?: number;
  // New options for search radius visualization
  showSearchRadius?: boolean;
  searchRadiusDegrees?: number;
  terminatorPoints?: Location[]; // Points used for API queries
}) {
  const {
    sunrise,
    sunset,
    entireTerminatorRing,
    entireHiResTerminatorRing,
    // sunriseColor = [120, 170, 255, 200], // blue-ish
    // sunsetColor = [255, 170, 120, 200], // orange-ish
    terminatorColor = [200, 200, 200, 200], // light gray
    lineWidth = 3,
    showSearchRadius = false,
    searchRadiusDegrees, // Required when showSearchRadius is true - should match cron job SEARCH_RADIUS_DEG
    terminatorPoints = [],
  } = opts;

  const getCoordLength = (feature: LineStringFC) => {
    if ('geometry' in feature) {
      return feature.geometry?.coordinates?.length || 0;
    } else if ('features' in feature) {
      return feature.features?.length || 0;
    }
    return 0;
  };

  console.log('🎨 Making terminator layers with data:', {
    sunrise: getCoordLength(sunrise),
    sunset: getCoordLength(sunset),
    entireTerminatorRing: getCoordLength(entireTerminatorRing),
    entireHiResTerminatorRing: getCoordLength(
      entireHiResTerminatorRing
    ),
  });

  const layers: GeoJsonLayer[] = [
    new GeoJsonLayer({
      id: 'entire-terminator',
      data: entireHiResTerminatorRing,
      stroked: true,
      filled: false,
      lineWidthMinPixels: lineWidth,
      lineWidthMaxPixels: lineWidth * 2,
      getLineColor: terminatorColor,
      pickable: false,
      // Enable 3D rendering - layers will follow map tilt/pitch
      extruded: false, // Keep as 2D lines on the globe surface
      // Disable depth testing so layers always render on top (even when interleaved)
      // This allows 3D transformation while keeping visibility
      parameters: {
        depthTest: false, // Disable depth testing to ensure layers are always visible
        depthMask: false, // Don't write to depth buffer
      },
      updateTriggers: {
        getLineColor: [terminatorColor],
      },
    }),
  ];

  // Add search radius circles if enabled
  if (showSearchRadius && terminatorPoints.length > 0) {
    if (!searchRadiusDegrees) {
      console.warn('⚠️ searchRadiusDegrees is required when showSearchRadius is true');
      return layers;
    }
    const searchCircles = createSearchRadiusCircles(
      terminatorPoints,
      searchRadiusDegrees
    );

    layers.push(
      new GeoJsonLayer({
        id: 'search-radius-circles',
        data: {
          type: 'FeatureCollection',
          features: searchCircles,
        },
        stroked: true,
        filled: true,
        lineWidthMinPixels: 1,
        lineWidthMaxPixels: 2,
        getLineColor: [100, 150, 255, 255], // Fully opaque blue outline (was 150 - too transparent)
        getFillColor: [100, 150, 255, 80], // More visible blue fill (was 30 - too transparent)
        pickable: false,
        // Enable 3D rendering - circles will follow map tilt/pitch
        extruded: false, // Keep as 2D polygons on the globe surface
        // Disable depth testing so layers always render on top (even when interleaved)
        parameters: {
          depthTest: false, // Disable depth testing to ensure layers are always visible
          depthMask: false, // Don't write to depth buffer
        },
        updateTriggers: {
          getLineColor: [showSearchRadius, searchRadiusDegrees],
          getFillColor: [showSearchRadius, searchRadiusDegrees],
        },
      })
    );

    // Add point markers at the center of each search circle
    layers.push(
      new GeoJsonLayer({
        id: 'terminator-search-points',
        data: {
          type: 'FeatureCollection',
          features: terminatorPoints.map((point, index) => ({
            type: 'Feature' as const,
            properties: {
              pointIndex: index,
            },
            geometry: {
              type: 'Point' as const,
              coordinates: [point.lng, point.lat],
            },
          })),
        },
        stroked: false,
        filled: true,
        pointRadiusMinPixels: 3,
        pointRadiusMaxPixels: 5,
        getFillColor: [255, 0, 0, 255], // Bright red points (fully opaque)
        pickable: false,
      })
    );
  }

  console.log('🎯 Created', layers.length, 'GeoJsonLayers');
  if (showSearchRadius) {
    console.log('🔍 Search radius visualization enabled:', {
      terminatorPoints: terminatorPoints.length,
      searchRadiusDegrees,
      layersCreated: layers.length,
    });
  }
  return layers;
}
