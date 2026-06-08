'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Box, Typography, Switch, FormControlLabel, CircularProgress, Button,
  ToggleButtonGroup, ToggleButton,
} from '@mui/material';
import { SnapshotQueueCard } from '@/app/components/SnapshotQueueCard';
import RatingCard from '@/app/components/Webcam/RatingCard';
import type { Snapshot, WindyWebcam } from '@/app/lib/types';
import type { Provenance } from '@/app/lib/provenance';

type QueuedSnapshot = Snapshot & { provenance: Provenance };

const PROVENANCE_LABEL: Record<Provenance, string> = {
  flickr: 'Flickr',
  archive_trained: 'Archive · trained',
  archive_new: 'Archive · new',
};

const labelSource = (s: Snapshot): 'webcam' | 'flickr' =>
  s.source === 'flickr' ? 'flickr' : 'webcam';

const frameToCard = (s: Snapshot): WindyWebcam =>
  ({ ...s, images: { current: { preview: s.snapshot.firebaseUrl } } } as unknown as WindyWebcam);

export function HardExamplesQueue({ hotkeysEnabled = true }: { hotkeysEnabled?: boolean }) {
  const [blind, setBlind] = useState(true);
  const [view, setView] = useState<'queue' | 'grid'>('queue');
  const [source, setSource] = useState<'all' | 'webcam' | 'flickr'>('all');

  const [snapshots, setSnapshots] = useState<QueuedSnapshot[]>([]);
  const [total, setTotal] = useState(0);
  const [idx, setIdx] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null);
    const srcParam = source === 'all' ? '' : `&source=${source}`;
    fetch(`/api/snapshots?mode=verification&disagreements_only=true&limit=200&offset=0${srcParam}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(r.status === 401 || r.status === 403 ? 'Owner sign-in required' : `Failed (${r.status})`);
        return r.json();
      })
      .then((d) => { if (!cancelled) { setSnapshots(d.snapshots ?? []); setTotal(d.total ?? 0); setIdx(0); setRevealed(false); } })
      .catch((e) => { if (!cancelled) setError((e as Error).message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [source]);

  const current = snapshots[idx];
  const advance = useCallback(() => { setRevealed(false); setIdx((i) => i + 1); }, []);

  const submitLabel = useCallback(async (rating: number, isSunset: boolean) => {
    if (!current) return;
    await fetch('/api/manual-labels', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source: labelSource(current), imageId: current.snapshot.id, isSunset, rating: isSunset ? rating : null }),
    });
    if (blind && !revealed) { setRevealed(true); return; }
    advance();
  }, [current, blind, revealed, advance]);

  const onRate = useCallback(async (rating: number, opts?: { isSunsetVerdict?: boolean }) => {
    await submitLabel(rating, opts?.isSunsetVerdict ?? rating > 0);
  }, [submitLabel]);

  const onSkip = useCallback(() => advance(), [advance]);
  const onUndo = useCallback(async () => {
    const prev = snapshots[idx - 1];
    if (!prev) return;
    await fetch('/api/manual-labels', {
      method: 'DELETE', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source: labelSource(prev), imageId: prev.snapshot.id }),
    });
    setRevealed(false); setIdx((i) => Math.max(0, i - 1));
  }, [snapshots, idx]);

  useEffect(() => {
    if (!hotkeysEnabled || view !== 'queue') return;
    const handler = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (blind && revealed) { e.preventDefault(); advance(); return; }
      if (/^[1-5]$/.test(e.key)) { e.preventDefault(); void onRate(Number(e.key), { isSunsetVerdict: true }); }
      else if (e.key === '0' || e.key.toLowerCase() === 'n') { e.preventDefault(); void onRate(0, { isSunsetVerdict: false }); }
      else if (e.key === ' ') { e.preventDefault(); onSkip(); }
      else if (e.key.toLowerCase() === 'z') { e.preventDefault(); void onUndo(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [hotkeysEnabled, view, blind, revealed, onRate, onSkip, onUndo, advance]);

  const Badge = ({ s }: { s: QueuedSnapshot }) => (
    <Box sx={{ position: 'absolute', top: 18, left: 18, zIndex: 2, px: 1, py: 0.25,
      borderRadius: 1, fontSize: 11, fontWeight: 700, color: 'white',
      backgroundColor: s.provenance === 'flickr' ? 'rgba(124,58,237,0.85)' : 'rgba(0,0,0,0.72)' }}>
      {PROVENANCE_LABEL[s.provenance]}
    </Box>
  );

  const ratedCount = idx;
  const remainingCount = Math.max(0, snapshots.length - idx);
  const canUndo = idx > 0;

  return (
    <Box>
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 1, alignItems: 'center' }}>
        <FormControlLabel sx={{ color: 'white' }}
          control={<Switch checked={blind} onChange={(e) => setBlind(e.target.checked)} />}
          label="Blind (reveal after rating)" />
        <ToggleButtonGroup size="small" exclusive value={view} onChange={(_, v) => v && setView(v)}>
          <ToggleButton value="queue">Queue</ToggleButton>
          <ToggleButton value="grid">Grid</ToggleButton>
        </ToggleButtonGroup>
        <ToggleButtonGroup size="small" exclusive value={source} onChange={(_, v) => v && setSource(v)}>
          <ToggleButton value="all">All</ToggleButton>
          <ToggleButton value="webcam">Archive</ToggleButton>
          <ToggleButton value="flickr">Flickr</ToggleButton>
        </ToggleButtonGroup>
        <Typography variant="caption" sx={{ color: '#9ca3af' }}>{total} flagged</Typography>
      </Box>

      {error ? <Typography sx={{ color: '#f87171' }}>{error}</Typography>
       : loading ? <CircularProgress size={20} sx={{ color: 'white' }} />
       : view === 'grid' ? (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
          {snapshots.map((s) => (
            <Box key={`${labelSource(s)}-${s.snapshot.id}`} sx={{ position: 'relative', width: 256 }}>
              <Badge s={s} />
              <RatingCard webcam={frameToCard(s)} readOnly onRate={async () => {}} />
            </Box>
          ))}
        </Box>
       ) : !current ? (
        <Typography sx={{ color: '#9ca3af' }}>No more flagged frames — all caught up.</Typography>
       ) : (
        <Box sx={{ position: 'relative', maxWidth: 420 }}>
          <Badge s={current} />
          {blind && !revealed ? (
            <SnapshotQueueCard
              snapshot={current}
              onRate={onRate}
              onSkip={onSkip}
              onUndo={onUndo}
              canUndo={canUndo}
              ratedCount={ratedCount}
              remainingCount={remainingCount}
            />
          ) : (
            <>
              <RatingCard webcam={frameToCard(current)} readOnly onRate={async () => {}} />
              {blind && revealed && (
                <Button sx={{ mt: 1, color: 'white' }} onClick={advance}>Next (any key)</Button>
              )}
              {!blind && (
                <SnapshotQueueCard
                  snapshot={current}
                  onRate={onRate}
                  onSkip={onSkip}
                  onUndo={onUndo}
                  canUndo={canUndo}
                  ratedCount={ratedCount}
                  remainingCount={remainingCount}
                />
              )}
            </>
          )}
        </Box>
       )}
    </Box>
  );
}

export default HardExamplesQueue;
