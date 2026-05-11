// app/components/ModelAnalysis/MetricTiles.tsx
import { Box, Typography } from '@mui/material';
import type { RunIndex } from '@/app/lib/modelRuns.types';
import { GlossaryTerm } from './GlossaryTerm';
import { STATUS_EMOJI, STATUS_LABEL } from './statusEmoji';

interface Props {
  index: RunIndex;
}

type Tile = { slug: string; label: string; value: string };

function fmt(v: number | null | undefined, digits = 2): string | null {
  return typeof v === 'number' ? v.toFixed(digits) : null;
}

function tilesFor(index: RunIndex): Tile[] {
  const m = index.metrics;
  const all: Array<[string, string, string | null]> = [
    ['val_f1', 'F1', fmt(m.best_f1 ?? null, 3)],
    ['val_precision', 'Precision', fmt(m.val_precision ?? null)],
    ['val_recall', 'Recall', fmt(m.val_recall ?? null)],
    ['val_accuracy', 'Accuracy', fmt(m.val_accuracy ?? null)],
    ['pearson_r', 'Pearson r', fmt(m.pearson_r ?? null)],
    ['spearman_r', 'Spearman r', fmt(m.spearman_r ?? null)],
    ['r_squared', 'R²', fmt(m.r_squared ?? null)],
    ['val_mse', 'MSE', fmt(m.val_mse ?? null, 3)],
  ];
  return all.flatMap(([slug, label, value]) =>
    value === null ? [] : [{ slug, label, value }]
  );
}

export function MetricTiles({ index }: Props) {
  const tiles = tilesFor(index);
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(4, 1fr)' },
        gap: 1,
      }}
    >
      {tiles.map((t) => (
        <Box
          key={t.slug}
          data-testid="metric-tile"
          sx={{ background: '#111827', p: 1.5, borderRadius: 1 }}
        >
          <Typography
            variant="caption"
            sx={{ color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5 }}
          >
            <GlossaryTerm slug={t.slug}>{t.label}</GlossaryTerm>
          </Typography>
          <Typography variant="h6" sx={{ color: '#fff', mt: 0.5 }}>
            {t.value}
          </Typography>
        </Box>
      ))}
      <Box
        data-testid="metric-tile"
        sx={{ background: '#111827', p: 1.5, borderRadius: 1 }}
      >
        <Typography variant="caption" sx={{ color: '#94a3b8' }}>Status</Typography>
        <Typography variant="h6" sx={{ color: '#fff', mt: 0.5 }}>
          {STATUS_EMOJI[index.diagnosis.status]} {STATUS_LABEL[index.diagnosis.status]}
        </Typography>
      </Box>
    </Box>
  );
}
