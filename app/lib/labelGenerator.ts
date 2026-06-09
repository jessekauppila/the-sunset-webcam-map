const SETUP_BASE = 'https://www.sunrisesunset.studio/setup';

export function buildSetupUrl(claimCode: string): string {
  return `${SETUP_BASE}/${claimCode}`;
}

export type TapeMm = { widthMm: number; lengthMm: number };
export type Dimensions = { width: number; height: number };

export function labelDimensionsPx(tape: TapeMm, dpi: number): Dimensions {
  const mmToPx = (mm: number) => Math.round((mm / 25.4) * dpi);
  // The tape's printable height is its width (14mm); the label length is the image width.
  return { width: mmToPx(tape.lengthMm), height: mmToPx(tape.widthMm) };
}
