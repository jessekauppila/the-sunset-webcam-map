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

  if (status === 'authenticated') {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography variant="caption" sx={{ color: '#9ca3af' }}>
          {session.user?.email}
        </Typography>
        <Button
          size="small"
          onClick={() => signOut()}
          sx={{ color: '#60a5fa', textTransform: 'none' }}
        >
          Sign out
        </Button>
      </Box>
    );
  }

  return (
    <Button
      size="small"
      onClick={() => signIn('google')}
      sx={{ color: '#60a5fa', textTransform: 'none' }}
    >
      Sign in
    </Button>
  );
}
