'use client';

import { signIn, signOut, useSession } from 'next-auth/react';
import { Box, Button, Typography, CircularProgress } from '@mui/material';

/**
 * Sign-in / sign-out affordance. Shows "Sign in" to the public, the operator's
 * email + "Sign out" when authenticated, and a small spinner while resolving.
 */
export function AuthControl() {
  const { data: session, status } = useSession();

  if (status === 'loading') {
    return <CircularProgress size={16} sx={{ color: 'white' }} />;
  }

  // Muted/secondary styling: subtle gray that still reads clearly against the
  // gray-700 (#374151) drawer footer (gray-300 on gray-700 ≈ 5.9:1 contrast).
  const subtleButton = {
    color: '#d1d5db', // gray-300
    textTransform: 'none' as const,
    fontWeight: 400,
    fontSize: '0.75rem',
    minWidth: 'auto',
    px: 1,
    '&:hover': { color: '#f3f4f6', backgroundColor: 'rgba(255,255,255,0.06)' },
  };

  if (status === 'authenticated') {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography variant="caption" sx={{ color: '#9ca3af' }}>
          {session.user?.email}
        </Typography>
        <Button size="small" onClick={() => signOut()} sx={subtleButton}>
          Sign out
        </Button>
      </Box>
    );
  }

  return (
    <Button size="small" onClick={() => signIn('google')} sx={subtleButton}>
      Sign in
    </Button>
  );
}
