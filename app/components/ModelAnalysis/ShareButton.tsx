'use client';

import { useState } from 'react';
import { Button } from '@mui/material';

export function ShareButton() {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API unavailable — silently no-op. The URL is still in the address bar.
    }
  }

  return (
    <Button
      size="small"
      variant="outlined"
      onClick={copy}
      sx={{
        textTransform: 'none',
        color: '#cbd5e1',
        borderColor: '#334155',
        '&:hover': { borderColor: '#475569', background: '#1e293b' },
      }}
    >
      {copied ? 'Copied!' : 'Copy link'}
    </Button>
  );
}
