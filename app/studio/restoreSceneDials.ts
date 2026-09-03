import type { DroppedKey, KnobValue, SettingsValues } from '@/app/lib/settings/schema';
import { SHARED_NAMESPACE } from '@/app/lib/settings/sharedSchema';
import type { SceneProvenance } from '@/app/lib/scenes/types';
import type { RestoreReport } from './restoreReport';

export { describeRestore, type RestoreReport } from './restoreReport';

/** The two settings operations a restore needs; the hook's API satisfies it. */
export interface RestoreTarget {
  setKnob: (namespace: string, key: string, value: KnobValue) => void;
  applyNamespace: (namespace: string, deviations: SettingsValues) => DroppedKey[];
}

/**
 * Bring a scene's saved dials back — the half of "saved configuration" that
 * was never built. captureLive has always written `provenance`; nothing read
 * it, so selecting a scene restored its pool and quietly discarded the dial
 * positions that produced it.
 *
 * Namespaces first, activeVersion last. `applyNamespace` replaces a namespace
 * wholesale, so writing the version before applying the saved `shared`
 * deviations would have it overwritten a line later. `setKnob` merges over
 * whatever is there, so going last it lands on top of the restored shared
 * dials instead of under them.
 *
 * The report is the point. Schemas drift, and `sanitizeValues` drops unknown
 * keys silently by design; a restore that hid those would be claiming to be a
 * configuration while being a partial one.
 */
export function restoreSceneDials(api: RestoreTarget, p: SceneProvenance): RestoreReport {
  let saved = 0;
  const dropped: DroppedKey[] = [];
  for (const [namespace, deviations] of Object.entries(p.settings)) {
    saved += Object.keys(deviations).length;
    dropped.push(...api.applyNamespace(namespace, deviations as SettingsValues));
  }
  api.setKnob(SHARED_NAMESPACE, 'activeVersion', p.activeVersion);
  return { activeVersion: p.activeVersion, restored: saved - dropped.length, dropped };
}
