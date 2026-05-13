// app/components/ModelAnalysis/WhatIsThisPlaque.tsx
'use client';

import { useState, useEffect } from 'react';
import { Box, IconButton, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';

const STORAGE_KEY = 'model-analysis-plaque-dismissed';

export function WhatIsThisPlaque() {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (sessionStorage.getItem(STORAGE_KEY) === '1') setHidden(true);
  }, []);

  if (hidden) return null;

  return (
    <Box
      sx={{
        backgroundColor: 'rgba(96, 165, 250, 0.08)',
        borderLeft: '3px solid #60a5fa',
        borderRadius: 1,
        p: 1.5,
        mb: 2,
        display: 'flex',
        alignItems: 'flex-start',
        gap: 1,
      }}
    >
      <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.85)' }}>
        <strong>What is this?</strong> Each row below is a machine-learning
        model trained to recognise good sunsets from webcam images. F1 (0–1,
        higher is better) is the model&apos;s overall accuracy. Status
        indicates training health — &quot;healthy&quot; means the model
        learned cleanly; &quot;overfit&quot; means it memorised the training
        images instead of learning the pattern. These models score every new
        snapshot on sunrisesunset.studio and decide which ones the gallery
        archives.
      </Typography>
      <IconButton
        size="small"
        aria-label="Dismiss"
        onClick={() => {
          sessionStorage.setItem(STORAGE_KEY, '1');
          setHidden(true);
        }}
        sx={{ color: 'rgba(255,255,255,0.6)' }}
      >
        <CloseIcon fontSize="small" />
      </IconButton>
    </Box>
  );
}
