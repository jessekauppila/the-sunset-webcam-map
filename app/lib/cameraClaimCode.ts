import { randomBytes } from 'node:crypto';
import { sql } from '@/app/lib/db';

export const CLAIM_CODE_PATTERN = /^SUNSET-[A-HJKMNPQRTUVWXYZ2-9]{4}-[A-HJKMNPQRTUVWXYZ2-9]{4}$/;

// Unambiguous alphabet — excludes 0/O/1/I/L for sticker legibility.
const ALPHABET = 'ABCDEFGHJKMNPQRTUVWXYZ23456789';

export type ClaimCodeRow = {
  code: string;
  label: string | null;
  expires_at: Date;
  consumed_at: Date | null;
  consumed_by_camera_id: number | null;
};

function randomGroup(len: number): string {
  const bytes = randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}

export function generateClaimCode(): string {
  return `SUNSET-${randomGroup(4)}-${randomGroup(4)}`;
}

export async function mintClaimCode(opts: {
  label: string | null;
  ttlDays?: number;
}): Promise<{ code: string; expires_at: Date }> {
  const code = generateClaimCode();
  const ttl = opts.ttlDays ?? 30;
  const rows = (await sql`
    INSERT INTO camera_claim_codes (code, label, expires_at)
    VALUES (${code}, ${opts.label}, NOW() + ${ttl} * interval '1 day')
    RETURNING code, expires_at
  `) as { code: string; expires_at: Date }[];
  return rows[0];
}

export async function getClaimCode(code: string): Promise<ClaimCodeRow | null> {
  const rows = (await sql`
    SELECT code, label, expires_at, consumed_at, consumed_by_camera_id
    FROM camera_claim_codes
    WHERE code = ${code}
    LIMIT 1
  `) as ClaimCodeRow[];
  return rows[0] ?? null;
}

export async function consumeClaimCode(
  code: string,
  cameraId: number
): Promise<ClaimCodeRow | null> {
  const rows = (await sql`
    UPDATE camera_claim_codes
    SET consumed_at = NOW(),
        consumed_by_camera_id = ${cameraId}
    WHERE code = ${code}
      AND consumed_at IS NULL
      AND expires_at > NOW()
    RETURNING code, label, expires_at, consumed_at, consumed_by_camera_id
  `) as ClaimCodeRow[];
  return rows[0] ?? null;
}
