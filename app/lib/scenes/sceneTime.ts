/**
 * A scene's moment must be an unambiguous instant.
 *
 * `new Date('2026-03-20T18:30:00')` with no offset is parsed in the RUNTIME's
 * zone — UTC on Vercel, Pacific on the operator's laptop. The request then
 * pulls genuine frames from an instant hours from the one intended, so the
 * pool and its timestamp agree with each other and are both wrong. Nothing
 * downstream can detect that: the frames are real, just from the wrong time.
 *
 * This is forward-looking defence, not a fix for a known incident. The two
 * seed scenes were checked and their stored `represents_at` matches the UTC
 * instant each label names, to the second, so this has not bitten yet. The
 * separately-reported ~7h solar skew on those reconstructed pools
 * (docs/superpowers/specs/2026-09-01-mosaic-v2-phase2-composition-decisions.md)
 * is therefore NOT explained by this, and remains open and unattributed.
 *
 * It matters more now that scenes resolve from a time window rather than
 * carrying their frames: a wrong instant stops being one bad scene and
 * becomes every future replay of that window. A 400 at the boundary beats
 * that, whether or not it has ever happened.
 */
const HAS_EXPLICIT_OFFSET = /(?:Z|[+-]\d{2}:?\d{2})$/i;

export interface SceneInstant {
  at: Date;
}

export type SceneInstantError =
  | 'missing'
  | 'no-timezone'
  | 'unparseable';

export function parseSceneInstant(
  raw: unknown
): { ok: true; value: Date } | { ok: false; error: SceneInstantError } {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return { ok: false, error: 'missing' };
  }
  const trimmed = raw.trim();
  if (!HAS_EXPLICIT_OFFSET.test(trimmed)) {
    return { ok: false, error: 'no-timezone' };
  }
  const at = new Date(trimmed);
  if (Number.isNaN(at.getTime())) {
    return { ok: false, error: 'unparseable' };
  }
  return { ok: true, value: at };
}

export const SCENE_INSTANT_MESSAGE: Record<SceneInstantError, string> = {
  missing: 'at is required',
  'no-timezone':
    'at must carry an explicit timezone (trailing Z or ±HH:MM). ' +
    'A bare wall-clock time is read in the server timezone and silently ' +
    'shifts the scene by the offset.',
  unparseable: 'unparseable at timestamp',
};

/** Clamp to the same range the reconstruction endpoint accepts. */
export function clampWindowMinutes(raw: unknown): number {
  return Math.min(180, Math.max(5, Number(raw) || 45));
}
