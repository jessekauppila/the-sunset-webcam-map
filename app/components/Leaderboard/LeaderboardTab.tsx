'use client';

import { useState } from 'react';
import useSWR from 'swr';
import {
  Box,
  Typography,
  ToggleButton,
  ToggleButtonGroup,
  CircularProgress,
} from '@mui/material';

type Grouping = 'overall' | 'webcam' | 'country';
type Win = 'now' | 'today' | 'all-time';

interface Entry {
  id: number;
  aiRating: number | string;
  firebaseUrl: string | null;
  capturedAt: string;
  webcamId: number;
  webcamTitle: string | null;
  country: string;
}

const fetcher = (url: string) =>
  fetch(url).then((r) => (r.ok ? r.json() : { entries: [] }));

const GROUPS: { v: Grouping; label: string }[] = [
  { v: 'overall', label: 'Overall' },
  { v: 'webcam', label: 'Per webcam' },
  { v: 'country', label: 'Per country' },
];
const WINS: { v: Win; label: string }[] = [
  { v: 'now', label: 'Now' },
  { v: 'today', label: 'Today' },
  { v: 'all-time', label: 'All-time' },
];

const toggleSx = {
  '& .MuiToggleButton-root': {
    color: '#d1d5db',
    borderColor: '#374151',
    textTransform: 'none',
    py: 0.4,
    '&.Mui-selected': {
      color: '#60a5fa',
      backgroundColor: 'rgba(96,165,250,0.12)',
    },
  },
};

export function LeaderboardTab() {
  const [grouping, setGrouping] = useState<Grouping>('overall');
  const [win, setWin] = useState<Win>('all-time');

  const { data, isLoading } = useSWR(
    `/api/leaderboards?grouping=${grouping}&window=${win}`,
    fetcher,
    { revalidateOnFocus: false },
  );
  const entries: Entry[] = data?.entries ?? [];

  return (
    <Box>
      <Typography
        variant="caption"
        sx={{ color: '#9ca3af', display: 'block', mb: 1.5 }}
      >
        Best sunrises &amp; sunsets, ranked by AI score. Shows AI-scored frames
        only — sparse until snapshot capture has run a while.
      </Typography>

      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 2 }}>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={grouping}
          onChange={(_, v) => v && setGrouping(v)}
          sx={toggleSx}
        >
          {GROUPS.map((g) => (
            <ToggleButton key={g.v} value={g.v}>
              {g.label}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={win}
          onChange={(_, v) => v && setWin(v)}
          sx={toggleSx}
        >
          {WINS.map((w) => (
            <ToggleButton key={w.v} value={w.v}>
              {w.label}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </Box>

      {isLoading ? (
        <CircularProgress size={20} sx={{ color: 'white' }} />
      ) : entries.length === 0 ? (
        <Typography sx={{ color: '#9ca3af' }}>
          No sunsets scored yet for this window — try All-time.
        </Typography>
      ) : (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
            gap: 2,
          }}
        >
          {entries.map((e, i) => (
            <Box
              key={e.id}
              sx={{
                backgroundColor: '#111827',
                borderRadius: 2,
                overflow: 'hidden',
              }}
            >
              {e.firebaseUrl ? (
                <Box
                  component="img"
                  src={e.firebaseUrl}
                  alt={e.webcamTitle ?? 'snapshot'}
                  sx={{
                    width: '100%',
                    height: 120,
                    objectFit: 'cover',
                    display: 'block',
                  }}
                />
              ) : (
                <Box
                  sx={{
                    height: 120,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#6b7280',
                  }}
                >
                  no image
                </Box>
              )}
              <Box sx={{ p: 1 }}>
                <Typography
                  variant="body2"
                  sx={{ color: 'white', fontWeight: 600 }}
                >
                  #{i + 1} · ★ {Number(e.aiRating).toFixed(1)}
                </Typography>
                <Typography
                  variant="caption"
                  sx={{
                    color: '#9ca3af',
                    display: 'block',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {e.webcamTitle ?? `Webcam ${e.webcamId}`}
                </Typography>
                <Typography variant="caption" sx={{ color: '#6b7280' }}>
                  {e.country}
                </Typography>
              </Box>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}
