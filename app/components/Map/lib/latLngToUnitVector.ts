export function latLngToUnitVector(
  latDeg: number,
  lngDeg: number,
): [number, number, number] {
  const lat = (latDeg * Math.PI) / 180;
  const lng = (lngDeg * Math.PI) / 180;
  const x = Math.cos(lat) * Math.cos(lng);
  const y = Math.sin(lat);
  const z = Math.cos(lat) * Math.sin(lng);
  return [x, y, z];
}
