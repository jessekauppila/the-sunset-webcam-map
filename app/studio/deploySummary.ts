import { diffKeys, mergeSettings, type KnobValue, type SettingsValues } from '@/app/lib/settings/schema';
import { KNOWN_NAMESPACES, schemaFor } from '@/app/lib/settings/knownSchemas';
import type { DeployRow } from '@/app/lib/settings/deploys';

const SUMMARY_MAX = 3;

export function formatValue(v: KnobValue): string {
  if (typeof v === 'boolean') return v ? 'on' : 'off';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2);
  return v;
}

/**
 * What a deploy changed against the one before it: up to three `key value`
 * pairs then `+n`. Read through the current schemas, so a namespace that
 * vanished reads as its keys returning to their defaults.
 */
export function summarize(row: DeployRow, previous: DeployRow | undefined): string {
  if (!previous) return 'first recorded';
  const changes: string[] = [];
  for (const namespace of KNOWN_NAMESPACES) {
    const schema = schemaFor(namespace);
    if (!schema) continue;
    const now = mergeSettings(schema, row.namespaces[namespace]);
    for (const key of diffKeys(schema, previous.namespaces[namespace], row.namespaces[namespace])) {
      changes.push(`${key} ${formatValue(now[key])}`);
    }
  }
  if (changes.length === 0) return 'no dial changes';
  const shown = changes.slice(0, SUMMARY_MAX);
  if (changes.length > SUMMARY_MAX) shown.push(`+${changes.length - SUMMARY_MAX}`);
  return shown.join(' · ');
}

/** Effective-value equality over every namespace this build knows. */
export function profileEquals(
  a: Record<string, SettingsValues> | undefined,
  b: Record<string, SettingsValues> | undefined,
): boolean {
  if (!a || !b) return false;
  for (const namespace of KNOWN_NAMESPACES) {
    const schema = schemaFor(namespace);
    if (!schema) continue;
    if (diffKeys(schema, a[namespace], b[namespace]).length > 0) return false;
  }
  return true;
}
