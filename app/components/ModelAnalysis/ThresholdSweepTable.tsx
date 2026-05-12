// app/components/ModelAnalysis/ThresholdSweepTable.tsx
import { Box, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
import type { RunIndex } from '@/app/lib/modelRuns.types';

interface Props {
  index: RunIndex;
}

function fmt(v: number | null | undefined, digits = 2): string {
  return typeof v === 'number' ? v.toFixed(digits) : '—';
}

export function ThresholdSweepTable({ index }: Props) {
  const sweep = index.threshold_sweep;
  if (!sweep || sweep.length === 0) return null;

  const recommended = index.decision_threshold;
  const best = index.best_threshold;

  return (
    <Box sx={{ mt: 1 }}>
      <Typography variant="caption" sx={{ color: '#94a3b8' }}>
        How precision/recall/F1 change as you raise the &quot;is good sunset?&quot;
        cutoff. Lower threshold = more sunsets flagged but more false positives;
        higher = stricter, fewer caught but cleaner.
        {best && (
          <>
            {' '}Best F1 lands at <strong>{best.threshold.toFixed(2)}</strong>.
          </>
        )}
        {typeof recommended === 'number' && (
          <>
            {' '}This run&apos;s deployed threshold is{' '}
            <strong>{recommended.toFixed(2)}</strong>.
          </>
        )}
      </Typography>
      <Table
        size="small"
        sx={{
          mt: 1,
          '& .MuiTableCell-root': { color: '#e5e7eb', borderColor: '#334155', fontSize: 12 },
          '& .MuiTableCell-head': { color: '#cbd5e1', background: '#0f172a', fontWeight: 600 },
        }}
      >
        <TableHead>
          <TableRow>
            <TableCell>Threshold</TableCell>
            <TableCell align="right">Precision</TableCell>
            <TableCell align="right">Recall</TableCell>
            <TableCell align="right">F1</TableCell>
            <TableCell />
          </TableRow>
        </TableHead>
        <TableBody>
          {sweep.map((row) => {
            const isBest = best && Math.abs(row.threshold - best.threshold) < 1e-6;
            const isDeployed = typeof recommended === 'number'
              && Math.abs(row.threshold - recommended) < 1e-6;
            return (
              <TableRow
                key={row.threshold}
                sx={{
                  background: isBest ? 'rgba(34, 197, 94, 0.08)' : undefined,
                }}
              >
                <TableCell>{row.threshold.toFixed(2)}</TableCell>
                <TableCell align="right">{fmt(row.precision)}</TableCell>
                <TableCell align="right">{fmt(row.recall)}</TableCell>
                <TableCell align="right">{fmt(row.f1)}</TableCell>
                <TableCell sx={{ color: '#94a3b8', fontSize: 11 }}>
                  {isBest && 'best F1'}
                  {isBest && isDeployed && ' · '}
                  {isDeployed && 'deployed'}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Box>
  );
}
