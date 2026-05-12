// app/components/ModelAnalysis/ModelAnalysisTab.tsx
'use client';

import { useState } from 'react';
import { Box, Typography } from '@mui/material';
import type { ManifestEntry } from '@/app/lib/modelRuns.types';
import { ModelRunList } from './ModelRunList';
import { ModelLeaderboard } from './ModelLeaderboard';
import { ModelRunSummaryCard } from './ModelRunSummaryCard';
import { WhatIsThisPlaque } from './WhatIsThisPlaque';

interface Props {
  runs: ManifestEntry[];
}

export function ModelAnalysisTab({ runs }: Props) {
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const selected = runs.find((r) => r.slug === selectedSlug) ?? null;

  if (runs.length === 0) {
    return (
      <Box sx={{ p: 2.25 }}>
        <WhatIsThisPlaque />
        <Box
          sx={{
            mt: 1,
            p: 2,
            border: '1px dashed #334155',
            borderRadius: 1,
            color: '#94a3b8',
          }}
        >
          <Typography variant="body2" sx={{ mb: 0.5, color: '#cbd5e1' }}>
            No published runs yet.
          </Typography>
          <Typography variant="caption" sx={{ display: 'block' }}>
            Run an experiment with{' '}
            <code>python ml/run_experiment.py --config &lt;cfg&gt; --publish</code>{' '}
            and commit <code>public/ml-runs/</code> to populate this view.
          </Typography>
        </Box>
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', height: '100%' }}>
      <ModelRunList
        runs={runs}
        selectedSlug={selectedSlug}
        onSelect={setSelectedSlug}
      />
      <Box sx={{ flex: 1, overflowY: 'auto' }}>
        {selected
          ? <ModelRunSummaryCard run={selected} />
          : <ModelLeaderboard runs={runs} onSelect={setSelectedSlug} />}
      </Box>
    </Box>
  );
}
