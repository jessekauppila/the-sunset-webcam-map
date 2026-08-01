import { Box, Typography } from '@mui/material';
import type { OpsStatsResponse } from '@/app/lib/opsTypes';
import { pct } from './opsMath';
import { Sparkline } from './Sparkline';
import { UsageChart } from './UsageChart';

function Stat({
  label,
  value,
  spark,
}: {
  label: string;
  value: string;
  spark?: (number | null)[];
}) {
  return (
    <Box sx={{ minWidth: 160, p: 1.5, borderRadius: 2, backgroundColor: '#374151' }}>
      <Typography variant="caption" sx={{ color: '#9ca3af' }}>
        {label}
      </Typography>
      <Typography variant="h6" sx={{ color: 'white' }}>
        {value}
      </Typography>
      {spark && <Sparkline values={spark} />}
    </Box>
  );
}

export function OpsPanels({ data }: { data: OpsStatsResponse }) {
  const days = data.dailyStats;
  const latest = [...days].reverse().find((d) => d.webcams_scored > 0);
  if (!latest) {
    return (
      <Typography sx={{ color: '#9ca3af', p: 2 }}>No data yet.</Typography>
    );
  }
  const fallbackPct = pct(latest.fallbacks, latest.webcams_scored);
  const cachePct = pct(latest.cache_hits, latest.webcams_scored);
  return (
    <>
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
        <Stat
          label="fallbacks (spike = scoring broke)"
          value={fallbackPct === null ? '—' : `${fallbackPct}%`}
          spark={days.map((d) => pct(d.fallbacks, d.webcams_scored))}
        />
        <Stat
          label="cache hits (dedup working)"
          value={cachePct === null ? '—' : `${cachePct}%`}
          spark={days.map((d) => pct(d.cache_hits, d.webcams_scored))}
        />
        <Stat
          label="webcams scored"
          value={String(latest.webcams_scored)}
          spark={days.map((d) => d.webcams_scored)}
        />
        <Stat
          label="score p50 / p90"
          value={`${latest.score_p50 ?? '—'} / ${latest.score_p90 ?? '—'}`}
          spark={days.map((d) => d.score_p50)}
        />
        <Stat label="model" value={latest.model_version} />
      </Box>
      <UsageChart usage={data.providerUsage} events={data.costEvents} />
    </>
  );
}
