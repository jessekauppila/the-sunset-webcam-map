// app/components/ModelAnalysis/LabelDistributionTable.tsx
import { Box, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
import type { RunIndex } from '@/app/lib/modelRuns.types';

interface Props {
  data: RunIndex['data'];
}

const BUCKETS = ['1', '2', '3', '4', '5'] as const;
const BUCKET_LABELS: Record<string, string> = {
  '1': '1 (poor)',
  '2': '2',
  '3': '3',
  '4': '4',
  '5': '5 (great)',
};

function total(counts: Record<string, number> | null | undefined): number {
  if (!counts) return 0;
  return Object.values(counts).reduce((a, b) => a + b, 0);
}

function get(counts: Record<string, number> | null | undefined, key: string): number {
  return counts?.[key] ?? 0;
}

export function LabelDistributionTable({ data }: Props) {
  const dist = data.label_distribution;
  if (!dist || (!dist.train && !dist.val && !dist.test)) {
    return null;
  }
  const splits: Array<['train' | 'val' | 'test', string]> = [
    ['train', 'Train'],
    ['val', 'Val'],
    ['test', 'Test'],
  ];

  const grandTotal =
    total(dist.train) + total(dist.val) + total(dist.test);
  const unnormalizedTotal =
    get(dist.train, 'unnormalized') +
    get(dist.val, 'unnormalized') +
    get(dist.test, 'unnormalized');

  return (
    <Box sx={{ mt: 1 }}>
      <Typography variant="caption" sx={{ color: '#94a3b8' }}>
        How many images fall in each 1–5 quality bucket (normalised 0.0–1.0
        labels remapped). Heavy bias toward 1 (poor) is expected — most webcam
        frames aren&apos;t sunsets.
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
            <TableCell>Split</TableCell>
            {BUCKETS.map((b) => (
              <TableCell key={b} align="right">{BUCKET_LABELS[b]}</TableCell>
            ))}
            <TableCell align="right">Total</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {splits.map(([key, label]) => {
            const counts = dist[key];
            if (!counts) return null;
            const splitTotal = total(counts);
            return (
              <TableRow key={key}>
                <TableCell>{label}</TableCell>
                {BUCKETS.map((b) => (
                  <TableCell key={b} align="right">
                    {get(counts, b).toLocaleString()}
                  </TableCell>
                ))}
                <TableCell align="right">{splitTotal.toLocaleString()}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {unnormalizedTotal > 0 && (
        <Typography variant="caption" sx={{ display: 'block', mt: 1, color: '#f59e0b' }}>
          ⚠ {unnormalizedTotal} sample{unnormalizedTotal === 1 ? '' : 's'} have
          label values outside 0.0–1.0 (raw 1–5 ratings that never got normalised).
          Worth cleaning up in <code>ml/export_dataset.py</code> before the next
          run; total dataset has {grandTotal.toLocaleString()} samples.
        </Typography>
      )}
    </Box>
  );
}
