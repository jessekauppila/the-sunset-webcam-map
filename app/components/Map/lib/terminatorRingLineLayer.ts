import { GeoJsonLayer } from '@deck.gl/layers';

type LineStringFC =
  | GeoJSON.Feature<GeoJSON.LineString>
  | GeoJSON.FeatureCollection;

export function makeTerminatorLayers(opts: {
  sunrise: LineStringFC;
  sunset: LineStringFC;
  sunriseColor?: [number, number, number, number];
  sunsetColor?: [number, number, number, number];
  lineWidth?: number;
}) {
  const {
    sunrise,
    sunset,
    sunriseColor = [120, 170, 255, 200], // blue-ish
    sunsetColor = [255, 170, 120, 200], // orange-ish
    lineWidth = 2,
  } = opts;

  return [
    // new GeoJsonLayer({
    //   id: 'terminator-sunrise',
    //   data: sunrise,
    //   stroked: true,
    //   filled: false,
    //   lineWidthMinPixels: lineWidth,
    //   getLineColor: sunriseColor,
    //   pickable: false,
    // }),
    // new GeoJsonLayer({
    //   id: 'terminator-sunset',
    //   data: sunset,
    //   stroked: true,
    //   filled: false,
    //   lineWidthMinPixels: lineWidth,
    //   getLineColor: sunsetColor,
    //   pickable: false,
    // }),
  ];
}
