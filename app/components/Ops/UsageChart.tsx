import { Box, Typography } from '@mui/material';
import type { ProviderUsageRow, CostEventRow } from '@/app/lib/opsTypes';
import { deriveDailyDeltas } from './opsMath';

const WEBCAM_PROJECT = 'noisy-leaf-96391119';
const W = 560;
const H = 140;

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
  const webcam = days.map(
    (day) =>
      deltas.find((d) => d.day === day && d.project_id === WEBCAM_PROJECT)
        ?.computeHours ?? 0,
  );
  const others = days.map((day) =>
    deltas
      .filter((d) => d.day === day && d.project_id !== WEBCAM_PROJECT)
      .reduce((sum, d) => sum + d.computeHours, 0),
  );
  const max = Math.max(...webcam, ...others, 1);
  const x = (i: number) => (days.length === 1 ? W / 2 : (i / (days.length - 1)) * W);
  const y = (v: number) => H - (v / max) * (H - 10) - 5;
  const line = (vals: number[]) => vals.map((v, i) => `${x(i)},${y(v)}`).join(' ');

  return (
    <Box sx={{ mt: 2, overflowX: 'auto' }}>
      <Typography variant="caption" sx={{ color: '#9ca3af' }}>
        Neon compute hours/day — webcams (bold) vs other projects (thin), markers = cost changes
      </Typography>
      <svg width={W} height={H} role="img" aria-label="compute hours per day">
        <polyline points={line(webcam)} fill="none" stroke="#60a5fa" strokeWidth={2} />
        {days.length > 1 && (
          <polyline points={line(others)} fill="none" stroke="#9ca3af" strokeWidth={1} />
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
