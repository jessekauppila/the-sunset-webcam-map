import 'server-only';
import { sql } from '@/app/lib/db';
import type { SettingsValues } from './schema';

export type SettingsProfile = 'studio' | 'live';
export interface ProfileSettings {
  namespaces: Record<string, SettingsValues>;
  revision: number;
}

interface Row { namespace: string; data: SettingsValues; revision: number }

export async function getProfileSettings(profile: SettingsProfile): Promise<ProfileSettings> {
  const rows = (await sql`
    SELECT namespace, data, revision FROM kiosk_settings WHERE profile = ${profile}
  `) as unknown as Row[];
  const namespaces: Record<string, SettingsValues> = {};
  let revision = 0;
  for (const r of rows) {
    namespaces[r.namespace] = r.data;
    revision = Math.max(revision, r.revision);
  }
  return { namespaces, revision };
}

export async function putStudioNamespace(
  namespace: string, deviations: SettingsValues
): Promise<number> {
  if (Object.keys(deviations).length === 0) {
    await sql`DELETE FROM kiosk_settings WHERE profile = 'studio' AND namespace = ${namespace}`;
    const rows = (await sql`
      SELECT COALESCE(MAX(revision), 0) AS max FROM kiosk_settings WHERE profile = 'studio'
    `) as unknown as { max: number }[];
    return Number(rows[0]?.max ?? 0);
  }
  const json = JSON.stringify(deviations);
  const rows = (await sql`
    INSERT INTO kiosk_settings (profile, namespace, data)
    VALUES ('studio', ${namespace}, ${json}::jsonb)
    ON CONFLICT (profile, namespace)
    DO UPDATE SET data = ${json}::jsonb,
                  revision = kiosk_settings.revision + 1,
                  updated_at = now()
    RETURNING revision
  `) as unknown as { revision: number }[];
  return Number(rows[0].revision);
}

export async function copyProfile(
  from: SettingsProfile, to: SettingsProfile
): Promise<ProfileSettings> {
  await sql.transaction([
    sql`DELETE FROM kiosk_settings
        WHERE profile = ${to}
          AND namespace NOT IN
            (SELECT namespace FROM kiosk_settings WHERE profile = ${from})`,
    sql`INSERT INTO kiosk_settings (profile, namespace, data)
        SELECT ${to}, namespace, data FROM kiosk_settings WHERE profile = ${from}
        ON CONFLICT (profile, namespace)
        DO UPDATE SET data = EXCLUDED.data,
                      revision = kiosk_settings.revision + 1,
                      updated_at = now()`,
  ]);
  return getProfileSettings(to);
}
