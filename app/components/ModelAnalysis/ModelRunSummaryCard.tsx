'use client';

import Link from 'next/link';
import { Box, Typography, Button } from '@mui/material';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import type { ManifestEntry } from '@/app/lib/modelRuns.types';
import { GlossaryTerm } from './GlossaryTerm';
import { STATUS_EMOJI, STATUS_LABEL } from './statusEmoji';

interface Props {
  run: ManifestEntry;
}

function fmt(v: number | null | undefined, digits = 2): string {
  return typeof v === 'number' ? v.toFixed(digits) : '—';
}

export function ModelRunSummaryCard({ run }: Props) {
  const trainedAt = run.started_at ?? run.published_at;
  const totalSamples =
    (run.train_samples ?? 0) + (run.val_samples ?? 0) + (run.test_samples ?? 0);
  return (
    <Box sx={{ p: 2.25 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', mb: 0.5 }}>
        <Typography variant="h6" sx={{ color: '#fff' }}>{run.display_name}</Typography>
        <Button
          component={Link}
          href={`/models/${run.slug}`}
          endIcon={<OpenInNewIcon />}
          variant="outlined"
          size="small"
          sx={{
            color: '#cbd5e1',
            borderColor: '#334155',
            '&:hover': { borderColor: '#475569', background: '#1e293b' },
          }}
        >
          Open full view
        </Button>
      </Box>
      <Typography variant="caption" sx={{ display: 'block', color: '#cbd5e1', mb: 2 }}>
        Trained {new Date(trainedAt).toLocaleString()}
        {totalSamples > 0 && (
          <> · {run.train_samples?.toLocaleString() ?? '?'} train / {run.val_samples?.toLocaleString() ?? '?'} val{run.test_samples ? ` / ${run.test_samples.toLocaleString()} test` : ''}</>
        )}
      </Typography>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 1,
          mb: 2,
        }}
      >
        <MetricTile
          label={<GlossaryTerm slug="val_f1">F1</GlossaryTerm>}
          value={fmt(run.binary_metrics?.val_f1, 3)}
        />
        <MetricTile
          label={<GlossaryTerm slug="pearson_r">Pearson r</GlossaryTerm>}
          value={fmt(run.regression_metrics?.pearson_r)}
        />
        <MetricTile
          label={<GlossaryTerm slug="val_mse">MSE</GlossaryTerm>}
          value={fmt(run.regression_metrics?.val_mse, 3)}
        />
        <MetricTile
          label="Status"
          value={`${STATUS_EMOJI[run.status]} ${STATUS_LABEL[run.status]}`}
        />
      </Box>

      <Typography variant="body2" sx={{ color: '#94a3b8' }}>
        {run.status_note}
      </Typography>
    </Box>
  );
}

function MetricTile({ label, value }: { label: React.ReactNode; value: string }) {
  return (
    <Box sx={{ background: '#111827', p: 1.25, borderRadius: 1 }}>
      <Typography variant="caption" sx={{ color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {label}
      </Typography>
      <Typography variant="h6" sx={{ color: '#fff', mt: 0.5 }}>
        {value}
      </Typography>
    </Box>
  );
}
