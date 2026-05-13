// app/components/ModelAnalysis/GraphCaption.tsx
'use client';

import { useState, MouseEvent } from 'react';
import { IconButton, Popover, Typography, Box } from '@mui/material';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import { ML_GLOSSARY } from '@/app/lib/mlGlossary';

interface Props {
  slug: string;
}

export function GraphCaption({ slug }: Props) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const entry = ML_GLOSSARY[slug];
  if (!entry) return null;

  const open = Boolean(anchor);
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5 }}>
      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
        {entry.label} — {entry.short}
      </Typography>
      <IconButton
        size="small"
        aria-label="How to read this graph"
        onClick={(e: MouseEvent<HTMLElement>) => setAnchor(e.currentTarget)}
      >
        <HelpOutlineIcon fontSize="inherit" />
      </IconButton>
      <Popover
        open={open}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      >
        <Box sx={{ p: 2, maxWidth: 360 }}>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            {entry.label}
          </Typography>
          <Typography variant="body2">{entry.long}</Typography>
        </Box>
      </Popover>
    </Box>
  );
}
