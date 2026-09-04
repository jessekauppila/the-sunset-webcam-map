export interface RingCamera {
  id: number;
  lng: number;
  title: string | null;
  imageUrl: string;
}

export interface Claim {
  cameraId: number;
  claimedAt: number;
  lastHeartbeat: number;
}

export interface RingSession {
  claims: Record<string, Claim>;
}

export interface RingSlot {
  index: number;
  total: number;
  angleDeg: number;
}

export const CLAIM_TTL_MS = 60_000;

export function pruneStale(
  session: RingSession,
  now: number,
  ttlMs: number = CLAIM_TTL_MS
): RingSession {
  const claims: Record<string, Claim> = {};
  for (const [phoneId, claim] of Object.entries(session.claims)) {
    if (now - claim.lastHeartbeat <= ttlMs) claims[phoneId] = claim;
  }
  return { claims };
}

export function assignOrKeep(
  session: RingSession,
  phoneId: string,
  ranked: RingCamera[],
  now: number
): RingSession {
  const existing = session.claims[phoneId];
  const stillValid = existing && ranked.some((c) => c.id === existing.cameraId);

  if (stillValid) {
    return {
      claims: {
        ...session.claims,
        [phoneId]: { ...existing!, lastHeartbeat: now },
      },
    };
  }

  const taken = new Set(
    Object.entries(session.claims)
      .filter(([pid]) => pid !== phoneId)
      .map(([, c]) => c.cameraId)
  );
  const pick = ranked.find((c) => !taken.has(c.id));

  if (!pick) {
    const next = { ...session.claims };
    delete next[phoneId];
    return { claims: next };
  }

  return {
    claims: {
      ...session.claims,
      [phoneId]: { cameraId: pick.id, claimedAt: now, lastHeartbeat: now },
    },
  };
}

export function releasePhone(session: RingSession, phoneId: string): RingSession {
  const next = { ...session.claims };
  delete next[phoneId];
  return { claims: next };
}

export function computeSlots(
  session: RingSession,
  ranked: RingCamera[]
): Record<string, RingSlot> {
  const lngById = new Map(ranked.map((c) => [c.id, c.lng]));
  const ordered = Object.entries(session.claims)
    .map(([phoneId, c]) => ({ phoneId, lng: lngById.get(c.cameraId) ?? 0 }))
    .sort((a, b) => a.lng - b.lng || a.phoneId.localeCompare(b.phoneId));

  const total = ordered.length;
  const slots: Record<string, RingSlot> = {};
  ordered.forEach((entry, index) => {
    slots[entry.phoneId] = {
      index,
      total,
      angleDeg: total ? (index * 360) / total : 0,
    };
  });
  return slots;
}
