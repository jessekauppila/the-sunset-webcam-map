import { GeoJsonLayer } from '@deck.gl/layers';

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
}) {
  const {
    sunrise,
    sunset,
    entireTerminatorRing,
    entireHiResTerminatorRing,
    sunriseColor = [120, 170, 255, 200], // blue-ish
    sunsetColor = [255, 170, 120, 200], // orange-ish
    terminatorColor = [64, 64, 64, 200],
    lineWidth = 3,
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

  const layers = [
    new GeoJsonLayer({
      id: 'entire-terminator',
      data: entireHiResTerminatorRing,
      stroked: true,
      filled: false,
      lineWidthMinPixels: lineWidth,
      lineWidthMaxPixels: lineWidth * 2,
      getLineColor: terminatorColor,
      pickable: false,
      updateTriggers: {
        getLineColor: [terminatorColor],
      },
    }),

    // new GeoJsonLayer({
    //   id: 'entire-terminator',
    //   data: entireTerminatorRing,
    //   stroked: true,
    //   filled: false,
    //   lineWidthMinPixels: lineWidth,
    //   lineWidthMaxPixels: lineWidth * 2,
    //   getLineColor: terminatorColor,
    //   pickable: false,
    //   updateTriggers: {
    //     getLineColor: [terminatorColor],
    //   },
    // }),

    // new GeoJsonLayer({
    //   id: 'terminator-sunrise',
    //   data: sunrise,
    //   stroked: true,
    //   filled: false,
    //   lineWidthMinPixels: lineWidth,
    //   lineWidthMaxPixels: lineWidth * 2,
    //   getLineColor: sunriseColor,
    //   pickable: false,
    //   updateTriggers: {
    //     getLineColor: [sunriseColor],
    //   },
    // }),

    // new GeoJsonLayer({
    //   id: 'terminator-sunset',
    //   data: sunset,
    //   stroked: true,
    //   filled: false,
    //   lineWidthMinPixels: lineWidth,
    //   lineWidthMaxPixels: lineWidth * 2,
    //   getLineColor: sunsetColor,
    //   pickable: false,
    //   updateTriggers: {
    //     getLineColor: [sunsetColor],
    //   },
    // }),
  ];

  console.log('🎯 Created', layers.length, 'GeoJsonLayers');
  return layers;
}
