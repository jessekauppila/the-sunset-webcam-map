'use client';

import { useEffect } from 'react';
import useSWR from 'swr';
import { useMyCamerasStore } from './useMyCamerasStore';
import { useIsOperator } from '@/app/components/auth/useIsOperator';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

/**
 * Loads /api/my-cameras into the store on a 60s cadence, but only for the
 * operator — the SWR key is null otherwise, so no request (and no 401) fires
 * for logged-out visitors.
 */
export function useLoadMyCameras() {
  const { isOperator } = useIsOperator();
  const setCameras = useMyCamerasStore((s) => s.setCameras);
  const setLoading = useMyCamerasStore((s) => s.setLoading);
  const setError = useMyCamerasStore((s) => s.setError);

  const { data, error, isLoading } = useSWR(
    isOperator ? '/api/my-cameras' : null,
    fetcher,
    { refreshInterval: 60_000 }
  );

  useEffect(() => { setLoading(isLoading); }, [isLoading, setLoading]);
  useEffect(() => { if (error) setError(error.message); }, [error, setError]);
  useEffect(() => { if (Array.isArray(data)) setCameras(data); }, [data, setCameras]);
}
