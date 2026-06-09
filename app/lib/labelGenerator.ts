import sharp from 'sharp';
import QRCode from 'qrcode';

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

export type LabelInput = {
  claimCode: string;
  name: string;
  tape: TapeMm;
  dpi?: number;
};

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export async function generateLabelPng(input: LabelInput): Promise<Buffer> {
  const dpi = input.dpi ?? 300;
  const { width, height } = labelDimensionsPx(input.tape, dpi);

  const margin = Math.round(height * 0.08);
  const qrSize = height - margin * 2;
  const qrPng = await QRCode.toBuffer(buildSetupUrl(input.claimCode), {
    type: 'png',
    width: qrSize,
    margin: 0,
    errorCorrectionLevel: 'M',
  });

  const textX = qrSize + margin * 2;
  const textW = width - textX - margin;
  const fontPx = (px: number) => Math.max(8, Math.round(px));
  const nameSize = fontPx(height * 0.26);
  const lineSize = fontPx(height * 0.2);
  const svg = `<svg width="${textW}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <text x="0" y="${fontPx(height * 0.3)}" font-family="sans-serif" font-weight="bold" font-size="${nameSize}">${escapeXml(input.name)}</text>
    <text x="0" y="${fontPx(height * 0.58)}" font-family="sans-serif" font-size="${lineSize}">sunrisesunset.studio/setup</text>
    <text x="0" y="${fontPx(height * 0.85)}" font-family="monospace" font-size="${lineSize}">${escapeXml(input.claimCode)}</text>
  </svg>`;
  const textPng = await sharp(Buffer.from(svg)).png().toBuffer();

  return sharp({
    create: { width, height, channels: 3, background: { r: 255, g: 255, b: 255 } },
  })
    .composite([
      { input: qrPng, top: margin, left: margin },
      { input: textPng, top: 0, left: textX },
    ])
    .png()
    .toBuffer();
}
