import useSWR from 'swr';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function useTerminatorWebcams() {
  const { data, error, isLoading } = useSWR(
    '/api/terminator-webcams',
    fetcher,
    { refreshInterval: 60_000 }
  );

  return {
    combinedWebcams: (data as unknown[]) ?? [],
    error: error as Error | undefined,
    isLoading: Boolean(isLoading),
  };
}
