'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Box, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, ToggleButton, ToggleButtonGroup, Typography,
} from '@mui/material';
import type { ManifestEntry } from '@/app/lib/modelRuns.types';
import { WhatIsThisPlaque } from './WhatIsThisPlaque';
import { GlossaryTerm } from './GlossaryTerm';
import { STATUS_EMOJI, STATUS_LABEL } from './statusEmoji';

type MetricGroup = 'binary' | 'regression';
const STORAGE_KEY = 'model-analysis-metric-group';

interface Props {
  runs: ManifestEntry[];
  onSelect: (slug: string) => void;
}

function pickDefaultGroup(runs: ManifestEntry[]): MetricGroup {
  let binary = 0;
  let regression = 0;
  for (const r of runs) {
    if (typeof r.binary_metrics?.val_f1 === 'number') binary++;
    if (typeof r.regression_metrics?.pearson_r === 'number') regression++;
  }
  return regression > binary ? 'regression' : 'binary';
}

function fmt(value: number | null | undefined, digits = 3): string {
  return typeof value === 'number' ? value.toFixed(digits) : '—';
}

function totalSamples(run: ManifestEntry): number | null {
  const sum =
    (run.train_samples ?? 0) +
    (run.val_samples ?? 0) +
    (run.test_samples ?? 0);
  return sum > 0 ? sum : null;
}

function fmtSamples(n: number | null): string {
  if (n === null) return '—';
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return n.toString();
}

function runDate(run: ManifestEntry): string {
  const iso = run.started_at ?? run.published_at;
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: '2-digit',
  });
}

export function ModelLeaderboard({ runs, onSelect }: Props) {
  const [group, setGroup] = useState<MetricGroup>(() => pickDefaultGroup(runs));

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'binary' || saved === 'regression') setGroup(saved);
  }, []);

  function changeGroup(next: MetricGroup) {
    setGroup(next);
    localStorage.setItem(STORAGE_KEY, next);
  }

  const sorted = useMemo(() => {
    const withSort = runs.map((r) => {
      const key = group === 'binary'
        ? r.binary_metrics?.val_f1
        : r.regression_metrics?.pearson_r;
      return { run: r, key: typeof key === 'number' ? key : -Infinity };
    });
    withSort.sort((a, b) => b.key - a.key);
    return withSort.map((x) => x.run);
  }, [runs, group]);

  return (
    <Box sx={{ p: 2.25 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', mb: 1 }}>
        <Typography variant="h6" sx={{ color: '#fff' }}>Leaderboard</Typography>
        <Typography variant="caption" sx={{ color: '#94a3b8' }}>
          Click a run to view detail
        </Typography>
      </Box>

      <WhatIsThisPlaque />

      <ToggleButtonGroup
        value={group}
        exclusive
        size="small"
        onChange={(_, v) => v && changeGroup(v)}
        sx={{
          mb: 1,
          '& .MuiToggleButton-root': {
            color: '#cbd5e1',
            borderColor: '#334155',
            '&.Mui-selected': {
              color: '#fff',
              background: '#1e293b',
              '&:hover': { background: '#1e293b' },
            },
          },
        }}
      >
        <ToggleButton value="binary">Binary classification</ToggleButton>
        <ToggleButton value="regression">Regression</ToggleButton>
      </ToggleButtonGroup>

      <TableContainer>
        <Table
          size="small"
          sx={{
            '& .MuiTableCell-root': {
              color: '#e5e7eb',
              borderColor: '#334155',
            },
            '& .MuiTableCell-head': {
              color: '#cbd5e1',
              fontWeight: 600,
              background: '#0f172a',
            },
            '& tbody .MuiTableRow-root:hover': {
              background: '#1e293b',
            },
            '& tbody .dimmed .MuiTableCell-root': {
              color: '#64748b',
            },
          }}
        >
          <TableHead>
            <TableRow>
              <TableCell>#</TableCell>
              <TableCell>Run</TableCell>
              <TableCell>Date</TableCell>
              <TableCell>Samples</TableCell>
              {group === 'binary' ? (
                <>
                  <TableCell><GlossaryTerm slug="val_f1" withIcon>F1</GlossaryTerm></TableCell>
                  <TableCell><GlossaryTerm slug="val_precision" withIcon>Precision</GlossaryTerm></TableCell>
                  <TableCell><GlossaryTerm slug="val_recall" withIcon>Recall</GlossaryTerm></TableCell>
                </>
              ) : (
                <>
                  <TableCell><GlossaryTerm slug="pearson_r" withIcon>Pearson r</GlossaryTerm></TableCell>
                  <TableCell><GlossaryTerm slug="spearman_r" withIcon>Spearman r</GlossaryTerm></TableCell>
                  <TableCell><GlossaryTerm slug="val_mse" withIcon>MSE</GlossaryTerm></TableCell>
                </>
              )}
              <TableCell><GlossaryTerm slug="best_epoch" withIcon>Best epoch</GlossaryTerm></TableCell>
              <TableCell>Status</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {sorted.map((r, i) => {
              const missing = group === 'binary'
                ? typeof r.binary_metrics?.val_f1 !== 'number'
                : typeof r.regression_metrics?.pearson_r !== 'number';
              return (
                <TableRow
                  key={r.slug}
                  hover
                  className={missing ? 'dimmed' : ''}
                  onClick={() => onSelect(r.slug)}
                  sx={{ cursor: 'pointer' }}
                >
                  <TableCell>{i + 1}</TableCell>
                  <TableCell>{r.display_name}</TableCell>
                  <TableCell>{runDate(r)}</TableCell>
                  <TableCell>{fmtSamples(totalSamples(r))}</TableCell>
                  {group === 'binary' ? (
                    <>
                      <TableCell>{fmt(r.binary_metrics?.val_f1)}</TableCell>
                      <TableCell>{fmt(r.binary_metrics?.val_precision, 2)}</TableCell>
                      <TableCell>{fmt(r.binary_metrics?.val_recall, 2)}</TableCell>
                    </>
                  ) : (
                    <>
                      <TableCell>{fmt(r.regression_metrics?.pearson_r, 2)}</TableCell>
                      <TableCell>{fmt(r.regression_metrics?.spearman_r, 2)}</TableCell>
                      <TableCell>{fmt(r.regression_metrics?.val_mse, 3)}</TableCell>
                    </>
                  )}
                  <TableCell>
                    {r.best_epoch ?? '—'}/{r.epochs_total ?? '—'}
                  </TableCell>
                  <TableCell>
                    <span aria-label={STATUS_LABEL[r.status]}>
                      {STATUS_EMOJI[r.status]}
                    </span>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}
