'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Box,
  Typography,
  Switch,
  FormControlLabel,
  CircularProgress,
  ToggleButtonGroup,
  ToggleButton,
  Button,
} from '@mui/material';
import type { Snapshot } from '@/app/lib/types';
import type { Provenance } from '@/app/lib/provenance';

type QueuedSnapshot = Snapshot & {
  provenance: Provenance;
  modelDisagreementKind: string | null;
  aiRegressionScore: number | null;
};

const BATCH = 120;
const STEP = 200; // px between filmstrip frames
const ACTIVE_W = 360; // active frame width
const SIDE_SCALE = 0.62;
const WINDOW = 3; // frames rendered each side of the active one

const PROVENANCE: Record<Provenance, { label: string; bg: string }> = {
  flickr: { label: 'Flickr', bg: 'rgba(124,58,237,0.9)' },
  archive_trained: { label: 'Archive · trained', bg: 'rgba(55,65,81,0.92)' },
  archive_new: { label: 'Archive · new', bg: 'rgba(5,150,105,0.92)' },
};

// One-line "why is this here" copy, keyed on the disagreement kind.
const WHY: Record<string, string> = {
  model_low_claude_sunset:
    'Model rated this low — Claude calls it a sunset. Likely a miss.',
  model_high_claude_not_sunset:
    'Model rated this high — Claude says it is not a sunset.',
  binary_negative_regression_high:
    'Sunset detector says no — the quality model rated it high.',
  binary_positive_regression_low:
    'Sunset detector says yes — the quality model rated it low.',
};

const labelSource = (s: Snapshot): 'webcam' | 'flickr' =>
  s.source === 'flickr' ? 'flickr' : 'webcam';

const keyOf = (s: Snapshot) => `${labelSource(s)}:${s.snapshot.id}`;

const claudeText = (s: QueuedSnapshot): string => {
  if (s.llmIsSunset == null && s.llmQuality == null) return 'Claude: —';
  if (s.llmIsSunset === false) return 'Claude: not a sunset';
  const pct = s.llmQuality == null ? '' : ` · ${Math.round(Number(s.llmQuality) * 100)}%`;
  return `Claude: sunset${pct}`;
};

const modelText = (s: QueuedSnapshot): string =>
  s.aiRegressionScore == null
    ? 'Model: —'
    : `Model: ${(1 + s.aiRegressionScore * 4).toFixed(1)}★`;

const toggleSx = {
  '& .MuiToggleButton-root': {
    color: '#cbd5e1',
    borderColor: 'rgba(255,255,255,0.25)',
    fontSize: 12,
    px: 1.25,
    py: 0.25,
    textTransform: 'none' as const,
    '&.Mui-selected': {
      color: '#0b1220',
      backgroundColor: '#60a5fa',
      '&:hover': { backgroundColor: '#3b82f6' },
    },
    '&:hover': { backgroundColor: 'rgba(96,165,250,0.15)' },
  },
};

