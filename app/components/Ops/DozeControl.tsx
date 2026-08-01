'use client';

import { useEffect, useState } from 'react';
import { Box, Button, Typography } from '@mui/material';

export function DozeControl() {
  const [doze, setDoze] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch('/api/kiosk/state')
      .then((r) => r.json())
      .then((b: { doze: boolean }) => setDoze(b.doze))
      .catch(() => setDoze(null));
  }, []);

  const toggle = async () => {
    if (doze === null || busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/kiosk/doze', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ doze: !doze }),
      });
      if (res.ok) setDoze(((await res.json()) as { doze: boolean }).doze);
    } finally {
      setBusy(false);
    }
  };

  if (doze === null) return null;
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
      <Typography sx={{ color: '#9ca3af' }}>
        Gallery kiosks: {doze ? 'dozing 🌙' : 'awake ☀️'}
      </Typography>
      <Button variant="outlined" size="small" disabled={busy} onClick={toggle}>
        {doze ? 'Wake kiosks' : 'Doze kiosks'}
      </Button>
    </Box>
  );
}
