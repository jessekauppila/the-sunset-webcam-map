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
import RatingCard from '@/app/components/Webcam/RatingCard';
import type { WindyWebcam } from '@/app/lib/types';

const PAGE = 60;
const MAX = 500;

type Grouping = 'overall' | 'webcam' | 'country';
type Win = 'now' | 'today' | 'all-time';

interface Entry {
  id: number;
  llmQuality: number | string | null; // null on model-fallback frames
  llmIsSunset: boolean | null;
  llmIsSunrise: boolean | null;
  llmExplanation: string | null;
  llmModel: string | null;
  llmProvider: string | null;
  aiRating: number | string | null; // legacy junk — comparison only
  aiRegressionScore: number | string | null; // real v4 score [0,1]
  aiModelVersionRegression: string | null;
  sortScore: number | string | null; // unified rank key (Claude or model)
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

const noop = async () => {};

/**
 * Map a leaderboard snapshot onto the WindyWebcam shape RatingCard renders.
 * Claude's analysis goes into the dedicated llm* fields (NOT proxied into the
 * model slots — that hid which judge spoke). The real v4 regression score, when
 * the archive backfill (U3) has reached the frame, fills the model block; it's
 * absent (and so the model block is hidden) on Claude-only frames pre-backfill.
 */
function entryToWebcam(e: Entry): WindyWebcam {
  const llmQuality = e.llmQuality == null ? null : Number(e.llmQuality);
  const regScore =
    e.aiRegressionScore == null ? null : Number(e.aiRegressionScore);
  return {
    webcamId: e.webcamId,
    title: e.webcamTitle ?? `Webcam ${e.webcamId}`,
    viewCount: 0,
    status: 'active',
    images: { current: { preview: e.firebaseUrl ?? '' } },
    location: { country: e.country, longitude: 0, latitude: 0 },
    categories: [],
    phase: e.llmIsSunrise ? 'sunrise' : 'sunset',
    // Claude (third judge) — real fields, no longer faked into model slots.
    llmQuality,
    llmIsSunset: e.llmIsSunset,
    llmModel: e.llmModel,
    // Real v4 regression score → 1-5 stars, only once backfilled.
    aiRatingRegression:
      regScore == null ? undefined : Number((1 + regScore * 4).toFixed(2)),
    aiModelVersionRegression: e.aiModelVersionRegression ?? undefined,
  } as unknown as WindyWebcam;
}

export function LeaderboardTab() {
  const [grouping, setGrouping] = useState<Grouping>('overall');
  const [win, setWin] = useState<Win>('all-time');
  const [count, setCount] = useState(PAGE);

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
        (claude-sonnet-4-5), falling back to the v4 model&apos;s score where
        Claude hasn&apos;t weighed in. Archive only — no Flickr.
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
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
            {entries.map((e, i) => (
              <Box key={e.id} sx={{ position: 'relative', width: 256 }}>
                <Box
                  sx={{
                    position: 'absolute',
                    top: 18,
                    left: 18,
                    zIndex: 2,
                    backgroundColor: 'rgba(0,0,0,0.72)',
                    color: 'white',
                    px: 1,
                    py: 0.25,
                    borderRadius: 1,
                    fontSize: 12,
                    fontWeight: 700,
                    fontFamily: 'monospace',
                  }}
                >
                  #{i + 1} · {(Number(e.sortScore) * 100).toFixed(0)}%
                </Box>
                <RatingCard webcam={entryToWebcam(e)} readOnly onRate={noop} />
                {e.llmExplanation && (
                  <Typography
                    variant="caption"
                    sx={{
                      color: '#9ca3af',
                      display: 'block',
                      mt: 0.5,
                      width: 256,
                      fontSize: '10px',
                      lineHeight: 1.35,
                    }}
                  >
                    {e.llmExplanation}
                  </Typography>
                )}
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
