import { sql } from '@/app/lib/db';
import { getClaimCode, CLAIM_CODE_PATTERN } from '@/app/lib/cameraClaimCode';

// Resolves a camera for a lifecycle action (pause/decommission) from either the
// customer path (claim_code — no account/Bearer, exactly like setup-status /
// pre-register) or the operator path (numeric camera id). Contract §13 keying:
// claim-code is authoritative for the customer; id is the operator convenience.
//
// A decommissioned camera's claim code is consumed-but-unexpired (PR-3); we only
// reject on expiry, never on consumption, so re-commission can still resolve it.
export type ResolveResult =
  | { ok: true; cameraId: number }
  | { ok: false; status: number; error: string };

export async function resolveCameraRef(
  idParam: string,
  bodyClaimCode: unknown
): Promise<ResolveResult> {
  const claimCode =
    typeof bodyClaimCode === 'string' && bodyClaimCode.trim() !== ''
      ? bodyClaimCode.trim()
      : CLAIM_CODE_PATTERN.test(idParam)
        ? idParam
        : null;

  if (claimCode) {
    const claim = await getClaimCode(claimCode);
    if (!claim) return { ok: false, status: 404, error: 'unknown claim code' };
    if (claim.expires_at.getTime() < Date.now()) {
      return { ok: false, status: 410, error: 'claim code expired' };
    }
    const rows = (await sql`
      SELECT id FROM cameras WHERE claim_code = ${claimCode} LIMIT 1
    `) as { id: number }[];
    if (!rows[0]) return { ok: false, status: 404, error: 'camera not found for claim code' };
    return { ok: true, cameraId: rows[0].id };
  }

  const cameraId = Number.parseInt(idParam, 10);
  if (!Number.isFinite(cameraId) || cameraId <= 0) {
    return { ok: false, status: 400, error: 'invalid camera id' };
  }
  const rows = (await sql`
    SELECT id FROM cameras WHERE id = ${cameraId} LIMIT 1
  `) as { id: number }[];
  if (!rows[0]) return { ok: false, status: 404, error: 'camera not found' };
  return { ok: true, cameraId: rows[0].id };
}
