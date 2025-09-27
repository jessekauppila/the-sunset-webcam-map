'use client';

import useSWR from 'swr';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function useDBTerminatorWebcams() {
  const { data, error, isLoading } = useSWR(
    '/api/db-terminator-webcams',
    fetcher,
    { refreshInterval: 60_000 }
  );

  return {
    terminatorWebcams: (data as unknown[]) ?? [],
    error: error as Error | undefined,
    isLoading: Boolean(isLoading),
  };
}
