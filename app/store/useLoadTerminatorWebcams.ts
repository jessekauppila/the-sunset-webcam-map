'use client';

import { useEffect } from 'react';
import useSWR from 'swr';
import { useTerminatorStore } from './useTerminatorStore';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function useLoadTerminatorWebcams({
  paused = false,
}: { paused?: boolean } = {}) {
  const setTerimantorWebcams = useTerminatorStore(
    (s) => s.setTerimantorWebcams
  );

  const setLoading = useTerminatorStore((s) => s.setLoading);
  const setError = useTerminatorStore((s) => s.setError);

  const { data, error, isLoading } = useSWR(
    '/api/db-terminator-webcams',
    fetcher,
    {
      refreshInterval: paused ? 0 : 60_000,
      isPaused: () => paused,
    }
  );

  useEffect(() => {
    setLoading(isLoading);
  }, [isLoading, setLoading]);

  useEffect(() => {
    if (error) setError(error.message);
  }, [error, setError]);

  useEffect(() => {
    if (data) setTerimantorWebcams(data);
  }, [data, setTerimantorWebcams]);
}