export function HardExamplesQueue({
  hotkeysEnabled = true,
}: {
  hotkeysEnabled?: boolean;
}) {
  const [blind, setBlind] = useState(true);
  const [view, setView] = useState<'queue' | 'grid'>('queue');
  const [source, setSource] = useState<'all' | 'webcam' | 'flickr'>('all');

  const [snapshots, setSnapshots] = useState<QueuedSnapshot[]>([]);
  const [total, setTotal] = useState(0);
  const [idx, setIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadingRef = useRef(false);

  const fetchBatch = useCallback(
    async (offset: number, replace: boolean) => {
      if (loadingRef.current) return;
      loadingRef.current = true;
      setLoading(true);
      setError(null);
      try {
        const srcParam = source === 'all' ? '' : `&source=${source}`;
        const r = await fetch(
          `/api/snapshots?mode=verification&disagreements_only=true&limit=${BATCH}&offset=${offset}${srcParam}`,
        );
        if (!r.ok)
          throw new Error(
            r.status === 401 || r.status === 403
              ? 'Owner sign-in required'
              : `Failed to load (${r.status})`,
          );
        const d = await r.json();
        const incoming: QueuedSnapshot[] = d.snapshots ?? [];
        setTotal(d.total ?? 0);
        setSnapshots((prev) => {
          if (replace) return incoming;
          const seen = new Set(prev.map(keyOf));
          return [...prev, ...incoming.filter((s) => !seen.has(keyOf(s)))];
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load');
      } finally {
        loadingRef.current = false;
        setLoading(false);
      }
    },
    [source],
  );

  // (Re)load when the source filter changes.
  useEffect(() => {
    setIdx(0);
    void fetchBatch(0, true);
  }, [fetchBatch]);

  // Prefetch the next batch at the second-to-last frame.
  useEffect(() => {
    if (
      idx >= snapshots.length - 2 &&
      snapshots.length < total &&
      !loadingRef.current
    ) {
      void fetchBatch(snapshots.length, false);
    }
  }, [idx, snapshots.length, total, fetchBatch]);

  const current = snapshots[idx];

  const rate = useCallback(
    async (rating: number, isSunset: boolean) => {
      const s = snapshots[idx];
      if (!s) return;
      setIdx((i) => i + 1); // advance immediately; the rated frame slides left
      await fetch('/api/manual-labels', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          source: labelSource(s),
          imageId: s.snapshot.id,
          isSunset,
          rating: isSunset ? rating : null,
        }),
      }).catch(() => {});
    },
    [snapshots, idx],
  );

  const skip = useCallback(
    () => setIdx((i) => Math.min(i + 1, snapshots.length)),
    [snapshots.length],
  );

  const undo = useCallback(async () => {
    const prev = snapshots[idx - 1];
    if (!prev) return;
    setIdx((i) => Math.max(0, i - 1));
    await fetch('/api/manual-labels', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source: labelSource(prev), imageId: prev.snapshot.id }),
    }).catch(() => {});
  }, [snapshots, idx]);

  // Keyboard: 1-5 = sunset + quality, N/0 = not a sunset, space = skip, z = undo.
  useEffect(() => {
    if (!hotkeysEnabled || view !== 'queue') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      if (/^[1-5]$/.test(e.key)) {
        e.preventDefault();
        void rate(Number(e.key), true);
      } else if (e.key === '0' || e.key.toLowerCase() === 'n') {
        e.preventDefault();
        void rate(0, false);
      } else if (e.key === ' ') {
        e.preventDefault();
        skip();
      } else if (e.key.toLowerCase() === 'z') {
        e.preventDefault();
        void undo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hotkeysEnabled, view, rate, skip, undo]);

  const remaining = Math.max(0, total - idx);

  // A single filmstrip frame, positioned by its offset from the active one.
  const renderFrame = (s: QueuedSnapshot, offset: number) => {
    const isActive = offset === 0;
    const rated = offset < 0; // already labeled → reveal the judges
    const showJudges = rated || (!blind && isActive);
    const scale = isActive ? 1 : SIDE_SCALE;
    const opacity = isActive ? 1 : rated ? 0.4 : 0.7;
    const prov = PROVENANCE[s.provenance];
    return (
      <Box
        key={keyOf(s)}
        sx={{
          position: 'absolute',
          top: 0,
          left: '50%',
          width: ACTIVE_W,
          transform: `translateX(calc(-50% + ${offset * STEP}px)) scale(${scale})`,
          opacity,
          transition:
            'transform 320ms cubic-bezier(.2,.7,.2,1), opacity 320ms ease',
          zIndex: 10 - Math.abs(offset),
          filter: rated ? 'grayscale(0.5)' : 'none',
          pointerEvents: 'none',
        }}
      >
        <Box
          sx={{
            position: 'relative',
            borderRadius: 2,
            overflow: 'hidden',
            boxShadow: isActive ? '0 12px 40px rgba(0,0,0,0.55)' : 'none',
            border: isActive
              ? '1px solid rgba(96,165,250,0.5)'
              : '1px solid rgba(255,255,255,0.06)',
          }}
        >
          <Box
            component="img"
            src={s.snapshot.firebaseUrl}
            alt=""
            sx={{
              display: 'block',
              width: '100%',
              maxHeight: '34vh',
              objectFit: 'cover',
              background: '#111827',
            }}
          />
          <Box
            sx={{
              position: 'absolute',
              top: 8,
              left: 8,
              px: 1,
              py: 0.25,
              borderRadius: 1,
              fontSize: 10,
              fontWeight: 700,
              color: 'white',
              backgroundColor: prov.bg,
            }}
          >
            {prov.label}
          </Box>
          {showJudges && (
            <Box
              sx={{
                position: 'absolute',
                bottom: 0,
                left: 0,
                right: 0,
                px: 1,
                py: 0.5,
                display: 'flex',
                gap: 1.5,
                fontSize: 11,
                fontWeight: 600,
                color: 'white',
                background: 'linear-gradient(transparent, rgba(0,0,0,0.82))',
              }}
            >
              <span>{claudeText(s)}</span>
              <span>{modelText(s)}</span>
            </Box>
          )}
        </Box>
      </Box>
    );
  };

  const controls = (
    <Box
      sx={{
        display: 'flex',
        gap: 2,
        flexWrap: 'wrap',
        alignItems: 'center',
        px: 2,
        py: 1.25,
        mt: 1,
        borderTop: '1px solid rgba(255,255,255,0.08)',
        background: '#111827',
        borderRadius: 1,
      }}
    >
      <FormControlLabel
        sx={{ m: 0, color: '#e5e7eb', '& .MuiFormControlLabel-label': { fontSize: 13 } }}
        control={<Switch size="small" checked={blind} onChange={(e) => setBlind(e.target.checked)} />}
        label="Blind"
      />
      <ToggleButtonGroup size="small" exclusive value={view} onChange={(_, v) => v && setView(v)} sx={toggleSx}>
        <ToggleButton value="queue">Queue</ToggleButton>
        <ToggleButton value="grid">Grid</ToggleButton>
      </ToggleButtonGroup>
      <ToggleButtonGroup size="small" exclusive value={source} onChange={(_, v) => v && setSource(v)} sx={toggleSx}>
        <ToggleButton value="all">All</ToggleButton>
        <ToggleButton value="webcam">Archive</ToggleButton>
        <ToggleButton value="flickr">Flickr</ToggleButton>
      </ToggleButtonGroup>
      <Box sx={{ flex: 1 }} />
      <Typography variant="caption" sx={{ color: '#9ca3af' }}>
        {remaining} of {total} left
      </Typography>
    </Box>
  );

  if (error) {
    return (
      <Box>
        <Typography sx={{ color: '#f87171', mb: 1 }}>{error}</Typography>
        {controls}
      </Box>
    );
  }

  if (view === 'grid') {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '46vh' }}>
        <Box sx={{ flex: 1, display: 'flex', flexWrap: 'wrap', gap: 1.5, alignContent: 'flex-start', overflow: 'auto' }}>
          {snapshots.map((s) => (
            <Box key={keyOf(s)} sx={{ position: 'relative', width: 200 }}>
              <Box component="img" src={s.snapshot.firebaseUrl} alt=""
                sx={{ width: '100%', height: 130, objectFit: 'cover', borderRadius: 1, background: '#111827' }} />
              <Box sx={{ position: 'absolute', top: 6, left: 6, px: 0.75, py: 0.25, borderRadius: 1, fontSize: 9, fontWeight: 700, color: 'white', backgroundColor: PROVENANCE[s.provenance].bg }}>
                {PROVENANCE[s.provenance].label}
              </Box>
            </Box>
          ))}
        </Box>
        {controls}
      </Box>
    );
  }

  const windowFrames = snapshots
    .map((s, i) => ({ s, offset: i - idx }))
    .filter((f) => f.offset >= -WINDOW && f.offset <= WINDOW);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '46vh' }}>
      <Box sx={{ position: 'relative', height: '36vh', overflow: 'hidden', mt: 1 }}>
        {loading && snapshots.length === 0 ? (
          <Box sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
            <CircularProgress size={22} sx={{ color: 'white' }} />
          </Box>
        ) : !current ? (
          <Box sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
            <Typography sx={{ color: '#9ca3af' }}>All caught up — no more flagged frames.</Typography>
          </Box>
        ) : (
          windowFrames.map(({ s, offset }) => renderFrame(s, offset))
        )}
      </Box>

      {current && (
        <Box sx={{ textAlign: 'center', mt: 1, px: 2 }}>
          <Typography sx={{ color: '#e5e7eb', fontSize: 14, minHeight: 20 }}>
            {current.modelDisagreementKind
              ? WHY[current.modelDisagreementKind] ?? 'Judges disagree on this frame.'
              : 'Judges disagree on this frame.'}
          </Typography>
          {current.title && (
            <Typography variant="caption" sx={{ color: '#9ca3af' }}>
              {current.title}
              {current.owner ? ` · ${current.owner}` : ''}
            </Typography>
          )}
          <Box sx={{ display: 'flex', gap: 1, justifyContent: 'center', mt: 1, flexWrap: 'wrap' }}>
            <Button size="small" variant="outlined" onClick={() => void rate(0, false)}
              sx={{ color: '#fca5a5', borderColor: 'rgba(248,113,113,0.5)' }}>
              Not sunset (N)
            </Button>
            {[1, 2, 3, 4, 5].map((n) => (
              <Button key={n} size="small" variant="outlined" onClick={() => void rate(n, true)}
                sx={{ minWidth: 36, color: '#fde68a', borderColor: 'rgba(253,230,138,0.5)' }}>
                {n}
              </Button>
            ))}
            <Button size="small" onClick={skip} sx={{ color: '#9ca3af' }}>Skip (␣)</Button>
            <Button size="small" onClick={() => void undo()} disabled={idx === 0} sx={{ color: '#9ca3af' }}>Undo (z)</Button>
          </Box>
        </Box>
      )}

      {controls}
    </Box>
  );
}

export default HardExamplesQueue;
