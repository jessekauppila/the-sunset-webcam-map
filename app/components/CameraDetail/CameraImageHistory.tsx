'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Snapshot } from '@/app/lib/types';

const DEFAULT_PAGE_SIZE = 24;

export function CameraImageHistory({
  webcamId,
  pageSize = DEFAULT_PAGE_SIZE,
}: {
  webcamId: number;
  pageSize?: number;
}) {
  const [items, setItems] = useState<Snapshot[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(
    async (nextOffset: number) => {
      setLoading(true);
      if (nextOffset === 0) setError(false);
      try {
        const res = await fetch(
          `/api/snapshots?webcam_id=${webcamId}&mode=archive&limit=${pageSize}&offset=${nextOffset}`
        );
        if (!res.ok) throw new Error(`snapshots ${res.status}`);
        const data = await res.json();
        const batch: Snapshot[] = Array.isArray(data.snapshots)
          ? data.snapshots
          : [];
        setItems((prev) => (nextOffset === 0 ? batch : [...prev, ...batch]));
        setTotal(typeof data.total === 'number' ? data.total : batch.length);
        setOffset(nextOffset + batch.length);
      } catch {
        setError(true);
      } finally {
        setLoading(false);
      }
    },
    [webcamId, pageSize]
  );

  useEffect(() => {
    void load(0);
  }, [load]);

  if (error && items.length === 0) {
    return (
      <p style={{ color: '#e74c3c', fontSize: 13 }}>
        Couldn’t load captures.{' '}
        <button
          type="button"
          onClick={() => void load(0)}
          style={{ color: '#60a5fa', textDecoration: 'underline' }}
        >
          Retry
        </button>
      </p>
    );
  }

  if (total === 0) {
    return <p style={{ color: '#7f8a9c', fontSize: 13 }}>No captures yet.</p>;
  }

  const hasMore = total !== null && items.length < total;

  return (
    <div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
          gap: 8,
        }}
      >
        {items.map((s) => (
          <figure key={s.snapshot.id} style={{ margin: 0 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={s.snapshot.firebaseUrl}
              alt={`capture ${s.snapshot.id}`}
              style={{
                width: '100%',
                aspectRatio: '4 / 3',
                objectFit: 'cover',
                borderRadius: 4,
                display: 'block',
              }}
            />
            <figcaption style={{ fontSize: 10, color: '#7f8a9c', marginTop: 2 }}>
              {new Date(s.snapshot.capturedAt).toLocaleString()}
            </figcaption>
          </figure>
        ))}
      </div>
      {hasMore && (
        <button
          type="button"
          onClick={() => void load(offset)}
          disabled={loading}
          style={{
            marginTop: 12,
            padding: '6px 14px',
            fontSize: 12,
            borderRadius: 6,
            background: '#1e2636',
            color: '#cdd4de',
          }}
        >
          {loading ? 'Loading…' : 'Load more'}
        </button>
      )}
    </div>
  );
}
