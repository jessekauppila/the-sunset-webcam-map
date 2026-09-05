import type { SettingsSchema, SettingsValues } from '@/app/lib/settings/schema';
import { next, project } from './engine';
import { SOLO_NAMESPACE, SOLO_SETTINGS_SCHEMA, dialsFrom } from './settingsSchema';
import type { BinEntry, Feed, ScreenState, SoloDials } from './types';
import { next2, project2, roleAt } from '@/app/lib/solo2/engine';
import { SOLO2_NAMESPACE, SOLO2_SETTINGS_SCHEMA, dialsFrom2 } from '@/app/lib/solo2/settingsSchema';
import type { Role, Solo2Dials } from '@/app/lib/solo2/types';

/**
 * The solo kiosk's versions, side by side (solo2 spec §5.1). Both read the
 * same bins and screen state; a descriptor says which namespace's dials to
 * read and which engine to run. Client-safe: no server-only imports, so the
 * studio can re-project in the browser.
 */
export interface SoloVersionSpec<D extends SoloDials = SoloDials> {
  name: SoloVersionName;
  namespace: string;
  schema: SettingsSchema;
  dialsFrom(values: SettingsValues): D;
  /** The next frame for a draw at `slot`; solo ignores the slot. */
  next(entries: BinEntry[], d: D, state: ScreenState, slot: number, feed: Feed): BinEntry | null;
  /** `n` draws forward, the first at `firstSlot`. */
  project(entries: BinEntry[], d: D, state: ScreenState, n: number, firstSlot: number, feed: Feed): BinEntry[];
  /** What a draw at `slot` is inside the bar; solo is all peaks. */
  roleAt(slot: number, feed: Feed, d: D): Role;
}

export type SoloVersionName = 'solo' | 'solo2';

const solo: SoloVersionSpec<SoloDials> = {
  name: 'solo',
  namespace: SOLO_NAMESPACE,
  schema: SOLO_SETTINGS_SCHEMA,
  dialsFrom,
  next: (entries, d, state) => next(entries, d, state),
  project: (entries, d, state, n) => project(entries, d, state, n),
  roleAt: () => 'peak',
};

const solo2: SoloVersionSpec<Solo2Dials> = {
  name: 'solo2',
  namespace: SOLO2_NAMESPACE,
  schema: SOLO2_SETTINGS_SCHEMA,
  dialsFrom: dialsFrom2,
  next: next2,
  project: project2,
  roleAt,
};

export const SOLO_VERSIONS = { solo, solo2 } as const;

/**
 * Nothing → solo, so every caller that predates solo2 keeps working; an
 * unknown name → null, so an endpoint can answer 400 instead of guessing.
 */
export function resolveSoloVersion(raw: string | null | undefined): SoloVersionSpec | null {
  if (raw == null || raw === '') return solo as SoloVersionSpec;
  return raw in SOLO_VERSIONS ? (SOLO_VERSIONS[raw as SoloVersionName] as SoloVersionSpec) : null;
}
