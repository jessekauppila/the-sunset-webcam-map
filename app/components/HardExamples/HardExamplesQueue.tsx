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
} from '@mui/material';
import { SnapshotQueueCard } from '@/app/components/SnapshotQueueCard';
import type { Snapshot } from '@/app/lib/types';
import type { Provenance } from '@/app/lib/provenance';

type QueuedSnapshot = Snapshot & {
  provenance: Provenance;
  modelDisagreementKind: string | null;
  aiRegressionScore: number | null;
};

type Counts = { archiveTrained: number; archiveNew: number; flickr: number };

const BATCH = 120;
const SIDE = 2; // thumbs each side (symmetric)
const THUMB_W = 104;

const PROVENANCE: Record<Provenance, { label: string; bg: string }> = {
  flickr: { label: 'Flickr', bg: 'rgba(124,58,237,0.92)' },
  archive_trained: { label: 'Archive · trained', bg: 'rgba(71,85,105,0.95)' },
  archive_new: { label: 'Archive · new', bg: 'rgba(5,150,105,0.95)' },
};

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
  if (s.llmIsSunset == null && s.llmQuality == null) return 'Claude —';
  if (s.llmIsSunset === false) return 'Claude: no';
  const pct = s.llmQuality == null ? '' : ` ${Math.round(Number(s.llmQuality) * 100)}%`;
  return `Claude: yes${pct}`;
};
const modelText = (s: QueuedSnapshot): string =>
  s.aiRegressionScore == null ? 'Model —' : `Model ${(1 + s.aiRegressionScore * 4).toFixed(1)}★`;

