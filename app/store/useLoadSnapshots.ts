'use client';

import { useEffect } from 'react';
import useSWR from 'swr';
import { useSnapshotStore } from './useSnapshotStore';
import { getUserSessionId } from '../lib/userSession';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function useLoadSnapshots() {
  const setSnapshots = useSnapshotStore((s) => s.setSnapshots);
  const setLoading = useSnapshotStore((s) => s.setLoading);
  const setError = useSnapshotStore((s) => s.setError);

  // Get user session ID for personalized results
  const userSessionId = getUserSessionId();

  const { data, error, isLoading } = useSWR(
    `/api/snapshots?user_session_id=${userSessionId}&limit=100`,
    fetcher,
    {
      refreshInterval: 60_000, // Refresh every minute
    }
  );

  useEffect(() => {
    setLoading(isLoading);
  }, [isLoading, setLoading]);

  useEffect(() => {
    if (error) setError(error.message);
  }, [error, setError]);

  useEffect(() => {
    if (data?.snapshots) {
      setSnapshots(data.snapshots);
    }
  }, [data, setSnapshots]);
}
