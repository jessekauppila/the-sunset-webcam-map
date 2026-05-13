// app/components/ModelAnalysis/CollapsibleSection.tsx
'use client';

import { ReactNode, useState } from 'react';
import { Box, Button, Collapse } from '@mui/material';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';

interface Props {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
}

export function CollapsibleSection({ title, children, defaultOpen = false }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Box sx={{ my: 2 }}>
      <Button
        size="small"
        onClick={() => setOpen((v) => !v)}
        startIcon={open ? <ExpandMoreIcon /> : <ChevronRightIcon />}
        sx={{
          textTransform: 'none',
          color: 'rgba(255,255,255,0.85)',
          justifyContent: 'flex-start',
        }}
      >
        {title}
      </Button>
      <Collapse in={open} unmountOnExit>
        <Box sx={{ mt: 1, pl: 3 }}>{children}</Box>
      </Collapse>
    </Box>
  );
}
