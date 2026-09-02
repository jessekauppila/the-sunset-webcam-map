import type { WindyWebcam } from '@/app/lib/types';
import { mergeSettings } from '@/app/lib/settings/schema';
import { DEFAULT_MOSAIC_VERSION } from './registry';
import { passesGate as v1PassesGate } from './v1/qualitySignal';
import { readSignal, type QualitySource } from './v2/qualitySignal';
import { V2_SETTINGS_SCHEMA } from './v2/settingsSchema';

/**
 * Whether a version considers a frame a gate-passer, given that version's
 * dial positions.
 *
 * This exists so surfaces that REPORT on a composition — the /studio status
 * strip — can ask the version on the glass rather than hardcoding one
 * version's interpretation. The strip previously imported v1's `passesGate`
 * directly, so previewing v2 with the gate dial at 0.2 still printed v1's
 * frozen-threshold counts and the numbers contradicted the picture.
 *
 * Deliberately NOT part of `MosaicComponent`: it is a read-only question
 * about a pool, not a rendering concern, and it must stay importable from
 * chrome that never mounts a mosaic.
 */
export type GatePredicate = (
  webcam: WindyWebcam,
  settings: Record<string, number | boolean | string>
) => boolean;

const MOSAIC_GATES: Record<string, GatePredicate> = {
  // v1's gate is the frozen detection threshold from masterConfig. It has no
  // dial, so the settings argument is genuinely unused here.
  v1: (webcam) => v1PassesGate(webcam),
  v2: (webcam, settings) => {
    // Merge over the schema so a caller holding only deviations, or nothing
    // at all, still gets the defaults the engine itself would compose with.
    const merged = mergeSettings(V2_SETTINGS_SCHEMA, settings);
    return readSignal(
      webcam,
      merged.qualitySource as QualitySource,
      merged.gateThreshold as number
    ).passes;
  },
};

/** Same unknown-name fallback rule as `resolveMosaic`. */
export function resolveGate(version: string | null | undefined): GatePredicate {
  return (
    (version ? MOSAIC_GATES[version] : undefined) ??
    MOSAIC_GATES[DEFAULT_MOSAIC_VERSION]
  );
}

/** Pass/total for one feed's pool, as the status strip prints it. */
export function countGatePasses(
  webcams: WindyWebcam[],
  gate: GatePredicate,
  settings: Record<string, number | boolean | string>
): { pass: number; total: number } {
  let pass = 0;
  for (const webcam of webcams) if (gate(webcam, settings)) pass += 1;
  return { pass, total: webcams.length };
}
