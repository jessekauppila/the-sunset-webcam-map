import { Box, Typography } from '@mui/material';
import type { ProviderUsageRow, CostEventRow } from '@/app/lib/opsTypes';
import { deriveDailyDeltas } from './opsMath';

const WEBCAM_PROJECT = 'noisy-leaf-96391119';
const NWAC_PROJECT = 'rough-resonance-57753560';
const W = 560;
const H = 140;

// Named series so the chart is honest about what shares the Neon bill: this
// site, the (unrelated) NWAC weather DB, and the idle leftovers.
const SERIES = [
  { key: 'sunset', label: 'sunrise-sunset (this site)', stroke: '#60a5fa', strokeWidth: 2 },
  { key: 'nwac', label: 'nwac-observations', stroke: '#9ca3af', strokeWidth: 1 },
  { key: 'other', label: 'other projects', stroke: '#9ca3af', strokeWidth: 1, dash: '2 3' },
] as const;

export function UsageChart({
  usage,
  events,
}: {
  usage: ProviderUsageRow[];
  events: CostEventRow[];
}) {
  const deltas = deriveDailyDeltas(usage);
  const days = [...new Set(deltas.map((d) => d.day))].sort();
  if (days.length === 0) {
    return (
      <Typography sx={{ color: '#9ca3af', p: 2 }}>
        Usage snapshots will appear after two daily captures.
      </Typography>
    );
  }
  const perDay = (match: (projectId: string) => boolean) =>
    days.map((day) =>
      deltas
        .filter((d) => d.day === day && match(d.project_id))
        .reduce((sum, d) => sum + d.computeHours, 0),
    );
  const values: Record<(typeof SERIES)[number]['key'], number[]> = {
    sunset: perDay((p) => p === WEBCAM_PROJECT),
    nwac: perDay((p) => p === NWAC_PROJECT),
    other: perDay((p) => p !== WEBCAM_PROJECT && p !== NWAC_PROJECT),
  };
  const max = Math.max(...Object.values(values).flat(), 1);
  const x = (i: number) => (days.length === 1 ? W / 2 : (i / (days.length - 1)) * W);
  const y = (v: number) => H - (v / max) * (H - 10) - 5;
  const line = (vals: number[]) => vals.map((v, i) => `${x(i)},${y(v)}`).join(' ');

  return (
    <Box sx={{ mt: 2, overflowX: 'auto' }}>
      <Typography variant="caption" sx={{ color: '#9ca3af' }}>
        Neon compute hours/day — markers = cost changes
      </Typography>
      <Box sx={{ display: 'flex', gap: 2, mb: 0.5 }}>
        {SERIES.map((s) => (
          <Typography
            key={s.key}
            variant="caption"
            sx={{ color: '#9ca3af', display: 'flex', alignItems: 'center', gap: 0.5 }}
          >
            <svg width={18} height={8} aria-hidden>
              <line
                x1={0}
                y1={4}
                x2={18}
                y2={4}
                stroke={s.stroke}
                strokeWidth={s.strokeWidth}
                strokeDasharray={'dash' in s ? s.dash : undefined}
              />
            </svg>
            {s.label}
          </Typography>
        ))}
      </Box>
      <svg width={W} height={H} role="img" aria-label="compute hours per day">
        {SERIES.map(
          (s) =>
            (s.key === 'sunset' || days.length > 1) && (
              <polyline
                key={s.key}
                data-series={s.key}
                points={line(values[s.key])}
                fill="none"
                stroke={s.stroke}
                strokeWidth={s.strokeWidth}
                strokeDasharray={'dash' in s ? s.dash : undefined}
              />
            ),
        )}
        {events
          .filter((e) => days.includes(e.occurred_on))
          .map((e) => (
            <line
              key={`${e.occurred_on}-${e.description}`}
              className="cost-event"
              x1={x(days.indexOf(e.occurred_on))}
              x2={x(days.indexOf(e.occurred_on))}
              y1={0}
              y2={H}
              stroke="#f59e0b"
              strokeDasharray="4 3"
            >
              <title>{`${e.occurred_on}: ${e.description}`}</title>
            </line>
          ))}
      </svg>
    </Box>
  );
}
