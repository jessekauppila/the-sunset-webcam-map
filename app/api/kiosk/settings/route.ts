import { NextResponse } from 'next/server';
import { requireOwner } from '@/app/lib/owner';
import { getProfileSettings, putStudioNamespace } from '@/app/lib/settings/store';
import { getKioskLastPoll } from '@/app/lib/cache';
import { droppedKeys, sanitizeValues, stripDefaults } from '@/app/lib/settings/schema';
import { SHARED_NAMESPACE, SHARED_SCHEMA } from '@/app/lib/settings/sharedSchema';
import { MOSAIC_SETTINGS_SCHEMAS } from '@/app/components/mosaic/registry';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function schemaFor(namespace: string) {
  if (namespace === SHARED_NAMESPACE) return SHARED_SCHEMA;
  return MOSAIC_SETTINGS_SCHEMAS[namespace] ?? null;
}

export async function GET() {
  const denied = await requireOwner();
  if (denied) return denied;
  const [studio, live, lastPollAt] = await Promise.all([
    getProfileSettings('studio'),
    getProfileSettings('live'),
    getKioskLastPoll(),
  ]);
  return NextResponse.json({ studio, live, lastPollAt });
}

export async function PATCH(request: Request) {
  const denied = await requireOwner();
  if (denied) return denied;
  let body: { namespace?: unknown; values?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }
  const { namespace, values } = body;
  if (typeof namespace !== 'string') {
    return NextResponse.json({ error: 'namespace must be a string' }, { status: 400 });
  }
  const schema = schemaFor(namespace);
  if (!schema) {
    return NextResponse.json({ error: `unknown namespace: ${namespace}` }, { status: 400 });
  }
  // Sanitizing is quiet by design, which is right for a stored blob and wrong
  // for a live PATCH: a dial posted against a build whose schema predates it
  // vanishes here, the studio row never moves, and Deploy goes on truthfully
  // reporting "in sync with glass" about a setting the glass has never heard
  // of. Name the casualties instead of swallowing them.
  const dropped = droppedKeys(schema, values);
  if (dropped.length > 0) {
    console.warn(
      `[settings] PATCH ${namespace} dropped ${dropped.length} key(s): ` +
        dropped.map((d) => `${d.key} (${d.reason})`).join(', ')
    );
  }

  const deviations = stripDefaults(schema, sanitizeValues(schema, values));
  const revision = await putStudioNamespace(namespace, deviations);
  return NextResponse.json(dropped.length > 0 ? { revision, dropped } : { revision });
}
