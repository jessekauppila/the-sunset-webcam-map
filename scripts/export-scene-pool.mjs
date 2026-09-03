// scripts/export-scene-pool.mjs
// One-shot: freeze a kiosk_scenes row as a test fixture for the mosaic engine.
// Run: node scripts/export-scene-pool.mjs 3
// Writes app/components/mosaic/v3/engine/__fixtures__/live-capture-pool.json
import { neon } from '@neondatabase/serverless';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const env = readFileSync('.env.local', 'utf8');
  const line = env.split('\n').find((l) => l.startsWith('DATABASE_URL='));
  if (!line) throw new Error('DATABASE_URL not found in env or .env.local');
  return line.slice('DATABASE_URL='.length).replace(/^"|"$/g, '');
}

const sceneId = Number(process.argv[2] ?? 3);
const sql = neon(loadDatabaseUrl());
const [scene] = await sql`
  SELECT label, represents_at, state FROM kiosk_scenes WHERE id = ${sceneId}`;
if (!scene) throw new Error(`no scene ${sceneId}`);

// webcamId is a STRING in the stored payload and a number in WindyWebcam.
// Only the fields readSignal and the engine actually touch are kept: a
// fixture that carried whole Windy records would be far larger and would
// churn on unrelated schema changes.
const trim = (w) => ({
  webcamId: Number(w.webcamId),
  latitude: w.location.latitude,
  longitude: w.location.longitude,
  previewWidth: w.images?.sizes?.preview?.width ?? 400,
  previewHeight: w.images?.sizes?.preview?.height ?? 224,
  aiRatingBinary: w.aiRatingBinary,
  aiRatingRegression: w.aiRatingRegression,
  llmQuality: w.llmQuality,
  llmIsSunset: w.llmIsSunset,
});

const out = {
  label: scene.label,
  representsAt: new Date(scene.represents_at).toISOString(),
  sunrise: (scene.state.sunrise ?? []).map(trim),
  sunset: (scene.state.sunset ?? []).map(trim),
};

const dir = 'app/components/mosaic/v3/engine/__fixtures__';
mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}/live-capture-pool.json`, JSON.stringify(out, null, 1) + '\n');
console.log(`wrote ${out.sunrise.length} sunrise / ${out.sunset.length} sunset`);
