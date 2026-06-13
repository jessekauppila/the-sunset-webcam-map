/**
 * CLI to generate a Nelko-P21 label PNG from the label module.
 *
 * Run (no global install needed):
 *   npx tsx scripts/generate-label.ts --claim SUNSET-7K3M-9XQ2 --name "Backyard West" --tape 14x75 --out label.png
 *
 * Options:
 *   --claim  <code>   Required. Claim code (e.g. SUNSET-7K3M-9XQ2)
 *   --name   <name>   Camera display name (default: "Sunset Camera")
 *   --tape   <WxL>    Tape dimensions in mm, width×length (default: 14x75)
 *   --out    <path>   Output PNG path (default: label.png)
 */
import { writeFile } from 'node:fs/promises';
import { generateLabelPng } from '@/app/lib/labelGenerator';

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

async function main() {
  const claimCode = arg('claim');
  const name = arg('name', 'Sunset Camera')!;
  const [widthMm, lengthMm] = (arg('tape', '14x75') as string).split('x').map(Number);
  const out = arg('out', 'label.png')!;

  if (!claimCode) {
    console.error('Error: --claim is required');
    process.exit(2);
  }

  const png = await generateLabelPng({ claimCode, name, tape: { widthMm, lengthMm } });
  await writeFile(out, png);
  console.log(`wrote ${out} (${name} / ${claimCode})`);
}

main();
