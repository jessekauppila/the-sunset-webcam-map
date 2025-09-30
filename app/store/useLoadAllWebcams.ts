'use client';

import { useEffect } from 'react';
import useSWR from 'swr';
import { useAllWebcamsStore } from './useAllWebcamsStore';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function useLoadAllWebcams() {
  const setAllWebcams = useAllWebcamsStore((s) => s.setAllWebcams);
  const setLoading = useAllWebcamsStore((s) => s.setLoading);
  const setError = useAllWebcamsStore((s) => s.setError);

  const { data, error, isLoading } = useSWR(
    '/api/db-all-webcams',
    fetcher,
    {
      refreshInterval: 60_000,
    }
  );

  useEffect(() => {
    setLoading(isLoading);
  }, [isLoading, setLoading]);

  useEffect(() => {
    if (error) setError(error.message);
  }, [error, setError]);

  useEffect(() => {
    if (data) setAllWebcams(data);
  }, [data, setAllWebcams]);
}
