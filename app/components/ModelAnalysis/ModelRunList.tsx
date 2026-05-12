'use client';

import { Box, Typography } from '@mui/material';
import type { ManifestEntry } from '@/app/lib/modelRuns.types';
import { STATUS_EMOJI, STATUS_LABEL } from './statusEmoji';

interface Props {
  runs: ManifestEntry[];
  selectedSlug: string | null;
  onSelect: (slug: string) => void;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function runDate(run: ManifestEntry): string {
  return formatDate(run.started_at ?? run.published_at);
}

function primaryMetric(run: ManifestEntry): string {
  const f1 = run.binary_metrics?.val_f1;
  if (typeof f1 === 'number') return `F1 ${f1.toFixed(3)}`;
  const r = run.regression_metrics?.pearson_r;
  if (typeof r === 'number') return `r ${r.toFixed(2)}`;
  return '—';
}

function totalSamples(run: ManifestEntry): number | null {
  const t = run.train_samples ?? 0;
  const v = run.val_samples ?? 0;
  const te = run.test_samples ?? 0;
  const sum = t + v + te;
  return sum > 0 ? sum : null;
}

function formatSamples(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k samples`;
  return `${n} samples`;
}

export function ModelRunList({ runs, selectedSlug, onSelect }: Props) {
  return (
    <Box
      sx={{
        width: 260,
        borderRight: '1px solid #374151',
        overflowY: 'auto',
        height: '100%',
      }}
    >
      <Box
        sx={{
          px: 1.75,
          py: 1.25,
          background: '#111827',
          fontSize: 11,
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
          color: '#94a3b8',
          borderBottom: '1px solid #374151',
        }}
      >
        {runs.length} run{runs.length === 1 ? '' : 's'} · newest first
      </Box>
      {runs.map((run) => {
        const selected = run.slug === selectedSlug;
        return (
          <Box
            key={run.slug}
            role="button"
            tabIndex={0}
            onClick={() => onSelect(run.slug)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') onSelect(run.slug);
            }}
            sx={{
              px: 1.75,
              py: 1.25,
              cursor: 'pointer',
              background: selected ? '#374151' : 'transparent',
              borderLeft: selected ? '3px solid #60a5fa' : '3px solid transparent',
              borderBottom: '1px solid #1f2937',
              '&:hover': { background: selected ? '#374151' : '#1e293b' },
            }}
          >
            <Typography variant="body2" sx={{ color: '#e5e7eb', fontWeight: 600 }}>
              {run.display_name}
            </Typography>
            <Typography variant="caption" sx={{ display: 'block', color: '#cbd5e1' }}>
              {runDate(run)} · {primaryMetric(run)} ·{' '}
              <span aria-label={STATUS_LABEL[run.status]}>
                {STATUS_EMOJI[run.status]}
              </span>
            </Typography>
            {totalSamples(run) !== null && (
              <Typography variant="caption" sx={{ display: 'block', color: '#94a3b8', mt: 0.25 }}>
                {formatSamples(totalSamples(run) as number)}
              </Typography>
            )}
          </Box>
        );
      })}
    </Box>
  );
}
