'use client';

import useSWR from 'swr';
import { Typography } from '@mui/material';
import type { OpsStatsResponse } from '@/app/lib/opsTypes';
import { OpsPanels } from './OpsPanels';

const fetcher = (url: string) =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error(`ops-stats ${r.status}`);
    return r.json() as Promise<OpsStatsResponse>;
  });

export function OpsTab() {
  const { data, error, isLoading } = useSWR('/api/admin/ops-stats', fetcher);
  if (isLoading) return <Typography sx={{ color: '#9ca3af', p: 2 }}>Loading…</Typography>;
  if (error || !data)
    return <Typography sx={{ color: '#f87171', p: 2 }}>Failed to load ops stats.</Typography>;
  return <OpsPanels data={data} />;
}
