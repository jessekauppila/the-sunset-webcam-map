import type { CompositionConfig } from '@/app/components/GeoMosaic/engine/types';

/**
 * Parses on-glass composition tuning out of the kiosk URL.
 *
 * The COMPOSITION_* constants in masterConfig stay the source of truth; these
 * params exist so a value can be tried on the real panel without a redeploy.
 * Anything missing or malformed is omitted rather than defaulted, so the
 * caller's merge leaves the committed constant untouched.
 */

/** Numeric params, mapped to their config key and supported range. */
const NUMERIC_PARAMS = {
  floor: { key: 'floorPx', min: 10, max: 1000 },
  ceil: { key: 'ceilPx', min: 10, max: 2000 },
  upscale: { key: 'upscaleMax', min: 1, max: 5 },
  growth: { key: 'maxGrowth', min: 1, max: 10 },
  pad: { key: 'padding', min: 0, max: 64 },
} as const satisfies Record<
  string,
  { key: keyof CompositionConfig; min: number; max: number }
>;

const MAX_ABS_LAT = 90;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Finite-number parse; rejects '', whitespace, and trailing garbage. */
function toFiniteNumber(raw: string | null): number | null {
  if (raw === null || raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export function parseCompositionOverrides(
  params: Pick<URLSearchParams, 'get'>
): Partial<CompositionConfig> {
  const overrides: Partial<CompositionConfig> = {};

  for (const [param, { key, min, max }] of Object.entries(NUMERIC_PARAMS)) {
    const value = toFiniteNumber(params.get(param));
    if (value === null) continue;
    overrides[key] = clamp(value, min, max);
  }

  const cull = params.get('cull');
  if (cull === '0' || cull === '1') {
    overrides.cullOverflow = cull === '1';
  }

  const latWindow = parseLatWindow(params.get('lat'));
  if (latWindow) overrides.latWindow = latWindow;

  return overrides;
}

/** `north,south` — rejected unless both are real latitudes and north > south. */
function parseLatWindow(raw: string | null): [number, number] | null {
  if (raw === null) return null;

  const parts = raw.split(',');
  if (parts.length !== 2) return null;

  const north = toFiniteNumber(parts[0]);
  const south = toFiniteNumber(parts[1]);
  if (north === null || south === null) return null;

  if (Math.abs(north) > MAX_ABS_LAT || Math.abs(south) > MAX_ABS_LAT) {
    return null;
  }
  if (north <= south) return null;

  return [north, south];
}
