/**
 * Shared label parsing for the deploys/takes routes: a positive-integer
 * length cap, non-string rejection, and empty-to-null folding. Route files
 * may only export handler fields, so this lives beside them. Callers decide
 * how to treat a missing key before calling in (the [id] route requires an
 * explicit `label` field; POST /deploys normalizes a missing key to `null`
 * so the take can be saved without one).
 */
export const LABEL_MAX = 60;

export function parseLabel(raw: unknown): { label: string | null } | { error: string } {
  if (raw !== null && typeof raw !== 'string') {
    return { error: 'label must be a string or null' };
  }
  if (typeof raw === 'string' && raw.length > LABEL_MAX) {
    return { error: `label must be at most ${LABEL_MAX} characters` };
  }
  const label = typeof raw === 'string' && raw.trim() ? raw.trim() : null;
  return { label };
}