const toggleSx = {
  '& .MuiToggleButton-root': {
    color: '#cbd5e1',
    borderColor: 'rgba(255,255,255,0.28)',
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

const Badge = ({ p, small }: { p: Provenance; small?: boolean }) => (
  <Box
    sx={{
      position: 'absolute',
      top: 6,
      left: 6,
      zIndex: 3,
      px: 0.75,
      py: 0.25,
      borderRadius: 1,
      fontSize: small ? 9 : 11,
      fontWeight: 700,
      color: 'white',
      backgroundColor: PROVENANCE[p].bg,
    }}
  >
    {PROVENANCE[p].label}
  </Box>
);

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
  const [counts, setCounts] = useState<Counts>({ archiveTrained: 0, archiveNew: 0, flickr: 0 });
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
        if (d.counts) setCounts(d.counts);
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

  useEffect(() => {
    setIdx(0);
    void fetchBatch(0, true);
  }, [fetchBatch]);

  useEffect(() => {
    if (idx >= snapshots.length - 2 && snapshots.length < total && !loadingRef.current) {
      void fetchBatch(snapshots.length, false);
    }
  }, [idx, snapshots.length, total, fetchBatch]);

  const current = snapshots[idx];

  const rate = useCallback(
    async (rating: number, isSunset: boolean) => {
      const s = snapshots[idx];
      if (!s) return;
      setIdx((i) => i + 1);
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

  const skip = useCallback(() => setIdx((i) => Math.min(i + 1, snapshots.length)), [snapshots.length]);

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

  // Hotkeys: 1-5 = sunset + quality, N/0 = not a sunset, space = skip, z = undo.
  useEffect(() => {
    if (!hotkeysEnabled || view !== 'queue') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      if (/^[1-5]$/.test(e.key)) { e.preventDefault(); void rate(Number(e.key), true); }
      else if (e.key === '0' || e.key.toLowerCase() === 'n') { e.preventDefault(); void rate(0, false); }
      else if (e.key === ' ') { e.preventDefault(); skip(); }
      else if (e.key.toLowerCase() === 'z') { e.preventDefault(); void undo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hotkeysEnabled, view, rate, skip, undo]);

  // A small side thumbnail (rated → reveal judges; upcoming → blind).
  const Thumb = ({ s, rated }: { s: QueuedSnapshot | null; rated: boolean }) => {
    if (!s)
      return (
        <Box
          sx={{
            width: THUMB_W,
            height: 70,
            flexShrink: 0,
            borderRadius: 1,
            border: '1px dashed rgba(255,255,255,0.12)',
          }}
        />
      ); // visible empty slot → symmetric layout even before frames fill in
    return (
      <Box sx={{ width: THUMB_W, flexShrink: 0, opacity: rated ? 0.85 : 0.6 }}>
        <Box sx={{ position: 'relative', borderRadius: 1, overflow: 'hidden', filter: rated ? 'none' : 'grayscale(0.3)' }}>
          <Badge p={s.provenance} small />
          <Box component="img" src={s.snapshot.firebaseUrl} alt=""
            sx={{ width: '100%', height: 70, objectFit: 'cover', display: 'block', background: '#111827' }} />
        </Box>
        {rated && (
          <Typography sx={{ mt: 0.5, fontSize: 10, lineHeight: 1.3, color: '#cbd5e1', textAlign: 'center' }}>
            {modelText(s)}
            <br />
            {claudeText(s)}
          </Typography>
        )}
      </Box>
    );
  };

  const at = (i: number): QueuedSnapshot | null => snapshots[i] ?? null;

  const countsBar = (
    <Box
      sx={{
        display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center',
        px: 2, py: 1.25, mt: 1, borderTop: '1px solid rgba(255,255,255,0.08)',
        background: '#111827', borderRadius: 1,
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
      <Box sx={{ display: 'flex', gap: 1.5, fontSize: 12, alignItems: 'center' }}>
        <span style={{ color: '#94a3b8' }}>left to rate:</span>
        <span style={{ color: '#cbd5e1' }}>Archive·trained <b>{counts.archiveTrained}</b></span>
        <span style={{ color: '#6ee7b7' }}>Archive·new <b>{counts.archiveNew}</b></span>
        <span style={{ color: '#c4b5fd' }}>Flickr <b>{counts.flickr}</b></span>
      </Box>
    </Box>
  );

  if (error) {
    return (<Box><Typography sx={{ color: '#f87171', mb: 1 }}>{error}</Typography>{countsBar}</Box>);
  }

  if (view === 'grid') {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '46vh' }}>
        <Box sx={{ flex: 1, display: 'flex', flexWrap: 'wrap', gap: 1.5, alignContent: 'flex-start', overflow: 'auto' }}>
          {snapshots.map((s) => (
            <Box key={keyOf(s)} sx={{ position: 'relative', width: 200 }}>
              <Box component="img" src={s.snapshot.firebaseUrl} alt=""
                sx={{ width: '100%', height: 130, objectFit: 'cover', borderRadius: 1, background: '#111827' }} />
              <Badge p={s.provenance} small />
            </Box>
          ))}
        </Box>
        {countsBar}
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '46vh' }}>
      {loading && snapshots.length === 0 ? (
        <Box sx={{ flex: 1, display: 'grid', placeItems: 'center', minHeight: '36vh' }}>
          <CircularProgress size={22} sx={{ color: 'white' }} />
        </Box>
      ) : !current ? (
        <Box sx={{ flex: 1, display: 'grid', placeItems: 'center', minHeight: '36vh' }}>
          <Typography sx={{ color: '#9ca3af' }}>All caught up — no more flagged frames.</Typography>
        </Box>
      ) : (
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
          {/* rated, left — nearest the center is the most recent (idx-1) */}
          {Array.from({ length: SIDE }, (_, k) => (
            <Thumb key={`L${k}`} s={at(idx - (SIDE - k))} rated />
          ))}

          {/* active — the clean card with the Yes/No → rate flow */}
          <Box sx={{ position: 'relative', width: 360, flexShrink: 0 }}>
            <Badge p={current.provenance} />
            {!blind && (
              <Typography sx={{ textAlign: 'center', fontSize: 12, color: '#cbd5e1', mb: 0.5 }}>
                {modelText(current)} · {claudeText(current)} (inspect)
              </Typography>
            )}
            <SnapshotQueueCard
              key={keyOf(current)}
              snapshot={current}
              compact
              onRate={(rating, opts) => rate(rating, opts?.isSunsetVerdict ?? rating > 0)}
              onSkip={skip}
              onUndo={undo}
              canUndo={idx > 0}
              ratedCount={idx}
              remainingCount={Math.max(0, total - idx)}
            />
            <Typography sx={{ textAlign: 'center', mt: 0.5, fontSize: 12, color: '#e5e7eb' }}>
              {current.modelDisagreementKind
                ? WHY[current.modelDisagreementKind] ?? 'Judges disagree on this frame.'
                : 'Judges disagree on this frame.'}
            </Typography>
          </Box>

          {/* upcoming, right */}
          {Array.from({ length: SIDE }, (_, k) => (
            <Thumb key={`R${k}`} s={at(idx + 1 + k)} rated={false} />
          ))}
        </Box>
      )}

      {countsBar}
    </Box>
  );
}

export default HardExamplesQueue;
