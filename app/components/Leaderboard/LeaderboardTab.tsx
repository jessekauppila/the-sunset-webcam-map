'use client';

import { useState, useEffect } from 'react';
import useSWR from 'swr';
import {
  Box,
  Button,
  Typography,
  ToggleButton,
  ToggleButtonGroup,
  CircularProgress,
} from '@mui/material';

const PAGE = 60;
const MAX = 500;

type Grouping = 'overall' | 'webcam' | 'country';
type Win = 'now' | 'today' | 'all-time';

interface Entry {
  id: number;
  llmQuality: number | string;
  llmIsSunset: boolean;
  llmIsSunrise: boolean | null;
  llmExplanation: string | null;
  llmModel: string | null;
  llmProvider: string | null;
  aiRating: number | string | null; // legacy, for comparison
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
  const [count, setCount] = useState(PAGE);

  // Reset paging when the view changes.
  useEffect(() => {
    setCount(PAGE);
  }, [grouping, win]);

  const { data, isLoading } = useSWR(
    `/api/leaderboards?grouping=${grouping}&window=${win}&limit=${count}`,
    fetcher,
    { revalidateOnFocus: false, keepPreviousData: true },
  );
  const entries: Entry[] = data?.entries ?? [];
  const maybeMore = entries.length >= count && count < MAX;

  return (
    <Box>
      <Typography
        variant="caption"
        sx={{ color: '#9ca3af', display: 'block', mb: 1.5 }}
      >
        Best sunrises &amp; sunsets, ranked by Claude&apos;s quality analysis
        (claude-sonnet-4-5) — only frames Claude judged a real sunrise/sunset.
        The small &ldquo;legacy ai&rdquo; value is the old model score, shown so
        you can see where it disagrees.
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
        <>
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
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <Typography
                    variant="caption"
                    sx={{
                      color: '#fb923c',
                      fontWeight: 700,
                      letterSpacing: '0.08em',
                    }}
                  >
                    #{i + 1} · {e.llmIsSunrise ? 'SUNRISE' : 'SUNSET'} ✓
                  </Typography>
                  <Typography
                    variant="caption"
                    sx={{ color: '#fbbf24', fontFamily: 'monospace' }}
                  >
                    {(Number(e.llmQuality) * 100).toFixed(0)}%
                  </Typography>
                </Box>
                <Typography
                  variant="caption"
                  sx={{
                    color: '#9ca3af',
                    display: 'block',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    mt: 0.5,
                  }}
                >
                  {e.webcamTitle ?? `Webcam ${e.webcamId}`} · {e.country}
                </Typography>
                {e.llmExplanation && (
                  <Typography
                    variant="caption"
                    sx={{
                      color: '#cbd5e1',
                      mt: 0.5,
                      fontSize: '10px',
                      lineHeight: 1.3,
                      display: '-webkit-box',
                      WebkitLineClamp: 3,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                    }}
                  >
                    {e.llmExplanation}
                  </Typography>
                )}
                <Typography
                  variant="caption"
                  sx={{
                    color: '#6b7280',
                    display: 'block',
                    mt: 0.5,
                    fontSize: '9px',
                  }}
                >
                  {e.llmProvider ?? 'anthropic'} · {e.llmModel ?? 'claude'} ·
                  legacy ai{' '}
                  {e.aiRating != null ? Number(e.aiRating).toFixed(1) : '—'}
                </Typography>
              </Box>
            </Box>
          ))}
        </Box>
        {maybeMore && (
          <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
            <Button
              onClick={() => setCount((c) => Math.min(c + PAGE, MAX))}
              sx={{ color: '#60a5fa', textTransform: 'none' }}
            >
              Load more
            </Button>
          </Box>
        )}
        </>
      )}
    </Box>
  );
}
