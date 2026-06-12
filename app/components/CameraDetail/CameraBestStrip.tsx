'use client';

import { useEffect, useState } from 'react';
import type { LeaderboardEntry } from '@/app/api/leaderboards/route';

const STRIP_LIMIT = 12;

function qualityPct(q: number | string | null): string | null {
  if (q == null) return null;
  const n = Number(q);
  return Number.isFinite(n) ? `${Math.round(n * 100)}%` : null;
}

export function CameraBestStrip({ webcamId }: { webcamId: number }) {
  const [entries, setEntries] = useState<LeaderboardEntry[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetch(
        `/api/leaderboards?webcam_id=${webcamId}&limit=${STRIP_LIMIT}`
      );
      const data = await res.json();
      if (!cancelled) {
        setEntries(Array.isArray(data.entries) ? data.entries : []);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [webcamId]);

  if (entries !== null && entries.length === 0) {
    return <p style={{ color: '#7f8a9c', fontSize: 13 }}>No ranked frames yet.</p>;
  }

  return (
    <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
      {(entries ?? []).map((e) => {
        const pct = qualityPct(e.sortScore ?? e.llmQuality);
        return (
          <div key={e.id} style={{ position: 'relative', flex: 'none' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={e.firebaseUrl ?? ''}
              alt={`top frame ${e.id}`}
              style={{
                width: 120,
                height: 88,
                objectFit: 'cover',
                borderRadius: 6,
                display: 'block',
              }}
            />
            {pct && (
              <span
                style={{
                  position: 'absolute',
                  bottom: 4,
                  right: 4,
                  fontSize: 10,
                  fontWeight: 800,
                  background: 'rgba(67,56,202,0.85)',
                  color: '#fff',
                  borderRadius: 999,
                  padding: '1px 6px',
                }}
              >
                {pct}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
