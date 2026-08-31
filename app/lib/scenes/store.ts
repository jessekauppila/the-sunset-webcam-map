import 'server-only';
import { sql } from '@/app/lib/db';
import type { Scene, SceneCreateInput, SceneSummary } from './types';

export async function createScene(input: SceneCreateInput): Promise<number> {
  const rows = await sql`
    INSERT INTO kiosk_scenes (label, tags, notes, represents_at, source, state, provenance)
    VALUES (${input.label}, ${input.tags}, ${input.notes}, ${input.representsAt},
            ${input.source}, ${JSON.stringify(input.state)},
            ${input.provenance ? JSON.stringify(input.provenance) : null})
    RETURNING id`;
  return rows[0].id as number;
}

export async function listScenes(): Promise<SceneSummary[]> {
  const rows = await sql`
    SELECT id, label, tags, represents_at, source, created_at
    FROM kiosk_scenes ORDER BY represents_at DESC`;
  return rows.map((r) => ({
    id: r.id as number,
    label: r.label as string,
    tags: r.tags as string[],
    representsAt: String(r.represents_at),
    source: r.source as 'live' | 'historical',
    createdAt: String(r.created_at),
  }));
}

export async function getScene(id: number): Promise<Scene | null> {
  const rows = await sql`
    SELECT id, label, tags, notes, represents_at, source, state, provenance, created_at
    FROM kiosk_scenes WHERE id = ${id}`;
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id as number,
    label: r.label as string,
    tags: r.tags as string[],
    notes: r.notes as string,
    representsAt: String(r.represents_at),
    source: r.source as 'live' | 'historical',
    createdAt: String(r.created_at),
    state: r.state as Scene['state'],
    provenance: (r.provenance ?? null) as Scene['provenance'],
  };
}

export async function updateSceneMeta(
  id: number,
  patch: { label?: string; tags?: string[]; notes?: string }
): Promise<boolean> {
  const rows = await sql`
    UPDATE kiosk_scenes SET
      label = COALESCE(${patch.label ?? null}, label),
      tags  = COALESCE(${patch.tags ?? null}, tags),
      notes = COALESCE(${patch.notes ?? null}, notes)
    WHERE id = ${id} RETURNING id`;
  return rows.length > 0;
}

export async function deleteScene(id: number): Promise<boolean> {
  const rows = await sql`DELETE FROM kiosk_scenes WHERE id = ${id} RETURNING id`;
  return rows.length > 0;
}
