import 'server-only';
import { sql } from '@/app/lib/db';
import { getProfileSettings, type ProfileSettings } from './store';
import {
  droppedKeys,
  sanitizeValues,
  stripDefaults,
  type DroppedKey,
  type SettingsValues,
} from './schema';
import { schemaFor } from './knownSchemas';

/** One studio Deploy, the whole profile as it was copied to live (spec §2.1). */
export interface DeployRow {
  id: number;
  label: string | null;
  namespaces: Record<string, SettingsValues>;
  deployedAt: string;
}

export type DroppedDeployKey = DroppedKey & { namespace: string };

interface Row {
  id: number;
  label: string | null;
  namespaces: Record<string, SettingsValues>;
  deployed_at: string | Date;
}

function toRow(r: Row): DeployRow {
  return {
    id: Number(r.id),
    label: r.label,
    namespaces: r.namespaces,
    deployedAt: new Date(r.deployed_at).toISOString(),
  };
}

/**
 * Record the profile Deploy just copied. Never throws: history failing to
 * write must not fail the deploy, and the null return is how the route says
 * so instead of hiding it.
 */
export async function recordDeploy(
  live: ProfileSettings,
  label?: string | null,
): Promise<DeployRow | null> {
  try {
    const rows = (await sql`
      INSERT INTO kiosk_deploys (label, namespaces)
      VALUES (${label ?? null}, ${JSON.stringify(live.namespaces)}::jsonb)
      RETURNING id, label, namespaces, deployed_at
    `) as unknown as Row[];
    return toRow(rows[0]);
  } catch (error) {
    console.warn('[deploys] recordDeploy failed:', error);
    return null;
  }
}

export async function listDeploys(limit = 50): Promise<DeployRow[]> {
  try {
    const rows = (await sql`
      SELECT id, label, namespaces, deployed_at FROM kiosk_deploys ORDER BY id DESC LIMIT ${limit}
    `) as unknown as Row[];
    return rows.map(toRow);
  } catch (error) {
    console.warn('[deploys] listDeploys failed:', error);
    return [];
  }
}

/**
 * Replace the studio profile with a snapshot. Wholesale: a studio namespace
 * the snapshot never had is deleted, otherwise a stale deviation would
 * survive underneath the restore. Every namespace is read through its
 * current schema and the casualties are returned by name (schemas drift).
 * Delete-all-then-insert rather than a NOT IN list so no array parameter
 * crosses the driver; studio revisions restart at 1, which nothing reads.
 */
export async function loadDeployIntoStudio(
  id: number,
): Promise<{ studio: ProfileSettings; dropped: DroppedDeployKey[] } | null> {
  const rows = (await sql`
    SELECT namespaces FROM kiosk_deploys WHERE id = ${id}
  `) as unknown as Pick<Row, 'namespaces'>[];
  if (!rows[0]) return null;

  const dropped: DroppedDeployKey[] = [];
  const clean: Record<string, SettingsValues> = {};
  for (const [namespace, values] of Object.entries(rows[0].namespaces ?? {})) {
    const schema = schemaFor(namespace);
    if (!schema) {
      for (const key of Object.keys(values ?? {})) dropped.push({ namespace, key, reason: 'unknown' });
      continue;
    }
    for (const d of droppedKeys(schema, values)) dropped.push({ namespace, ...d });
    const deviations = stripDefaults(schema, sanitizeValues(schema, values));
    if (Object.keys(deviations).length > 0) clean[namespace] = deviations;
  }

  await sql.transaction([
    sql`DELETE FROM kiosk_settings WHERE profile = 'studio'`,
    ...Object.entries(clean).map(
      ([namespace, deviations]) => sql`
        INSERT INTO kiosk_settings (profile, namespace, data)
        VALUES ('studio', ${namespace}, ${JSON.stringify(deviations)}::jsonb)
        ON CONFLICT (profile, namespace)
        DO UPDATE SET data = EXCLUDED.data,
                      revision = kiosk_settings.revision + 1,
                      updated_at = now()
      `,
    ),
  ]);
  return { studio: await getProfileSettings('studio'), dropped };
}

export async function relabelDeploy(id: number, label: string | null): Promise<boolean> {
  const rows = (await sql`
    UPDATE kiosk_deploys SET label = ${label} WHERE id = ${id} RETURNING id
  `) as unknown as { id: number }[];
  return rows.length > 0;
}
